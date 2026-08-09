-- Into `extensions`, where Supabase keeps pgcrypto and uuid-ossp, not `public`.
-- This is effectively a one-way door: once task 8 creates geography columns,
-- relocating postgis means `drop extension postgis cascade`, which drops them.
-- Resolution is covered in both directions — the `postgres` role's search_path
-- is "$user", public, extensions, and PostgREST runs with
-- PGRST_DB_EXTRA_SEARCH_PATH=public,extensions.
create extension if not exists postgis with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  avatar_url text,
  bio text,
  website_url text,
  instagram text,
  created_at timestamptz not null default now()
);

-- Tables created by migrations are owned by `postgres`; PostgREST roles get
-- no privileges on them by default (only objects owned by `supabase_admin`
-- pick up such a default ACL). `service_role` has BYPASSRLS but is not a
-- superuser, so it still needs an explicit grant to be readable/writable
-- here. `anon`/`authenticated` grants are deliberately withheld until task 11
-- adds row-level security — granting them now would leave these tables fully
-- open to the public with no RLS in place.
grant select, insert, update, delete on public.profiles to service_role;

-- Enabled here rather than in task 11 so the table fails CLOSED for the four
-- tasks in between. Without it, safety rests entirely on the absence of grants,
-- and adding a grant early would silently expose the table.
alter table public.profiles enable row level security;

create table public.shoot_types (
  id serial primary key,
  slug text not null unique,
  label text not null,
  sort_order integer not null default 0
);

insert into public.shoot_types (slug, label, sort_order) values
  ('family',          'Family',          10),
  ('engagement',      'Engagement',      20),
  ('senior-portrait', 'Senior Portrait', 30),
  ('maternity',       'Maternity',       40),
  ('newborn',         'Newborn',         50),
  ('headshot',        'Headshot',        60),
  ('wedding',         'Wedding',         70),
  ('branding',        'Branding',        80),
  ('pets',            'Pets',            90);

grant select on public.shoot_types to service_role;
alter table public.shoot_types enable row level security;

-- A profile row must exist for every auth user; the app never creates one.
--
-- search_path is '' rather than 'public': pg_temp is searched ahead of public
-- for relation names, which is the classic way to shadow a table inside a
-- security definer function. Every reference below is schema-qualified, so the
-- stricter pin costs nothing.
--
-- The final literal keeps the coalesce total. email is nullable on auth.users,
-- and split_part(null, ...) is null — so a provider that withholds email (phone
-- auth, some OAuth) would otherwise violate display_name NOT NULL and break the
-- signup itself. Unreachable today; cheap to make impossible.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Photospots member'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
