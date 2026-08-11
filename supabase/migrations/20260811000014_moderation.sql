-- Moderation needs a write path that does not exist. `status` is deliberately
-- absent from the column grants on spots — it is moderation state and must not
-- be writable by the submitter — but `admin` is a value in profiles.role, not a
-- Postgres role, and every signed-in user is the same `authenticated` role. So
-- "grant UPDATE on spots.status to admins" is not expressible, and an admin
-- attempting it gets `42501 permission denied for table spots`. Verified
-- against the running database before writing this.
--
-- The alternative — making status writable and relying on a policy — is the
-- "policies authorize rows, grants authorize columns" trap in
-- docs/ENGINEERING-NOTES.md, which is how a user could once promote themselves
-- to admin. So: a definer function that checks is_admin() itself.
--
-- One function rather than two writes, for the reason cast_signal exists.
-- Hiding the content and closing the report are two rows; done as two calls, a
-- failure between them leaves the content hidden with the report still open
-- (the admin does the work twice) or the report closed over live content (the
-- report is lost). Both move together or neither does.
create or replace function public.resolve_report(
  p_report_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_type public.report_target;
  v_target_id uuid;
  -- The action and the stored status are not the same word: the actions are
  -- `hide` and `remove`, the enum values are `hidden` and `removed`. Casting
  -- the action straight to the enum raises 22P02, which is how this was found.
  v_status text;
begin
  -- Re-checked here rather than trusted from the caller: this function runs as
  -- its owner and is the only thing standing between `authenticated` and
  -- spots.status.
  if not public.is_admin() then
    raise exception 'only an admin may resolve a report';
  end if;

  -- Before the cast below, not after. `p_action::public.spot_status` raises on
  -- a bad value anyway, but by then the target may already have been touched —
  -- and the error would name a cast rather than the mistake.
  if p_action not in ('hide', 'remove', 'dismiss') then
    raise exception 'unknown resolution action: %', p_action;
  end if;

  select r.target_type, r.target_id
    into v_target_type, v_target_id
  from public.reports r
  where r.id = p_report_id
  for update;

  if v_target_id is null then
    raise exception 'no such report';
  end if;

  -- Hide exists only for spots: spots.status is spot_status
  -- (published | hidden | removed) while photos and comments are
  -- content_status (published | removed). Fail rather than storing something
  -- adjacent to what was asked for.
  if p_action = 'hide' and v_target_type <> 'spot' then
    raise exception 'only a spot can be hidden; % supports remove or dismiss', v_target_type;
  end if;

  if p_action <> 'dismiss' then
    v_status := case p_action when 'hide' then 'hidden' else 'removed' end;

    if v_target_type = 'spot' then
      update public.spots
         set status = v_status::public.spot_status
       where id = v_target_id;
    elsif v_target_type = 'photo' then
      update public.photos
         set status = v_status::public.content_status
       where id = v_target_id;
    elsif v_target_type = 'comment' then
      update public.comments
         set status = v_status::public.content_status
       where id = v_target_id;
    end if;
  end if;

  -- Cast written out: a CASE over text literals is text, and assigning that to
  -- an enum column is 42804 rather than an implicit cast.
  update public.reports
     set status = (case when p_action = 'dismiss' then 'dismissed' else 'resolved' end)
                    ::public.report_status,
         resolved_by = auth.uid()
   where id = p_report_id;
end;
$$;

revoke execute on function public.resolve_report(uuid, text) from public;
grant execute on function public.resolve_report(uuid, text) to authenticated;

-- The queue's read path.
--
-- Separate from spot_by_slug rather than loosening it: every public query
-- filters status = 'published', which is what makes a hidden spot disappear —
-- including from the admin who just hid it and now cannot review the decision.
-- Loosening the public path would put a moderation concern in front of every
-- visitor; this keeps it in one admin-only function.
--
-- target_title is a best effort: reports.target_id is polymorphic with no
-- foreign key, so a deleted target leaves the report pointing at nothing and
-- the title comes back null rather than dropping the row. An orphaned report
-- still has to be dismissable.
create or replace function public.admin_report_queue()
returns table (
  id uuid,
  target_type public.report_target,
  target_id uuid,
  target_title text,
  target_status text,
  reason text,
  note text,
  status public.report_status,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin may read the report queue';
  end if;

  return query
    select
      r.id, r.target_type, r.target_id,
      case r.target_type
        when 'spot' then (select s.name from public.spots s where s.id = r.target_id)
        when 'comment' then (select left(c.body, 120) from public.comments c where c.id = r.target_id)
        when 'photo' then (select p.storage_path from public.photos p where p.id = r.target_id)
      end,
      case r.target_type
        when 'spot' then (select s.status::text from public.spots s where s.id = r.target_id)
        when 'comment' then (select c.status::text from public.comments c where c.id = r.target_id)
        when 'photo' then (select p.status::text from public.photos p where p.id = r.target_id)
      end,
      r.reason, r.note, r.status, r.created_at
    from public.reports r
    order by (r.status = 'open') desc, r.created_at desc;
end;
$$;

revoke execute on function public.admin_report_queue() from public;
grant execute on function public.admin_report_queue() to authenticated;

-- spot_by_slug gains created_by and owner_profile_id so the detail page can
-- stop offering "Edit this spot" to everyone. Plan 5 turned that silent no-op
-- into an error message; this is what lets the link disappear instead.
--
-- DROP first. A create-or-replace that changes the return type fails outright
-- rather than overloading, but the drop discards the grants either way, so they
-- are rewritten below. Body is migration 7's, with two columns added.
drop function if exists public.spot_by_slug(text);

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
  created_by uuid,
  owner_profile_id uuid,
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
    s.locality, s.region,
    s.created_by, s.owner_profile_id,
    s.score, s.hot_score,
    s.shoot_type_upvote_count, s.shoot_again_yes_count, s.shoot_again_no_count,
    s.comment_count, s.scouting_photo_count, s.session_photo_count,
    s.cost_type, s.cost_notes, s.permit_url, s.hours_notes,
    s.best_light, s.best_seasons, s.walk_minutes, s.parking_notes,
    s.terrain, s.accessibility, s.max_group_size, s.dog_friendly
  from public.spots s
  where s.slug = p_slug and s.status = 'published'
$$;

revoke execute on function public.spot_by_slug(text) from public;
grant execute on function public.spot_by_slug(text) to anon, authenticated, service_role;
