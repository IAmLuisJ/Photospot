create type public.signal_kind  as enum ('shoot_type_upvote', 'shoot_again');
create type public.photo_kind   as enum ('scouting', 'session');
-- Named for the concept, not its first user. photos, comments and any future
-- moderatable table share it; calling it photo_status made `comments.status
-- public.photo_status` read like a mistake.
create type public.content_status as enum ('published', 'removed');
create type public.report_status as enum ('open', 'resolved', 'dismissed');
create type public.report_target as enum ('spot', 'photo', 'comment');

create table public.spot_shoot_types (
  spot_id uuid not null references public.spots (id) on delete cascade,
  shoot_type_id integer not null references public.shoot_types (id),
  primary key (spot_id, shoot_type_id)
);

create index spot_shoot_types_by_type on public.spot_shoot_types (shoot_type_id, spot_id);

grant select, insert, delete on public.spot_shoot_types to service_role;
alter table public.spot_shoot_types enable row level security;

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  -- Cascade, unlike every other profile_id below. A vote is not content
  -- someone authored for others to read — it is a ballot, and a ballot cast
  -- by a person who no longer has an account is not worth preserving
  -- anonymously. Cascading also frees the (spot_id, kind, shoot_type_id) slot
  -- in signals_one_per_user, which SET NULL would not: two anonymized rows
  -- with the same spot/kind/shoot_type_id would collide on the unique
  -- constraint on the very next insert.
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind public.signal_kind not null,
  shoot_type_id integer references public.shoot_types (id),
  value smallint not null,
  created_at timestamptz not null default now(),

  -- Upvotes are always +1 and always carry a shoot type.
  -- Shoot-again is yes(1)/no(0) and never carries one.
  constraint signals_shape check (
    (kind = 'shoot_type_upvote' and shoot_type_id is not null and value = 1)
    or
    (kind = 'shoot_again' and shoot_type_id is null and value in (0, 1))
  ),

  -- NULLS NOT DISTINCT is required, not stylistic. Postgres treats NULLs as
  -- distinct in unique constraints by default, which would let a user cast
  -- unlimited shoot_again votes since their shoot_type_id is null.
  constraint signals_one_per_user
    unique nulls not distinct (spot_id, profile_id, kind, shoot_type_id)
);

create index signals_spot_idx on public.signals (spot_id);
-- The hot-score refresh (spec §7) scans a trailing 90-day window across all
-- spots, so it needs created_at leading, not spot_id.
create index signals_recent_idx on public.signals (created_at desc);

-- select, insert, delete only: signals_one_per_user has no legitimate use for
-- update, by design (see the comment on that constraint) — changing a vote is
-- delete-then-insert, not update. select is needed for the account-deletion
-- test to confirm a deleted user's votes are gone, not merely anonymized.
grant select, insert, delete on public.signals to service_role;
alter table public.signals enable row level security;

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  -- Nullable with ON DELETE SET NULL, matching spots.created_by (spec §4.6a,
  -- extended by §4.6a's "photo attribution follows the same rule"): a photo
  -- is content other people rely on, so it survives account deletion with an
  -- anonymous author instead of vanishing or blocking the deletion.
  profile_id uuid references public.profiles (id) on delete set null,
  kind public.photo_kind not null,
  storage_path text not null unique,
  caption text,
  shoot_type_id integer references public.shoot_types (id),
  rights_attested boolean not null default false,
  credit_name text,
  credit_url text,
  width integer,
  height integer,
  blurhash text,
  status public.content_status not null default 'published',
  created_at timestamptz not null default now(),

  -- Spec §4.3: session photos show identifiable people and cannot be
  -- posted without an explicit rights attestation.
  constraint photos_session_requires_rights
    check (kind <> 'session' or rights_attested)
);

create index photos_spot_idx on public.photos (spot_id, kind);
create index photos_recent_idx on public.photos (created_at desc);

grant select, insert, update, delete on public.photos to service_role;
alter table public.photos enable row level security;

create table public.spot_gallery_links (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  -- Same reasoning as photos.profile_id: an external gallery link is content
  -- someone contributed, and it survives their account being deleted.
  profile_id uuid references public.profiles (id) on delete set null,
  url text not null,
  title text not null,
  shoot_type_id integer references public.shoot_types (id),
  created_at timestamptz not null default now()
);

create index spot_gallery_links_spot_idx on public.spot_gallery_links (spot_id);

grant select, insert, update, delete on public.spot_gallery_links to service_role;
alter table public.spot_gallery_links enable row level security;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  -- Same reasoning as photos.profile_id. Comments are flat, not threaded, but
  -- they are still content other visitors read; deleting the author's
  -- account should not delete the comment out from under that context.
  profile_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(trim(body)) > 0),
  status public.content_status not null default 'published',
  created_at timestamptz not null default now()
);

create index comments_spot_idx on public.comments (spot_id, created_at desc);
create index comments_recent_idx on public.comments (created_at desc);

grant select, insert, update, delete on public.comments to service_role;
alter table public.comments enable row level security;

create table public.studio_details (
  spot_id uuid primary key references public.spots (id) on delete cascade,
  hourly_rate_cents integer check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  booking_url text,
  contact_email text,
  -- Mirrors spots.owner_profile_id (task 8, spec §4.6a): claiming is what
  -- sets owner_profile_id on the spot row (spec §9.3), and this is the same
  -- relationship recorded on the 1:1 extension table. If the claiming
  -- photographer deletes their account, the studio reverts to unclaimed
  -- rather than blocking the deletion or dragging the listing's business
  -- details (hourly_rate_cents, booking_url, contact_email) down with it.
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.studio_details to service_role;
alter table public.studio_details enable row level security;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_type public.report_target not null,
  target_id uuid not null,
  -- The reporter. Nullable with ON DELETE SET NULL rather than the default
  -- NO ACTION, for the same reason as every other profile_id here: a plain
  -- FK would make account deletion fail for anyone who had ever filed a
  -- report — exactly the task-8 bug, one table over. CASCADE was considered
  -- and rejected: an open report is a moderation record the admin queue still
  -- needs to act on, and letting it vanish because the reporter closed their
  -- account would let deleting an account double as deleting the evidence of
  -- what was reported. So it survives anonymized, like authored content.
  profile_id uuid references public.profiles (id) on delete set null,
  reason text not null,
  note text,
  status public.report_status not null default 'open',
  -- The admin who resolved it. Already nullable (a report may be unresolved);
  -- ON DELETE SET NULL for the same audit-preserving reason as profile_id
  -- above — an admin's account being deleted should not block deletion or
  -- erase the resolution record, just the identity behind it.
  resolved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index reports_open_idx on public.reports (status, created_at desc);

grant select, insert, update, delete on public.reports to service_role;
alter table public.reports enable row level security;
