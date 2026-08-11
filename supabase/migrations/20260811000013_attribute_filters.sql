-- Attribute filtering happens here rather than in the client because the query
-- caps at 500 rows. A filter applied after the cap would silently drop spots
-- that matched but fell outside the first 500 — the map would appear to lose
-- results as it got busier, which is the worst possible time for it.
--
-- DROP first: Postgres keys functions by their argument list, so CREATE OR
-- REPLACE with new parameters creates a second overload rather than replacing,
-- and PostgREST is then unable to choose between them — with the old one, which
-- ignores the new arguments, still serving callers. The drop takes the grants
-- with it, so they are rewritten below.
--
-- Null semantics, deliberately: every predicate excludes rows where the
-- attribute is unknown. A filter promising a short walk must not return a spot
-- whose walk time nobody recorded. The cost is that filtering bites hardest on
-- a thin map, which is why the UI reports how many spots were hidden for
-- lacking the data rather than leaving the user to guess (spec §14).
--
-- No index is added for these predicates, and that is a measurement rather than
-- an omission. Spec §4.7 argues these columns are *indexable*, which is an
-- argument for the column shape, not proof that an index earns its keep. With
-- 5000 synthetic spots across the Grand Rapids box, EXPLAIN (ANALYZE) showed:
--
--   no attribute index   Bitmap Index Scan on spots_location_idx, 4914 rows
--                        removed by filter, 5.4 ms
--   + GIN(accessibility) index is used (Recheck Cond on @>), 1163 rows
--                        removed by filter, 4.8 ms
--
-- So the GIST viewport index does the work and a GIN index buys ~11% at a scale
-- an order of magnitude beyond the launch market — against a write cost on
-- every UPDATE to spots, which now happens on every vote through the score
-- refresh. Revisit when a single viewport genuinely holds thousands of spots;
-- the query to re-measure with is in this comment's history.
drop function if exists public.spots_in_viewport(
  double precision, double precision, double precision, double precision, integer, text, integer
);

create or replace function public.spots_in_viewport(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_shoot_type_id integer default null,
  p_sort text default 'score',
  p_limit integer default 200,
  p_cost_types text[] default null,
  p_max_walk_minutes integer default null,
  p_accessibility text[] default null,
  p_dog_friendly boolean default null
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
    -- cardinality = 0 is "no filter", not "match nothing": the UI sends an
    -- empty array the moment a user unchecks their last box.
    and (
      p_cost_types is null or cardinality(p_cost_types) = 0
      or s.cost_type::text = any(p_cost_types)
    )
    -- `is not null` is redundant and stays as documentation: `null <= 20` is
    -- null, which a WHERE already treats as not-matching, and a mutation test
    -- confirms removing it changes nothing. The same three-valued logic is what
    -- excludes unknowns from the cost and accessibility predicates below —
    -- none of them needs an explicit null check, which is exactly why the rule
    -- is worth writing down somewhere a reader will see it.
    and (
      p_max_walk_minutes is null
      or (s.walk_minutes is not null and s.walk_minutes <= p_max_walk_minutes)
    )
    -- `@>` (contains), not `&&` (overlaps): these are requirements, so a spot
    -- carrying only one of two selected values must not match.
    and (
      p_accessibility is null or cardinality(p_accessibility) = 0
      or s.accessibility @> p_accessibility
    )
    -- False means "no filter", not "show me spots that ban dogs" — nobody asked
    -- for that and the UI cannot express it.
    and (not coalesce(p_dog_friendly, false) or s.dog_friendly is true)
  order by
    case when p_sort = 'hot' then s.hot_score else s.score end desc,
    s.id
  limit least(greatest(p_limit, 1), 500)
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and the drop above
-- discarded the old grants entirely, so both statements are required.
revoke execute on function public.spots_in_viewport(
  double precision, double precision, double precision, double precision, integer, text, integer,
  text[], integer, text[], boolean
) from public;

-- Browsing is open to logged-out visitors (spec §4.6), so anon gets it too.
grant execute on function public.spots_in_viewport(
  double precision, double precision, double precision, double precision, integer, text, integer,
  text[], integer, text[], boolean
) to anon, authenticated, service_role;
