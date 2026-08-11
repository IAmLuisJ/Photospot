-- create_spot gains the practical attributes, so a spot is findable from the
-- moment it is submitted rather than only after someone remembers to edit it.
-- That matters most for the spots nobody ever edits.
--
-- DROP first, not CREATE OR REPLACE. Postgres keys functions by their argument
-- list, so a replace with different parameters creates a *second overload* and
-- leaves PostgREST unable to choose between them — with the old one still
-- serving existing callers, which is the version that silently ignores the new
-- arguments. The drop takes the grants with it, so they are rewritten below.
--
-- The old signature is spelled out exactly as pg_proc reports it; a mismatch
-- here is a no-op drop and two live overloads.
drop function if exists public.create_spot(
  text, public.spot_kind, double precision, double precision, text, text, text, text,
  integer[], jsonb
);

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
  p_photos jsonb,
  p_cost_type text default null,
  p_walk_minutes integer default null,
  p_accessibility text[] default null,
  p_terrain text[] default null,
  p_dog_friendly boolean default null
)
returns uuid
language plpgsql
security invoker
-- `''`, matching the original. Every reference below is schema-qualified for
-- that reason, including extensions.st_point.
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
    kind, name, slug, description, location, created_by, locality, region,
    cost_type, walk_minutes, accessibility, terrain, dog_friendly
  )
  values (
    p_kind, p_name, p_slug, nullif(p_description, ''),
    extensions.st_point(p_lng, p_lat)::extensions.geography,
    auth.uid(), nullif(p_locality, ''), nullif(p_region, ''),
    -- nullif before the cast, so a form left on "Not sure" sends '' and stores
    -- null rather than failing the enum cast.
    nullif(p_cost_type, '')::public.cost_type,
    p_walk_minutes,
    -- Passed through as given: an empty array is "none of these apply" and
    -- null is "nobody said", and both are real answers (spec §4.7).
    p_accessibility,
    p_terrain,
    p_dog_friendly
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

revoke execute on function public.create_spot(
  text, public.spot_kind, double precision, double precision, text, text, text, text,
  integer[], jsonb, text, integer, text[], text[], boolean
) from public;

grant execute on function public.create_spot(
  text, public.spot_kind, double precision, double precision, text, text, text, text,
  integer[], jsonb, text, integer, text[], text[], boolean
) to authenticated;
