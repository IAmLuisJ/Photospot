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
  created_by uuid not null references public.profiles (id),
  owner_profile_id uuid references public.profiles (id),
  status public.spot_status not null default 'published',

  -- Derived. Never edited by hand: see scripts/backfill-scores.ts.
  score numeric not null default 0,
  hot_score numeric not null default 0,

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
create index spots_status_idx    on public.spots (status);
create index spots_kind_idx      on public.spots (kind);

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

create trigger spots_touch_updated_at
  before update on public.spots
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
returns setof public.spots
language sql
stable
set search_path = public, extensions
as $$
  select *
  from public.spots
  where status = 'published'
    and kind = p_kind
    and st_dwithin(location, st_point(p_lng, p_lat)::geography, p_meters)
  order by st_distance(location, st_point(p_lng, p_lat)::geography)
$$;
