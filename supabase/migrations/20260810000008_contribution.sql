-- Uploads happen BEFORE the spot exists (spec §10: a failed upload must not be
-- able to leave a photo-less spot), so a path cannot be keyed by spot id.
-- Keying by uploader gives the policy something to check and stops one user
-- writing into another's folder.
create policy "signed-in users upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'spot-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users manage their own uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'spot-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Spec §4.2 caps hosted photos per spot. Enforced as a trigger rather than in
-- the command layer, so it holds for anything that reaches the table — the API
-- directly, a future import script, a careless migration.
--
-- Removed photos do not count: an admin takedown should free the slot rather
-- than jam the spot permanently.
create or replace function public.enforce_photo_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_cap constant integer := 6;
begin
  select count(*) into v_count
  from public.photos
  where spot_id = new.spot_id
    and kind = new.kind
    and status = 'published';

  if v_count >= v_cap then
    raise exception 'photo cap reached: at most % published % photos per spot', v_cap, new.kind
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger photos_enforce_cap
  before insert on public.photos
  for each row execute function public.enforce_photo_cap();

revoke execute on function public.enforce_photo_cap() from public;

-- One transaction for the spot, its shoot types and its photos (spec §10).
-- SECURITY INVOKER so RLS still decides who may write; the function supplies
-- atomicity, not privilege. created_by comes from auth.uid(), so a caller
-- cannot attribute a submission to someone else.
create or replace function public.create_spot(
  p_name text,
  p_kind public.spot_kind,
  p_lng double precision,
  p_lat double precision,
  p_slug text,
  p_description text,
  p_locality text,
  p_region text,
  p_shoot_type_ids integer[],
  p_photos jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_spot_id uuid;
  v_photo jsonb;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to submit a spot';
  end if;
  if coalesce(array_length(p_shoot_type_ids, 1), 0) = 0 then
    raise exception 'a spot needs at least one shoot type';
  end if;
  if jsonb_array_length(coalesce(p_photos, '[]'::jsonb)) = 0 then
    raise exception 'a spot needs at least one photo';
  end if;

  insert into public.spots (
    kind, name, slug, description, location, created_by, locality, region
  )
  values (
    p_kind, p_name, p_slug, nullif(p_description, ''),
    extensions.st_point(p_lng, p_lat)::extensions.geography,
    auth.uid(), nullif(p_locality, ''), nullif(p_region, '')
  )
  returning id into v_spot_id;

  insert into public.spot_shoot_types (spot_id, shoot_type_id)
  select v_spot_id, unnest(p_shoot_type_ids);

  for v_photo in select * from jsonb_array_elements(p_photos)
  loop
    insert into public.photos (
      spot_id, profile_id, kind, storage_path, caption,
      rights_attested, credit_name, credit_url
    )
    values (
      v_spot_id,
      auth.uid(),
      (v_photo ->> 'kind')::public.photo_kind,
      v_photo ->> 'storage_path',
      nullif(v_photo ->> 'caption', ''),
      coalesce((v_photo ->> 'rights_attested')::boolean, false),
      nullif(v_photo ->> 'credit_name', ''),
      nullif(v_photo ->> 'credit_url', '')
    );
  end loop;

  return v_spot_id;
end;
$$;

revoke execute on function public.create_spot(text, public.spot_kind, double precision, double precision, text, text, text, text, integer[], jsonb) from public;
grant execute on function public.create_spot(text, public.spot_kind, double precision, double precision, text, text, text, text, integer[], jsonb) to authenticated;

-- Is a slug already taken? Callable by anyone signed in, so the submission form
-- can resolve a collision before it tries to insert.
create or replace function public.slug_exists(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.spots where slug = p_slug)
$$;

revoke execute on function public.slug_exists(text) from public;
grant execute on function public.slug_exists(text) to authenticated, service_role;
