# Project status

**Last updated:** 2026-08-10 · **Branch:** `foundation`, tracking `origin/main` ·
**Tests:** 240 passing across 29 files

Photospots is a map of photography locations, cultivated by local photographers. Design lives in
[`superpowers/specs/2026-08-09-photospots-design.md`](superpowers/specs/2026-08-09-photospots-design.md).

**Read [`ENGINEERING-NOTES.md`](ENGINEERING-NOTES.md) before writing code.** Every entry there is a
bug this project already hit.

---

## What works

| Milestone | Plan | State |
| --- | --- | --- |
| 1 · Foundation | [`foundation`](superpowers/plans/2026-08-09-photospots-foundation.md) | ✅ Schema, RLS, auth, pure domain layer |
| 2 · Explore | [`explore`](superpowers/plans/2026-08-10-photospots-explore.md) | ✅ Viewport map, filters, three views, detail page |
| 3 · Contribution | [`contribution`](superpowers/plans/2026-08-10-photospots-contribution.md) | ✅ Submission, duplicate check, photo upload, editing |
| 4 · Voting & comments | not written | ⬜ Next |
| 5 · Filters & views polish | not written | ⬜ |
| 6 · Trust & moderation | not written | ⬜ |

Concretely, you can: browse a map of seeded Grand Rapids spots, filter by shoot type, switch between
split/map/gallery views, open a spot page, sign in with a magic link, submit a new spot with photos
after a duplicate check, and edit what you submitted.

### Database

Eight migrations. Functions: `spots_in_viewport`, `spot_by_slug`, `spots_within_meters`,
`create_spot`, `cast_signal`, `claim_studio`, `slug_exists`, `recount_spot`, `is_admin`,
`enforce_photo_cap`, plus trigger functions.

### Application

```
app/domain/    pure, no I/O — scoring (score, hot, weights, signal-weight),
               geo (bounds, distance), filters, spots (slug, submission)
app/data/      profiles, spots (read), spot-writes
app/lib/       env.server, supabase.server, photo-url, photo-upload.client
app/components/ map/SpotMap, explore/SpotCard, explore/ExploreLayout
app/routes/    home (explore), submit, spots.$slug, spots.$slug.edit, auth.*
scripts/       seed-grand-rapids, backfill-scores, refresh-hot-scores
```

---

## Running it

Requires Node 20+ and Docker.

```bash
npm install
npx supabase start
npx supabase status -o env   # copy into .env, see .env.example
npm run seed
npm run dev
```

Studio `http://127.0.0.1:54323` · Mailpit (magic-link emails) `http://127.0.0.1:54324` ·
app `http://localhost:5173`.

`docker` is not on the default PATH on this machine:

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

| Command | Purpose |
| --- | --- |
| `npm test` | Everything |
| `npm run test:unit` | Pure domain, no Docker, ~120 ms |
| `npm run test:db` | Database and RLS, needs Supabase running |
| `npm run typecheck` / `npm run build` | Must both be clean before committing |
| `npx supabase db reset` | Replay all migrations from empty |
| `npm run seed` | Six Grand Rapids spots with placeholder photos (idempotent) |
| `npm run backfill:scores` / `npm run refresh:hot` | Recompute derived rankings |

---

## Blocked

**Hosted Supabase.** `npx supabase login` has not been run, so there is no hosted project. Until
then:

- Production runs on **placeholder** `SUPABASE_URL` / `SUPABASE_ANON_KEY`. The site renders but
  sign-in cannot work.
- Live at https://photospots-arpo2u6zp-iamluisjs-projects.vercel.app

**To finish the deploy** once logged in: create/link a hosted project, `supabase db push` all eight
migrations, set the real `SUPABASE_URL` and `SUPABASE_ANON_KEY` on Vercel
(`vercel env add … production`), redeploy, and verify sign-in end to end against it.

Vercel is already linked (project `photospots`, org `iamluisjs-projects`, GitHub repo connected).
**A push to `main` triggers a production deploy automatically.**

---

## Next: plan 4 — voting and comments

Milestone 4 in spec §13. Most of the hard part is already built and tested:

- **`cast_signal(p_spot_id, p_kind, p_shoot_type_id, p_value)`** exists, is granted to
  `authenticated`, and changes a vote atomically. Spec §9.2 requires this: a client-side
  delete-then-insert is two round trips with no transaction, and a failed second step silently
  discards the vote the optimistic UI already redrew.
- **Counters** are maintained by statement-level triggers; `spots.score` is written by the command
  layer via `computeScore`.
- **Comments** table, RLS policies and grants exist. Authors cannot un-remove admin-moderated
  content — `status` is admin-only in both grants and policies.

What plan 4 needs to add: vote and comment UI on the spot detail page, a comments data layer,
optimistic UI with rollback (treating a duplicate-vote `23505` as success, per spec §9.2), and
wiring `spots.score` to update when a signal changes.

---

## Known gaps, deliberately deferred

- **Orphaned storage objects are never swept.** Photos upload before the spot exists (spec §10), so
  an abandoned submission leaves files behind. Spec calls for a periodic sweep; needs a scheduled
  job like `refresh:hot`.
- **`refresh:hot` is not scheduled anywhere.** It works and is tested; nothing runs it. Spec §7
  specifies a scheduled Node job, explicitly *not* pg_cron — computing decay in SQL would duplicate
  the ranking rules in a second language.
- **Photos cannot be replaced on an existing spot.** Editing covers text fields and gallery links.
- **`MAP_STYLE_URL` defaults to MapLibre's demo tiles**, which are development-only. Production needs
  Protomaps or MapTiler — both bill flat rather than per map load, which matters for a free browsing
  product.
- **No server-side clustering.** The viewport RPC caps at 500 rows; fine until a single view holds
  more than that.
- **Sponsorships / ads are unbuilt by design.** The data model leaves the seam (spec §4.1).

---

## Working agreements

- **TDD.** Write the failing test, watch it fail *for the right reason*, then implement.
- **Verify empirically.** Run the code, query the database, script the flow. Do not assert something
  works because it looks right.
- **Plans live in `docs/superpowers/plans/`**, written with the `superpowers:writing-plans` skill and
  executed with `superpowers:executing-plans`. Keep the plan in sync when the implementation
  deviates — several bugs were caught precisely because plan and code were compared.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and explain
  *why*, not just what.
- Do not commit `.env`. `.env.example` is the tracked template.
