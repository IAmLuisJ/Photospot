create type public.spot_kind   as enum ('outdoor', 'studio');
create type public.spot_status as enum ('published', 'hidden', 'removed');
create type public.cost_type   as enum (
  'free', 'park_pass', 'permit_required', 'hourly_rate', 'negotiated'
);

create table public.spots (
  id uuid primary key default gen_random_uuid(),
  kind public.spot_kind not null,
  name text not null,
  slug text not null unique,
  description text,
  location geography(Point, 4326) not null,
  locality text,
  region text,
  -- Nullable with ON DELETE SET NULL so a contributor can delete their account.
  -- NO ACTION here made account deletion impossible for exactly the users who
  -- contributed most: the auth.users -> profiles cascade hits this FK and aborts.
  -- Cascading instead would destroy spots other people have photographed and
  -- commented on, so the spot survives with an anonymous author (spec §4.8).
  created_by uuid references public.profiles (id) on delete set null,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  status public.spot_status not null default 'published',

  -- Derived. Never edited by hand: see scripts/backfill-scores.ts.
  score numeric(12,3) not null default 0,
  hot_score numeric(12,3) not null default 0,

  -- Trigger-maintained counters. Weighting happens in TypeScript.
  shoot_type_upvote_count integer not null default 0,
  shoot_again_yes_count   integer not null default 0,
  shoot_again_no_count    integer not null default 0,
  comment_count           integer not null default 0,
  scouting_photo_count    integer not null default 0,
  session_photo_count     integer not null default 0,

  -- Optional attributes (spec §4.7). Nullable by design.
  cost_type public.cost_type,
  cost_notes text,
  permit_url text,
  hours_notes text,
  best_light text[],
  best_seasons text[],
  walk_minutes integer,
  parking_notes text,
  terrain text[],
  accessibility text[],
  max_group_size integer,
  dog_friendly boolean,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index spots_location_idx  on public.spots using gist (location);
create index spots_score_idx     on public.spots (score desc);
create index spots_hot_score_idx on public.spots (hot_score desc);
-- No plain index on status or kind. Benchmarked at 50k rows: status is 92%
-- 'published' so it is never selective enough to use, and kind always arrives
-- alongside a viewport, where it is applied as a filter on the GIST result.

-- See migration 1's grant comment on public.profiles for the rationale:
-- service_role only until task 11 adds row-level security policies.
grant select, insert, update, delete on public.spots to service_role;

-- Enabled here rather than in task 11 so the table fails CLOSED for the three
-- tasks in between (9, 10, 11 itself before its policies land).
alter table public.spots enable row level security;

create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- UPDATE OF, not bare UPDATE: the counter triggers (task 10) and the score
-- backfill (task 15) write derived columns on every row, which would otherwise
-- make updated_at mean "when rankings were last recomputed" — the same value
-- table-wide — rather than when the spot was last edited.
create trigger spots_touch_updated_at
  before update of
    name, slug, description, kind, location, locality, region, status,
    owner_profile_id, cost_type, cost_notes, permit_url, hours_notes,
    best_light, best_seasons, walk_minutes, parking_notes, terrain,
    accessibility, max_group_size, dog_friendly
  on public.spots
  for each row execute function public.touch_updated_at();

-- Proximity lookup backing the duplicate check in the submission flow.
-- Spec §9.1 defines a duplicate as proximity AND matching kind: an outdoor pin
-- dropped beside a studio is not a duplicate of it, so p_kind is required
-- rather than optional.
--
-- search_path is pinned rather than left to resolve via the caller (PostgREST
-- connects as authenticator and switches role per request, but does not reset
-- search_path), so st_dwithin/st_point/st_distance resolve deterministically
-- to PostGIS in `extensions` regardless of caller.
create or replace function public.spots_within_meters(
  p_lng double precision,
  p_lat double precision,
  p_meters double precision,
  p_kind public.spot_kind
)
-- An explicit projection rather than `setof public.spots`. With the table type,
-- the RPC's public contract would silently widen every time a column is added
-- to spots — a moderation note or internal flag would become reachable here
-- with no change to this function and nothing to review. The duplicate prompt
-- needs only enough to render "is it one of these?" and route a choice.
--
-- distance_meters is free: st_distance is already computed for the ORDER BY,
-- and returning it lets the prompt say "40 m away" without the client
-- recomputing it.
returns table (
  id uuid,
  name text,
  slug text,
  kind public.spot_kind,
  locality text,
  region text,
  distance_meters double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.id, s.name, s.slug, s.kind, s.locality, s.region,
    st_distance(s.location, st_point(p_lng, p_lat)::geography) as distance_meters
  from public.spots s
  where s.status = 'published'
    and s.kind = p_kind
    and st_dwithin(s.location, st_point(p_lng, p_lat)::geography, p_meters)
  order by st_distance(s.location, st_point(p_lng, p_lat)::geography)
$$;
