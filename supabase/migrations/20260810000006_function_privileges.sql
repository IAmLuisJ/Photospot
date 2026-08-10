-- Postgres grants EXECUTE on every new function to PUBLIC by default, so each
-- function above was reachable by anon regardless of the grants we wrote.
--
-- The one that mattered: recount_spot is SECURITY DEFINER, so an anonymous
-- caller could invoke it and force writes to public.spots — the same table
-- where UPDATE on the counter columns is deliberately revoked from application
-- roles. It only recomputes from source tables, so it cannot set arbitrary
-- values, but it is an unauthenticated write path and a cheap way to generate
-- load. claim_studio carried a PUBLIC grant alongside its intended one.
--
-- Revoke from PUBLIC first, then grant back only where something actually calls
-- the function.

revoke execute on function public.spots_within_meters(double precision, double precision, double precision, public.spot_kind) from public;
revoke execute on function public.claim_studio(uuid) from public;
revoke execute on function public.recount_spot(uuid) from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.touch_updated_at() from public;
revoke execute on function public.trg_recount_spots() from public;
revoke execute on function public.trg_recount_spots_upd() from public;

-- The duplicate check runs during submission, which requires an account.
-- service_role needs it too: it is the trusted server identity, and revoking
-- from PUBLIC takes the privilege away from it as well — BYPASSRLS skips row
-- policies, not the GRANT system.
grant execute on function public.spots_within_meters(double precision, double precision, double precision, public.spot_kind) to authenticated, service_role;

-- For operational repair. Still withheld from anon and authenticated, which is
-- the point of this migration.
grant execute on function public.recount_spot(uuid) to service_role;

-- Already granted when it was created; restated so this file lists the full
-- intended surface rather than leaving it implicit.
grant execute on function public.claim_studio(uuid) to authenticated;

-- is_admin() is called from inside RLS policy expressions, which are evaluated
-- with the querying role's privileges — including on anon SELECTs, since
-- spots_read and photos_read both reference it. Without this grant every
-- policy that mentions is_admin() fails outright.
grant execute on function public.is_admin() to anon, authenticated;

-- The trigger functions get no grant at all. Triggers check EXECUTE at creation
-- time rather than at fire time, and trg_recount_spots is SECURITY DEFINER so
-- it runs as postgres, which already has the privilege.
--
-- cast_signal and claim_studio stay authenticated-only: both derive identity
-- from auth.uid(), so service_role calling them would just hit the null check.

-- Changing a vote atomically (spec §9.2).
--
-- Without this, flipping a "would you shoot here again?" answer means a client
-- DELETE followed by an INSERT: two round trips with no transaction between
-- them. A delete that succeeds followed by an insert that fails silently
-- discards the user's vote — and the optimistic UI has already drawn the new
-- state, so nothing looks wrong.
--
-- SECURITY INVOKER on purpose: authorization stays in RLS, which already limits
-- a user to their own signals. The function adds atomicity, not privilege.
-- auth.uid() supplies profile_id, so a caller cannot vote as someone else even
-- by trying.
create or replace function public.cast_signal(
  p_spot_id uuid,
  p_kind public.signal_kind,
  p_shoot_type_id integer default null,
  p_value smallint default 1
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'must be signed in to vote';
  end if;

  -- `is not distinct from` rather than `=`, because shoot_type_id is null for
  -- shoot_again votes and `null = null` is null, which would match nothing and
  -- turn every flip into a unique-constraint violation.
  delete from public.signals
   where spot_id = p_spot_id
     and profile_id = auth.uid()
     and kind = p_kind
     and shoot_type_id is not distinct from p_shoot_type_id;

  insert into public.signals (spot_id, profile_id, kind, shoot_type_id, value)
  values (p_spot_id, auth.uid(), p_kind, p_shoot_type_id, p_value);
end;
$$;

revoke execute on function public.cast_signal(uuid, public.signal_kind, integer, smallint) from public;
grant execute on function public.cast_signal(uuid, public.signal_kind, integer, smallint) to authenticated;
