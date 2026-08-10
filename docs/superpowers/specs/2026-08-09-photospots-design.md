# Photospots — Design Spec

**Date:** 2026-08-09
**Status:** Approved, ready for implementation planning

---

## 1. Problem

Photographers find shoot locations through Google searches and tribal knowledge. Instagram geotags
do not solve this: there is no map view, and a geotag tells you nothing about whether a spot needs a
permit, when the light is good, or whether grandparents can make the walk from the parking lot.

The driving use case is a family booking a photo session. The family or their photographer has a
vague idea — "beach photos" — and must convert it into a specific public location that will actually
work. That conversion currently depends on knowing a local photographer.

Photospots makes that local knowledge queryable: a map of real shoot locations, cultivated by local
photographers and models, with the practical detail that determines whether a location works.

## 2. Audience

Two audiences with different needs, served by one map.

- **Contributors** — local photographers and models. They submit spots, upload photos, vote, and
  comment. They are the supply side and the source of the product's value.
- **Consumers** — families and photographers scouting for a booked session. They browse, filter, and
  compare. They arrive from a shared link as often as from the homepage.

**Launch market:** Grand Rapids, Michigan, with the author's photographer friends as first users.
The product is built for the US generally; nothing is Grand Rapids specific in the code.

## 3. Scope

### In scope for MVP

- Authentication (Google and email magic link), user profiles
- Spot submission, editing, and duplicate prevention
- Two spot kinds: outdoor locations and indoor studios
- Three explore views (split, map-dominant, gallery) with shoot-type and attribute filters
- Spot detail: hosted photos, outbound gallery links, comments, votes
- The signal/score/hot ranking system
- Reports and takedown requests with a minimal admin queue
- Studio listings, claimable by their owner

### Explicitly out of scope

- Paid sponsorships and ad serving — the data model leaves the seam, the feature waits for traffic
- Pre-publish moderation queues
- Threaded comments, notifications, email digests
- Saved lists, favorites, collections
- Any photographer-booking marketplace or payments
- Native mobile apps

## 4. Product decisions

### 4.1 Studios are a kind of spot, and monetization is staged

An indoor studio is a location on the same map, with an hourly rate where an outdoor spot has a
permit fee. Studios list themselves for free from day one: this builds inventory and content while
the map is thin. Paid boosting and sponsored placement come later, once there is traffic worth
selling, and arrive as a flag on an entity that already exists rather than as a second subsystem.

Because studios have an owner who can edit their listing and public parks do not, **listing ownership
is modeled from the start** (`spots.owner_profile_id`). Retrofitting ownership is painful.

### 4.2 Two kinds of photo

- **Scouting photos** — what the place looks like. The meadow, the parking lot, the gravel path, the
  light at 7pm. Often phone snaps. Cheap to post; usefulness beats beauty. A spot without these is
  unusable, so the submission form requires at least one photo.
- **Session photos** — actual client work shot at the location. This is what persuades a family, and
  it is portfolio work, so the photographer gets a byline and a link back. That byline is also the
  organic growth loop: the client sees the credit and finds the site.

Photos are **hosted by Photospots**, not scraped from links. For a product whose pitch is visual
exploration, link previews break, load slowly, and look inconsistent.

Hosting is capped per spot (configurable; MVP default 6 scouting + 6 session). Full session galleries
live off-site as **outbound gallery links**, which bounds storage cost and gives photographers the
link-back they want anyway.

### 4.3 Photo rights

Session photos are pictures of real families, frequently including children, on a public site. Three
requirements, in MVP, non-negotiable:

1. An explicit attestation at upload: "I shot this and I have the right to post it"
   (`photos.rights_attested`, required for `kind = 'session'`).
2. Photographer attribution on every session photo (`credit_name`, `credit_url`).
3. A working takedown path, handled through the same reports queue.

### 4.4 Votes are signals, not a counter

There are **no downvotes**. The vote primitive is scoped to a shoot type, because a park is not good
or bad in the abstract — it is good for engagement photos and bad for toddlers.

Signal kinds at MVP:

- `shoot_type_upvote` — an upvote scoped to one shoot type. One per user per spot per shoot type.
- `shoot_again` — "would you shoot here again?", yes or no. One per user per spot.

Comments and photo uploads are activity that feeds ranking but are not rows in `signals`; they are
counted from their own tables.

### 4.5 Two rankings, not one

- **Score** — lifetime weighted aggregate of all signals. Answers "what are the best spots."
- **Hot** — the same signals, time-decayed over a trailing window. Answers "what is happening now,"
  so a freshly shot spot can surface even when an established location outranks it lifetime.

These are distinct sort orders and are named distinctly in the UI.

### 4.6 Trust and moderation

- Browsing and the map are fully open to logged-out visitors. A family arriving from their
  photographer's link must never hit a signup wall.
- Submitting, voting, and commenting require an account.
- **Spots publish immediately.** A review queue only the author can clear becomes a bottleneck the
  moment the product works, and spam risk at Grand Rapids scale is negligible. Revisit when opening a
  second city.
- Spots are editable by their submitter and by admins. Studio listings are editable by the claiming
  owner. Wiki-style open editing is not needed yet.
- Duplicates are prevented at submission time rather than merged later (see §9.1).

### 4.6a Account deletion

A user can delete their account, and doing so must not destroy other people's work. Deleting an
account removes the auth user and cascades to their profile; **content they contributed survives
with an anonymous author** (`created_by` and `owner_profile_id` become null). Photo attribution
follows the same rule.

The alternatives are both worse: cascading would delete spots that other photographers have since
photographed, commented on, and voted for, and blocking deletion — which is what a plain foreign key
does by default — makes account deletion impossible for exactly the users who contributed most.

### 4.7 Optional metadata

Most spot attributes are nullable. The filter set will change based on user feedback, so the
submission form stays short and only `name`, location, one shoot type, and one photo are required.

Optional attributes are **real nullable columns, not a JSONB blob**: nullable columns in Postgres are
effectively free, they are indexable for filtering (which is the entire purpose of these fields), they
cannot drift in shape, and `ALTER TABLE ADD COLUMN` is non-breaking.

## 5. Architecture

**Stack:** React Router v7 (framework mode) · Supabase (Postgres + PostGIS, Auth, Storage, RLS) ·
MapLibre GL with Protomaps or MapTiler vector tiles · deployed to Vercel.

Map tiles are deliberately not Google or Mapbox: both bill per map load, which is the wrong cost
shape for a free browsing product whose core interaction is panning around.

Four layers, with one organizing principle: **every rule worth testing lives in a pure function that
never touches a database.**

### Routes — thin

`/` (explore) · `/spots/:id` · `/submit` · `/studios/:id` · `/admin`

Loaders call query modules; actions call command modules. Logic accumulating in a route file is a
signal it belongs in the domain layer.

### Domain — pure, no I/O

- `scoring` — signals and counters to score; time-decayed hot ranking. Weights are configuration.
- `geo` — viewport to bounding box, clustering, distance, duplicate proximity.
- `filters` — URL search params to and from a typed filter object.
- `validation` — submission and photo-rights schemas (zod).

These are plain functions over plain data, unit-testable in milliseconds with no database, no
network, and no fixtures. Since scoring weights are expected to be tuned, testing ranking changes as
a pure function is a direct benefit.

### Data access — one module per aggregate

`spots` · `signals` · `photos` · `comments` · `studios` · `reports`

Typed queries in, domain objects out. Supabase's generated types stay behind this boundary and never
leak into routes or domain code, so a future migration off Supabase has a blast radius of one
directory.

The spots query takes a **photo depth** argument, because gallery view needs several photos per spot
at higher resolution while split view needs one thumbnail.

### Client

The MapLibre component knows nothing about data fetching. It receives spots and emits viewport
changes, which keeps the fiddliest piece swappable and independently testable.

## 6. Data model

### `profiles`
`id` (= `auth.users.id`) · `display_name` · `role` (user | admin) · `avatar_url?` · `bio?` ·
`website_url?` · `instagram?`

### `spots`
`id` · `kind` (outdoor | studio) · `name` · **`slug`** · `description` ·
`location` `geography(Point, 4326)` with a GIST index · `locality` (city) · `region` (US state) ·
`created_by` → profiles · `owner_profile_id?` → profiles ·
`status` (published | hidden | removed) · `score` · `hot_score` · trigger-maintained `*_count`
counters · `created_at` · `updated_at`

Optional attributes: `cost_type?` (free | park_pass | permit_required | hourly_rate | negotiated) ·
`cost_notes?` · `permit_url?` · `hours_notes?` · `best_light[]?` · `best_seasons[]?` ·
`walk_minutes?` · `parking_notes?` · `terrain[]?` · `accessibility[]?` · `max_group_size?` ·
`dog_friendly?`

### `shoot_types`
`id` · `slug` · `label` · `sort_order`

Seeded: family, engagement, senior portrait, maternity, newborn, headshot, wedding, branding, pets.

### `spot_shoot_types`
`spot_id` → spots · `shoot_type_id` → shoot_types

What a spot is good for. This is the primary filter and it is indexed in both directions.

### `signals`
`id` · `spot_id` → spots · `profile_id` → profiles · `kind` (shoot_type_upvote | shoot_again) ·
`shoot_type_id?` → shoot_types · `value` smallint · `created_at`

`value` semantics: `shoot_type_upvote` is always `1` (there are no downvotes). `shoot_again` is `1`
for yes and `0` for no.

`shoot_type_id` is required when `kind = 'shoot_type_upvote'` and null when `kind = 'shoot_again'`,
enforced by a check constraint.

One-vote-per-person is enforced by:

```sql
UNIQUE NULLS NOT DISTINCT (spot_id, profile_id, kind, shoot_type_id)
```

`NULLS NOT DISTINCT` is required and is not the default. Postgres normally treats NULLs as distinct
in unique constraints, so a plain `UNIQUE` would enforce nothing for `shoot_again` rows — where
`shoot_type_id` is null — and a user could vote repeatedly.

Adding a vote type later is a new enum value, not a new table and a new code path.

### `photos`
`id` · `spot_id` → spots · `profile_id` → profiles · `kind` (scouting | session) · `storage_path` ·
`caption?` · `shoot_type_id?` · `rights_attested` bool · `credit_name?` · `credit_url?` ·
`width?` · `height?` · `blurhash?` · `status` · `created_at`

Capped per spot by configuration. `rights_attested` must be true when `kind = 'session'`.

### `spot_gallery_links`
`id` · `spot_id` → spots · `profile_id` → profiles · `url` · `title` · `shoot_type_id?`

### `comments`
`id` · `spot_id` → spots · `profile_id` → profiles · `body` · `status` · `created_at`

Flat, not threaded.

### `studio_details` (1:1 extension of `spots`)
`spot_id` (PK, → spots) · `hourly_rate_cents?` · `booking_url?` · `contact_email?` · `claimed_by?` ·
`claimed_at?`

A separate table so park rows do not carry empty studio columns.

### `reports`
`id` · `target_type` (spot | photo | comment) · `target_id` · `profile_id` · `reason` · `note?` ·
`status` (open | resolved | dismissed) · `resolved_by?` · `created_at`

Covers both abuse reports and photo takedown requests.

### `sponsorships` — deferred, not built in MVP
`spot_id` → spots · `tier` · `starts_at` · `ends_at`

## 7. Ranking implementation

Score must be sortable in SQL but its weights must be testable in TypeScript. Resolving that tension:

1. **Postgres triggers maintain dumb counters** on `spots` — upvotes per shoot type, shoot-again yes
   and no, comment count, photo count. No weighting logic in SQL.
2. **The command layer computes the weighted score in TypeScript** via `domain/scoring` and writes
   `spots.score` in the same transaction as the signal write.
3. **`hot_score` is refreshed on a 15-minute schedule by a Node job, not by pg_cron.** Hot rankings
   do not need to be real-time, which avoids an event-log table entirely: the job scans
   signals/comments/photos within the trailing window and calls `computeHotScore`.

   The scheduler must not be pg_cron, despite the convenience. pg_cron runs SQL, and computing
   `hot_score` in SQL would mean reimplementing the decay curve and the weights there — a second
   copy of the ranking rules, in a second language, free to drift from `domain/scoring`. That is
   precisely the failure point 1 exists to prevent. The job is a scheduled Node process mirroring
   `scripts/backfill-scores.ts`: same service-role write path, same weights, same tested functions.

A **backfill script that recomputes all scores** is built early, because it runs every time weights
are tuned.

**The weight-mapping seam.** `computeScore` applies weights internally, but `computeHotScore` takes
events whose weights the caller has already applied. So the hot-refresh job must map signal kind to
weight somewhere, and a fresh `switch (kind)` written there is the single most likely place for the
two rankings to drift apart after a re-weighting — the exact failure point 1 exists to prevent.
Whichever plan builds the refresh job must route that mapping through one shared
`weightForSignalKind(kind, weights)` in `domain/scoring`, not reimplement it.

Initial weights (configuration, expected to change):

| Signal | Weight |
| --- | --- |
| `shoot_type_upvote` | +1.0 |
| `shoot_again` = yes | +2.0 |
| `shoot_again` = no | −1.5 |
| comment | +0.5 |
| scouting photo | +1.0 |
| session photo | +1.5 |

`hot_score` applies the same weights with exponential time decay, half-life 14 days, over a trailing
90-day window.

## 8. Surfaces

### Explore (`/`)

Three views, selected by a `?view=` parameter and remembered per user. All three are the same map and
results components in different arrangements, fed by the same loader and the same URL filter state.

- **`split` (default)** — map beside a synced result list. Hovering a card lifts its pin and vice
  versa. Answers "where" and "is this any good" simultaneously; neither gets full room. This is a
  deliberate compromise between the scouting photographer, who wants the map, and the browsing
  family, who wants the pictures.
- **`map`** — map-dominant with a scrolling photo rail along the bottom.
- **`gallery`** — photo grid with the map behind a tab.

On mobile all three collapse to a full-screen map with a draggable results sheet, so the view choice
is desktop-only.

**Filter and viewport state live in the URL.** Every view is therefore a shareable link, letting a
photographer send a family "here are the family-photo spots near you" as a single URL. This is a
distribution channel and it is nearly free if designed in now.

### Spot detail (`/spots/:id`)

Scouting photos, session photos with photographer credit, outbound gallery links, the optional
attributes that were filled in, per-shoot-type vote counts, "would you shoot here again" results, and
comments.

### Submit (`/submit`), Studio (`/studios/:id`), Admin (`/admin`)

See §9.1 for submission. Studio pages add rate, booking link, and an owner claim flow. Admin is a
single reports queue with hide and remove actions.

## 9. Key flows

### 9.1 Submission

1. **Drop a pin** on the map at the current viewport; address search as a fallback.
2. **Duplicate check runs here, before the form.** `ST_DWithin` at a configurable radius (MVP: 200m),
   same `kind`. If neighbors exist, show them as thumbnails and ask "is it one of these?" Choosing one
   routes the user to adding a photo or comment on the existing spot. The user contributes either way.
3. **Short form** — name, pin, at least one shoot type, at least one photo. All other attributes are
   optional and collapsed behind "add details."

   **Slugs are globally unique**, because `/spots/:slug` is a flat URL space. Scoping uniqueness to
   locality is not viable — `locality` and `region` are both nullable. So the submission flow
   generates one: slugify the name, and on collision append the slugified locality, then a short
   discriminator. "Millennium Park" will genuinely recur across cities, so this path is normal, not
   exceptional.
4. **Photos** upload direct-to-Storage via signed URL, downscaled client-side first. Scouting or
   session is chosen per photo; session photos require the rights attestation and offer credit fields.
5. **Publishes immediately** — live, reportable, editable by submitter and admin.

Placing the gate at step 2 rather than at review time converts a rejection into a contribution.

### 9.2 Voting

Optimistic UI with rollback on failure. A unique-constraint violation from a duplicate vote is
**treated as success**: double-clicking an upvote is a no-op, not an error toast.

**Changing a vote needs an atomic RPC, not delete-then-insert.** `signals` has no UPDATE privilege
and the unique constraint rejects a second insert, so flipping a "would you shoot here again?"
answer means deleting the row and inserting a new one. Done from the client that is two round trips
with no transaction: a delete that succeeds followed by an insert that fails silently discards the
user's vote, and the optimistic UI would have already shown the new state. Whichever plan builds
voting must expose a single `cast_signal(spot_id, kind, shoot_type_id, value)` function that does
both inside one transaction.

### 9.3 Studio claim

Email verification against the listing's `contact_email`, which sets `claimed_by` and
`owner_profile_id`.

**Claiming is a command, not a row write.** Neither `claimed_by` nor `owner_profile_id` is writable
through the API by `authenticated`; a `security definer` `claim_studio()` function sets both after
confirming the caller's own verified email matches the listing contact. Allowing the columns to be
written directly would let any signed-in user claim any unclaimed studio — first come, first served,
across every listing at once — while also blocking the legitimate case of submitting a studio with
contact details and no claim.

### 9.4 Reports and takedown

Both use the `reports` table and the admin queue. Resolution actions are hide and remove.

**Moderation must not be reversible by the author.** `status` is admin-only: it is absent from the
column grants, and the update policies additionally require the row to be `published` for
non-admins, so an author can neither edit nor un-remove content after it has been removed.
Column-scoping alone is insufficient here, because admins are `authenticated` too.

## 10. Failure handling

- **Map panning** — debounce, snap the bounding box to a coarse grid so small pans reuse a query,
  abort in-flight requests on a new pan, and discard stale responses. Without the last step, results
  flicker back to a previous viewport.
- **Partial submission** — photos upload to Storage *first*, then a single action creates the spot
  and photo rows together. Creating the spot first would allow a failed upload to leave a photo-less
  spot, violating the one-photo requirement. Storage objects orphaned by abandoned submissions are
  swept by a periodic job.
- **Tile failures** must not take down the page: list, filters, and detail pages keep working with a
  degraded map.
- **Viewport result caps** — results per viewport are capped, with server-side clustering at low zoom.

## 11. Security and privacy

- **Row-level security carries the authorization rules**, not application `if` statements: submitter
  and admin can edit a spot, studio owner can edit their listing, anyone can read published spots.
- **RLS filters access; it does not grant it.** Every table also needs explicit `GRANT`s to `anon`
  and `authenticated`, or those roles get `42501 permission denied` before a policy is consulted.
  This is not automatic: Supabase's default grants cover tables owned by `supabase_admin`, but
  migrations run as `postgres`, whose default ACL confers no SELECT/INSERT/UPDATE/DELETE.
- **Policies authorize rows; column grants authorize columns.** Where a row-level policy would
  otherwise expose a field it shouldn't — a user editing their own profile must not be able to set
  their own `role`, since `is_admin()` reads it — the protection has to be a column-scoped `GRANT`.
  The same applies to derived columns like `spots.score`.
- Photo rights attestation and attribution as described in §4.3.
- A working takedown path from day one.

## 12. Testing strategy

- **Domain logic** (`scoring`, `geo`, `filters`, `validation`) — dense unit test coverage, no
  database, no fixtures. This is where the product's rules live.
- **Data access** — integration tests against a local Supabase instance with seeded fixtures.
- **RLS policies** — their own explicit test suite. These are security rules; "the policy looks
  right" is not adequate assurance.
- **End-to-end** — one Playwright smoke path: submit a spot, vote on it, comment on it.
- **Map component** — kept dumb enough that testing its props contract is sufficient.

## 13. Implementation sequencing

The MVP is too large for one undifferentiated build. Suggested milestones, each independently
demonstrable:

1. **Foundation** — project scaffold, Supabase local dev, schema and migrations, RLS policies, seeded
   `shoot_types`, auth with both providers, profiles.
2. **Read-only explore** — spots query with viewport bounding box, MapLibre component, split view,
   spot detail page. Seeded by hand so there is something to look at.
3. **Contribution** — submission flow with duplicate check, photo upload and cap enforcement, gallery
   links, editing.
4. **Signals** — voting, comments, counters, score and hot computation, backfill script, sort orders.
5. **Filters and remaining views** — shoot-type and attribute filters, URL state, map and gallery views.
6. **Trust** — reports, admin queue, takedown handling, studio claim flow.

Milestone 2 is the point at which the cold-start seeding work in §14 can begin in parallel.

## 14. Risks

**Cold start is the dominant risk, and it is not a software risk.** This product is worthless with
twenty spots and useful with two hundred. The application will be finished long before the map is.
Budget real time for personally seeding 30–50 Grand Rapids spots, with real photos, *before* any
friend sees the site. A new user who opens the map and finds four pins does not return, and no amount
of good architecture compensates.

**Secondary risks:**

- The split view serves both audiences adequately and neither perfectly. Mitigated by shipping all
  three views; watch which one people actually use.
- Photo storage cost grows with adoption. Mitigated by the per-spot cap and outbound gallery links.
- Scoring weights are guesses. Mitigated by keeping them in configuration with a backfill script.
