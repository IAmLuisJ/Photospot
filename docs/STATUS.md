# Project status

**Last updated:** 2026-08-10 · **Branch:** `foundation`, tracking `origin/main` ·
**Tests:** 333 passing across 37 files

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
| 4 · Voting & comments | [`signals`](superpowers/plans/2026-08-10-photospots-signals.md) | ✅ Per-shoot-type upvotes, shoot-again, comments, score wiring |
| 5 · Filters & views polish | not written | ⬜ Next |
| 6 · Trust & moderation | not written | ⬜ |

Concretely, you can: browse a map of seeded Grand Rapids spots, filter by shoot type, switch between
split/map/gallery views, open a spot page, sign in with a magic link, submit a new spot with photos
after a duplicate check, edit what you submitted, upvote a spot for a particular kind of shoot,
answer "would you shoot here again?" (and change or clear that answer), and leave a comment. Vote
and comment counts are visible to logged-out visitors; casting either requires an account.

### Database

Ten migrations. Functions: `spots_in_viewport`, `spot_by_slug`, `spot_signal_summary`,
`spots_within_meters`, `create_spot`, `cast_signal`, `claim_studio`, `slug_exists`, `recount_spot`,
`is_admin`, `enforce_photo_cap`, plus trigger functions.

### Application

```
app/domain/    pure, no I/O — scoring (score, hot, weights, signal-weight),
               geo (bounds, distance), filters, spots (slug, submission),
               signals (vote-state), comments (comment)
app/data/      profiles, spots (read), spot-writes, signals, comments, scores
app/lib/       env.server, supabase.server, photo-url, photo-upload.client
app/components/ map/SpotMap, explore/SpotCard, explore/ExploreLayout,
               spot/VotePanel, spot/CommentThread
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

## Next: plan 5 — filters and remaining views

Milestone 5 in spec §13. Partly built already:

- **`parseExploreFilters` already handles `type`, `sort` and `view`** and round-trips them through
  the URL, so filter state is shareable today.
- **The viewport RPC already takes `p_shoot_type_id` and `p_sort`**, so shoot-type filtering and the
  score/hot sort orders work end to end.

What plan 5 needs to add: the attribute filters (cost, terrain, accessibility, walk time, dog
friendly — all real nullable columns, indexable, per spec §4.7), the map-dominant and gallery
arrangements behind `?view=`, and the mobile collapse to a full-screen map with a draggable results
sheet. The three views share one loader and one URL filter state by design (spec §8).

Worth folding in: **`signals.profile_id` is readable by `anon`**, so anyone can enumerate which
profile voted on which spot. `signals_read` is `using (true)` and vote *counts* are meant to be
public, but the per-person ballot is not. Found while reviewing plan 4; it belongs to milestone 6
(trust and moderation) unless it is wanted sooner.

## Known gaps, deliberately deferred

- **`spots.score` can go one vote stale under concurrency.** The refresh is read-then-write, so two
  votes landing together can both read the same counters and write the same score. The counters are
  never wrong — the recount trigger is statement-level and runs inside the vote's own transaction —
  so this is a stale derived number, not lost data, and `npm run backfill:scores` repairs it. Making
  it atomic would mean doing the arithmetic in SQL, a second copy of the weights in a second
  language, which is the drift spec §7 exists to prevent.
- **Voting and commenting need `SUPABASE_SERVICE_ROLE_KEY` in the app environment**, not just for
  scripts, because `spots.score` is deliberately not writable by `authenticated`. It is optional in
  `readEnv` so its absence cannot take down the whole site, and `createSupabaseAdminClient` throws
  at the point it is actually needed. A vote still succeeds if the refresh fails; the error is
  logged with the repair command rather than shown to the user, since the vote did land.
- **Comment bylines show the UTC date.** A comment posted at 8pm Eastern reads as the next day. The
  format is deliberately not locale-formatted, because that renders differently for the reader than
  for the test — but the honest fix is the viewer's own timezone, which SSR cannot know and so needs
  client-side work. One line to change once a date policy is chosen.
- **`comments.body` has no length limit a user would notice.** The schema ceiling is 10000
  characters as an abuse guard; the 2000-character product limit lives in TypeScript, so a direct
  API call can store a comment four times longer than the form allows. Deliberate — the two numbers
  have different jobs — but worth knowing before someone reports a very long comment.
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
