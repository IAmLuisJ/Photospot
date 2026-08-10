-- Viewport query behind the map.
--
-- An RPC rather than a view because `location` is geography, and PostgREST
-- serialises that as hex EWKB (0101000020E6100000…) which no map library can
-- read. st_x/st_y project it to plain doubles at the boundary.
--
-- `status = 'published'` is written explicitly even though RLS enforces it: the
-- RLS predicate is a disjunction, so it can never match a partial index's
-- predicate, and any `where status='published'` partial index would be unused
-- if the query leaned on RLS alone.
create or replace function public.spots_in_viewport(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_shoot_type_id integer default null,
  p_sort text default 'score',
  p_limit integer default 200
)
returns table (
  id uuid,
  name text,
  slug text,
  kind public.spot_kind,
  lat double precision,
  lng double precision,
  locality text,
  region text,
  score numeric,
  hot_score numeric,
  comment_count integer,
  scouting_photo_count integer,
  session_photo_count integer,
  cover_photo_path text,
  cover_credit_name text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.id, s.name, s.slug, s.kind,
    st_y(s.location::geometry) as lat,
    st_x(s.location::geometry) as lng,
    s.locality, s.region, s.score, s.hot_score,
    s.comment_count, s.scouting_photo_count, s.session_photo_count,
    cover.storage_path, cover.credit_name
  from public.spots s
  left join lateral (
    -- A session photo is what persuades a family, so it wins over a scouting
    -- shot; oldest first within a kind so the cover is stable as photos are added.
    select p.storage_path, p.credit_name
    from public.photos p
    where p.spot_id = s.id and p.status = 'published'
    order by (p.kind = 'session') desc, p.created_at asc
    limit 1
  ) cover on true
  where s.status = 'published'
    and st_intersects(
          s.location,
          st_makeenvelope(p_west, p_south, p_east, p_north, 4326)::geography
        )
    and (
      p_shoot_type_id is null
      or exists (
        select 1 from public.spot_shoot_types st
        where st.spot_id = s.id and st.shoot_type_id = p_shoot_type_id
      )
    )
  order by
    case when p_sort = 'hot' then s.hot_score else s.score end desc,
    s.id
  limit least(greatest(p_limit, 1), 500)
$$;

-- Detail page. Returns a set rather than a single row so an unknown or
-- unpublished slug comes back as an empty result instead of an error the route
-- would have to special-case.
create or replace function public.spot_by_slug(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  kind public.spot_kind,
  description text,
  lat double precision,
  lng double precision,
  locality text,
  region text,
  score numeric,
  hot_score numeric,
  shoot_type_upvote_count integer,
  shoot_again_yes_count integer,
  shoot_again_no_count integer,
  comment_count integer,
  scouting_photo_count integer,
  session_photo_count integer,
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
  dog_friendly boolean
)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.id, s.name, s.slug, s.kind, s.description,
    st_y(s.location::geometry) as lat,
    st_x(s.location::geometry) as lng,
    s.locality, s.region, s.score, s.hot_score,
    s.shoot_type_upvote_count, s.shoot_again_yes_count, s.shoot_again_no_count,
    s.comment_count, s.scouting_photo_count, s.session_photo_count,
    s.cost_type, s.cost_notes, s.permit_url, s.hours_notes,
    s.best_light, s.best_seasons, s.walk_minutes, s.parking_notes,
    s.terrain, s.accessibility, s.max_group_size, s.dog_friendly
  from public.spots s
  where s.slug = p_slug and s.status = 'published'
$$;

-- Postgres grants EXECUTE to PUBLIC by default, so the grants below restrict
-- nothing unless PUBLIC is revoked first.
revoke execute on function public.spots_in_viewport(double precision, double precision, double precision, double precision, integer, text, integer) from public;
revoke execute on function public.spot_by_slug(text) from public;

-- Browsing is open to logged-out visitors (spec §4.6), so anon gets both.
grant execute on function public.spots_in_viewport(double precision, double precision, double precision, double precision, integer, text, integer) to anon, authenticated, service_role;
grant execute on function public.spot_by_slug(text) to anon, authenticated, service_role;

-- Photos are served from Storage. Public read so a logged-out visitor sees the
-- map; writes come in plan 3 and are not granted here.
insert into storage.buckets (id, name, public)
values ('spot-photos', 'spot-photos', true)
on conflict (id) do nothing;

create policy "spot photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'spot-photos');
