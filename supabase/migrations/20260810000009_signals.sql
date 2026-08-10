-- Per-shoot-type vote counts for the detail page (spec §4.4, §8).
--
-- spots.shoot_type_upvote_count is one total across every shoot type, which
-- cannot answer the question the vote is actually scoped to: this park is good
-- for engagement photos and bad for toddlers.
--
-- An RPC rather than letting the client aggregate: the alternative ships one
-- row per vote to the browser and grows without bound on a popular spot.
--
-- The row set is (shoot types tagged on the spot) UNION (shoot types that
-- already carry votes on it). A spot's shoot types are editable, so a type can
-- be untagged after people have voted on it. Listing only the tagged ones would
-- drop those votes from the page while the total counter still counts them, and
-- the breakdown would silently disagree with the total.
--
-- SECURITY INVOKER: signals_read is `using (true)`, so counting needs no
-- elevated rights, and viewer_upvoted must be evaluated as the caller.
create or replace function public.spot_signal_summary(p_spot_id uuid)
returns table (
  shoot_type_id integer,
  slug text,
  label text,
  sort_order integer,
  upvote_count integer,
  viewer_upvoted boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.id,
    t.slug,
    t.label,
    t.sort_order,
    v.upvote_count,
    -- bool_or over `profile_id = auth.uid()` is null for a logged-out caller
    -- (null = uuid is null, not false), and null for a type with no votes at
    -- all, so both collapse to false here.
    coalesce(v.viewer_upvoted, false)
  from public.shoot_types t
  join lateral (
    select
      count(*)::integer as upvote_count,
      bool_or(s.profile_id = auth.uid()) as viewer_upvoted
    from public.signals s
    where s.spot_id = p_spot_id
      -- Defence in depth, and inert as written: signals_shape forces every
      -- shoot_again row to carry a null shoot_type_id, which the join below
      -- already excludes. Deleting this line changes no result today. It
      -- becomes load-bearing the day a new signal kind carries a shoot type.
      and s.kind = 'shoot_type_upvote'
      and s.shoot_type_id = t.id
  ) v on true
  -- status is filtered explicitly rather than left to RLS. This function never
  -- selects from public.spots, so spots_read never runs on it: without this
  -- clause anyone holding the id of a hidden or removed spot could read its
  -- shoot types and vote counts straight off the public API. Both sibling RPCs
  -- in 20260810000007_explore.sql filter status the same way.
  where exists (
      select 1 from public.spots sp
      where sp.id = p_spot_id and sp.status = 'published'
    )
    -- These parentheses are load-bearing: `and` binds tighter than `or`, so
    -- without them the tagged-types branch would satisfy the where clause on
    -- its own and bypass the status filter entirely.
    and (
      v.upvote_count > 0
      or exists (
        select 1 from public.spot_shoot_types st
        where st.spot_id = p_spot_id and st.shoot_type_id = t.id
      )
    )
  order by t.sort_order, t.id
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, so the grant below
-- would restrict nothing without this revoke first.
revoke execute on function public.spot_signal_summary(uuid) from public;

-- anon included: the counts are public and browsing never hits a signup wall
-- (spec §4.6). service_role included because revoking from PUBLIC takes the
-- privilege from it too — BYPASSRLS skips row policies, not the GRANT system.
grant execute on function public.spot_signal_summary(uuid) to anon, authenticated, service_role;

-- shoot_types is reference data, and it was the one table where service_role
-- held SELECT alone; every other table in this schema already grants it write.
--
-- The tests need it. The seed sets sort_order = id * 10 for all nine types, so
-- across the seeded rows `order by sort_order` and `order by id` are perfectly
-- correlated and no assertion over them can tell the two apart — a dropped
-- ORDER BY would go unnoticed. Writing a probe type whose id is highest and
-- whose sort_order is lowest is what makes the ordering observable.
--
-- Deliberately no grant on shoot_types_id_seq: nextval accepts USAGE *or*
-- UPDATE, and Supabase's default privileges already give service_role UPDATE
-- ('w') on sequences in public. Verified by inserting as service_role with the
-- table grants below and no sequence grant at all; had it been required this
-- would fail loudly at db-reset time, not silently.
grant insert, delete on public.shoot_types to service_role;
