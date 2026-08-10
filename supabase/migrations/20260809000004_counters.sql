-- Full recount rather than incremental +1/-1 deltas. At this scale the cost is
-- irrelevant, and a recount cannot drift: incremental arithmetic goes wrong
-- silently on a missed edge case (a status flip, a cascade, a multi-row
-- statement) and the numbers are already wrong by the time anyone notices.
--
-- SECURITY DEFINER because task 11 revokes UPDATE on the counter columns from
-- application roles. A plain function would run with the caller's rights and be
-- blocked by those grants.
--
-- search_path pinned to '' — every reference below is schema-qualified, and
-- pg_temp is otherwise searched ahead of public for relation names.
create or replace function public.recount_spot(p_spot_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.spots s set
    shoot_type_upvote_count = (
      select count(*) from public.signals
      where spot_id = p_spot_id and kind = 'shoot_type_upvote'
    ),
    shoot_again_yes_count = (
      select count(*) from public.signals
      where spot_id = p_spot_id and kind = 'shoot_again' and value = 1
    ),
    shoot_again_no_count = (
      select count(*) from public.signals
      where spot_id = p_spot_id and kind = 'shoot_again' and value = 0
    ),
    comment_count = (
      select count(*) from public.comments
      where spot_id = p_spot_id and status = 'published'
    ),
    scouting_photo_count = (
      select count(*) from public.photos
      where spot_id = p_spot_id and kind = 'scouting' and status = 'published'
    ),
    session_photo_count = (
      select count(*) from public.photos
      where spot_id = p_spot_id and kind = 'session' and status = 'published'
    )
  where s.id = p_spot_id;
$$;

-- Statement-level with a transition table, not FOR EACH ROW: a single statement
-- touching N rows of one spot would otherwise recount N times, and bulk cleanup
-- (or the cascade when a spot is deleted) would multiply that across the table.
-- Recounting each affected spot once per statement is both correct and cheaper.
create or replace function public.trg_recount_spots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recount_spot(spot_id)
  from (
    select spot_id from changed_rows
    union
    select spot_id from changed_rows
  ) affected
  group by spot_id;
  return null;
end;
$$;

-- Separate insert/update/delete triggers because a transition table can only
-- reference NEW rows on insert and OLD rows on delete; update needs both, since
-- a status flip changes which spot's counts are stale only for that same spot.
create or replace function public.trg_recount_spots_upd()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recount_spot(spot_id)
  from (
    select spot_id from old_rows
    union
    select spot_id from new_rows
  ) affected
  group by spot_id;
  return null;
end;
$$;

create trigger signals_recount_ins after insert on public.signals
  referencing new table as changed_rows
  for each statement execute function public.trg_recount_spots();
create trigger signals_recount_del after delete on public.signals
  referencing old table as changed_rows
  for each statement execute function public.trg_recount_spots();
create trigger signals_recount_upd after update on public.signals
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.trg_recount_spots_upd();

create trigger comments_recount_ins after insert on public.comments
  referencing new table as changed_rows
  for each statement execute function public.trg_recount_spots();
create trigger comments_recount_del after delete on public.comments
  referencing old table as changed_rows
  for each statement execute function public.trg_recount_spots();
create trigger comments_recount_upd after update on public.comments
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.trg_recount_spots_upd();

create trigger photos_recount_ins after insert on public.photos
  referencing new table as changed_rows
  for each statement execute function public.trg_recount_spots();
create trigger photos_recount_del after delete on public.photos
  referencing old table as changed_rows
  for each statement execute function public.trg_recount_spots();
create trigger photos_recount_upd after update on public.photos
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.trg_recount_spots_upd();
