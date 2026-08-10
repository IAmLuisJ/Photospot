alter table public.profiles           enable row level security;
alter table public.shoot_types        enable row level security;
alter table public.spots              enable row level security;
alter table public.spot_shoot_types   enable row level security;
alter table public.signals            enable row level security;
alter table public.photos             enable row level security;
alter table public.spot_gallery_links enable row level security;
alter table public.comments           enable row level security;
alter table public.studio_details     enable row level security;
alter table public.reports            enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Base privileges. RLS FILTERS access, it does not GRANT it: with no table
-- privilege, anon and authenticated get 42501 permission denied before any
-- policy is ever consulted, and every policy below would be inert.
--
-- This is NOT handled automatically. Supabase's default grants apply to tables
-- owned by supabase_admin; migrations run as postgres, whose default ACL gives
-- anon and authenticated only Dxtm (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) —
-- no SELECT/INSERT/UPDATE/DELETE. Verified against pg_default_acl on 17.6.
--
-- anon gets SELECT and nothing else: browsing is open to logged-out visitors,
-- contributing requires an account (spec §4.6).

grant select on public.shoot_types        to anon, authenticated;
grant select on public.profiles           to anon, authenticated;
grant select on public.spots              to anon, authenticated;
grant select on public.spot_shoot_types   to anon, authenticated;
grant select on public.signals            to anon, authenticated;
grant select on public.photos             to anon, authenticated;
grant select on public.spot_gallery_links to anon, authenticated;
grant select on public.comments           to anon, authenticated;
grant select on public.studio_details     to anon, authenticated;

grant insert                 on public.spots              to authenticated;
grant insert, delete         on public.spot_shoot_types   to authenticated;
grant insert, delete         on public.signals            to authenticated;
grant insert, update         on public.photos             to authenticated;
grant insert, delete         on public.spot_gallery_links to authenticated;
grant insert, update         on public.comments           to authenticated;
grant insert, select, update on public.reports            to authenticated;

-- studio_details: INSERT is table-wide (the policy constrains it to
-- claimed_by is null), but UPDATE is column-scoped so claimed_by/claimed_at
-- cannot be written through PostgREST at all — only claim_studio() sets them.
-- No DELETE: deleting and re-inserting was a claim-laundering path.
grant insert on public.studio_details to authenticated;
grant update (hourly_rate_cents, booking_url, contact_email)
  on public.studio_details to authenticated;

-- Reference data and profiles are public reads.
create policy shoot_types_read on public.shoot_types for select using (true);
create policy profiles_read    on public.profiles    for select using (true);
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- A user may edit their own profile but NOT their own `role`. The policy above
-- cannot express that — it authorises the ROW, not the columns. With a
-- table-wide UPDATE grant, any user could run
--     update profiles set role = 'admin' where id = auth.uid()
-- and is_admin() would return true for them from then on. Granting only the
-- editable columns is what actually closes the escalation.
grant update (display_name, avatar_url, bio, website_url, instagram)
  on public.profiles to authenticated;

-- Spots: anyone reads published; submitter, listing owner, or admin writes.
create policy spots_read on public.spots for select
  using (status = 'published' or created_by = auth.uid() or public.is_admin());

create policy spots_insert on public.spots for insert
  with check (created_by = auth.uid());

-- The status clauses prevent an author un-removing their own spot after an
-- admin removes it; see comments_update for the full reasoning.
create policy spots_update on public.spots for update
  using (
    public.is_admin()
    or ((created_by = auth.uid() or owner_profile_id = auth.uid()) and status = 'published')
  )
  with check (
    public.is_admin()
    or ((created_by = auth.uid() or owner_profile_id = auth.uid()) and status = 'published')
  );

-- Derived columns (score, hot_score, the counters) are maintained by triggers
-- and by the command layer running with elevated rights. Users may never set
-- them directly, so UPDATE is granted per column and never table-wide. No
-- REVOKE is needed first: the default ACL grants authenticated no UPDATE at
-- all, so there is nothing to take away.
-- `status` and `owner_profile_id` are deliberately absent. status is moderation
-- state, guarded by the policy above and settable only by an admin.
-- owner_profile_id is set by claim_studio(), per spec §9.3 — leaving it here
-- would let anyone assign themselves ownership of any listing directly.
grant update (
  name, slug, description, kind, location, locality, region,
  cost_type, cost_notes, permit_url, hours_notes,
  best_light, best_seasons, walk_minutes, parking_notes, terrain,
  accessibility, max_group_size, dog_friendly, updated_at
) on public.spots to authenticated;

create policy spot_shoot_types_read on public.spot_shoot_types for select using (true);
create policy spot_shoot_types_write on public.spot_shoot_types for all
  using (
    exists (select 1 from public.spots s
            where s.id = spot_id and (s.created_by = auth.uid() or public.is_admin()))
  )
  with check (
    exists (select 1 from public.spots s
            where s.id = spot_id and (s.created_by = auth.uid() or public.is_admin()))
  );

-- Signals: public counts, but you may only cast your own vote.
create policy signals_read on public.signals for select using (true);
create policy signals_insert on public.signals for insert
  with check (profile_id = auth.uid());
create policy signals_delete on public.signals for delete
  using (profile_id = auth.uid());

create policy photos_read on public.photos for select
  using (status = 'published' or profile_id = auth.uid() or public.is_admin());
create policy photos_insert on public.photos for insert
  with check (profile_id = auth.uid());
-- Same moderation-reversal guard as comments_update below.
create policy photos_update on public.photos for update
  using (public.is_admin() or (profile_id = auth.uid() and status = 'published'))
  with check (public.is_admin() or (profile_id = auth.uid() and status = 'published'));

create policy gallery_links_read on public.spot_gallery_links for select using (true);
create policy gallery_links_insert on public.spot_gallery_links for insert
  with check (profile_id = auth.uid());
create policy gallery_links_delete on public.spot_gallery_links for delete
  using (profile_id = auth.uid() or public.is_admin());

create policy comments_read on public.comments for select
  using (status = 'published' or profile_id = auth.uid() or public.is_admin());
create policy comments_insert on public.comments for insert
  with check (profile_id = auth.uid());
-- The `status = 'published'` clauses are what stop an author reversing
-- moderation. Without them the author keeps UPDATE on `status`, so an admin
-- removes abusive content and its author sets it straight back to published.
-- USING sees the old row and WITH CHECK the new one, so requiring published in
-- both makes removed content untouchable by its author in either direction.
-- Column-scoping cannot solve this, because admins are `authenticated` too.
create policy comments_update on public.comments for update
  using (public.is_admin() or (profile_id = auth.uid() and status = 'published'))
  with check (public.is_admin() or (profile_id = auth.uid() and status = 'published'));

-- Studio listings. A `for all` policy would be wrong in BOTH directions: on
-- INSERT only WITH CHECK applies, so `claimed_by = auth.uid()` would (a) let any
-- authenticated user claim any studio just by inserting a row naming themselves
-- — first-come-first-served on a spot_id primary key, scriptable across every
-- studio in the database, bypassing the §9.3 email verification entirely — and
-- (b) block the legitimate flow, where someone submits a studio with contact
-- details and no claim at all.
--
-- Claiming is a verified command, not a row write. `claimed_by` is therefore not
-- writable through PostgREST by anyone: it is set only by claim_studio() below,
-- which runs security definer after checking the verified email. Same reasoning
-- the plan already applies to spots.score.
create policy studio_details_read on public.studio_details for select using (true);

create policy studio_details_insert on public.studio_details for insert
  with check (
    claimed_by is null
    and exists (
      select 1 from public.spots s
      where s.id = spot_id and s.kind = 'studio'
        and (s.created_by = auth.uid() or public.is_admin())
    )
  );

create policy studio_details_update on public.studio_details for update
  using (claimed_by = auth.uid() or public.is_admin())
  with check (claimed_by = auth.uid() or public.is_admin());

-- No DELETE policy. Deleting was previously reachable by the claimant, which
-- allowed claim laundering: delete the row, then re-insert it claimed by
-- someone else. Studio details die with their spot via the cascade.

-- The claim itself. Spec §9.3: verification is against the listing's
-- contact_email, so the caller must have that address confirmed on their own
-- auth account. Runs security definer because claimed_by/owner_profile_id are
-- deliberately not writable by `authenticated`.
create or replace function public.claim_studio(p_spot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact text;
  v_verified boolean;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to claim a listing';
  end if;

  select d.contact_email into v_contact
  from public.studio_details d
  where d.spot_id = p_spot_id and d.claimed_by is null
  for update;

  if v_contact is null then
    raise exception 'listing is not claimable';
  end if;

  select (u.email = v_contact and u.email_confirmed_at is not null)
    into v_verified
  from auth.users u
  where u.id = auth.uid();

  if not coalesce(v_verified, false) then
    raise exception 'claim requires a confirmed email matching the listing contact';
  end if;

  update public.studio_details
     set claimed_by = auth.uid(), claimed_at = now()
   where spot_id = p_spot_id;

  update public.spots
     set owner_profile_id = auth.uid()
   where id = p_spot_id;
end;
$$;

grant execute on function public.claim_studio(uuid) to authenticated;

-- Reports: anyone signed in may file one; only admins may read the queue.
create policy reports_insert on public.reports for insert
  with check (profile_id = auth.uid());
create policy reports_admin_read on public.reports for select
  using (public.is_admin());
create policy reports_admin_update on public.reports for update
  using (public.is_admin()) with check (public.is_admin());
