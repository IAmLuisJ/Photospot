# Project status

**Last updated:** 2026-08-11 · **Branch:** `foundation`, tracking `origin/main` ·
**Tests:** 509 passing across 52 files

**Launch tracker:** [`Progress.html`](Progress.html) — milestones, and what is left before this
can be shown to anyone.

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
| 5 · Filters & views | [`filters`](superpowers/plans/2026-08-11-photospots-filters.md) | ✅ Attribute filters, remembered view, gallery tab, mobile sheet |
| 6 · Trust & moderation | [`trust`](superpowers/plans/2026-08-11-photospots-trust.md) | ✅ Reports, admin queue, moderation, studio claims |

Concretely, you can: browse a map of seeded Grand Rapids spots, filter by shoot type, switch between
split/map/gallery views, open a spot page, sign in with a magic link, submit a new spot with photos
after a duplicate check, edit what you submitted, upvote a spot for a particular kind of shoot,
answer "would you shoot here again?" (and change or clear that answer), and leave a comment. Vote
and comment counts are visible to logged-out visitors; casting either requires an account.

You can also record the practical detail — cost, walk from parking, what it takes to get around,
what is underfoot, whether dogs are welcome — at submission or by editing, and then narrow the map
by any of it. Every filtered view is a shareable URL, the chosen view is remembered between visits,
and on a phone all three views collapse to a full-screen map with a draggable results sheet.

Anyone signed in can report a spot, photo or comment, and an admin can act on those reports at
`/admin` — hide, remove or dismiss, with the target's status and the report closing together. A
hidden spot leaves the map and its page 404s. Studio listings have their own page at
`/studios/:slug` with rate and booking link, and an owner can claim one by signing in with the
address on the listing.

**That completes the six MVP milestones.** What remains before launch is not code — see
[`Progress.html`](Progress.html).

### Database

Fourteen migrations. Functions: `spots_in_viewport`, `spot_by_slug`, `spot_signal_summary`,
`spots_within_meters`, `create_spot`, `cast_signal`, `claim_studio`, `slug_exists`, `recount_spot`,
`is_admin`, `enforce_photo_cap`, `resolve_report`, `admin_report_queue`, plus trigger functions.

`spots_in_viewport`, `create_spot` and `spot_by_slug` were **dropped and recreated** to change their
signatures, not replaced. Postgres keys functions by their argument list, so `create or replace` with different
parameters leaves two overloads live and PostgREST unable to choose. Check with
`select proname, count(*) from pg_proc … having count(*) > 1` after touching either.

### Application

```
app/domain/    pure, no I/O — scoring (score, hot, weights, signal-weight),
               geo (bounds, distance), filters (explore, attribute),
               spots (slug, submission, attributes), signals (vote-state),
               comments (comment), explore (results-sheet)
app/data/      profiles, spots (read), spot-writes, signals, comments, scores
app/lib/       env.server, supabase.server, photo-url, photo-upload.client,
               view-preference.server
app/components/ map/SpotMap, explore/SpotCard, explore/ExploreLayout,
               explore/FilterBar, explore/ResultsSheet,
               spot/VotePanel, spot/CommentThread, spot/AttributeFields,
               spot/ReportButton, admin/ReportRow
app/routes/    home (explore), submit, spots.$slug, spots.$slug.edit,
               studios.$slug, admin, auth.*
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

- Production runs on **placeholder** `SUPABASE_URL` / `SUPABASE_ANON_KEY`, and the homepage is
  therefore a **500**, not a degraded map. Measured against the live deployment, not inferred:
  `/` → 500, `/auth/login` → 200, `/submit` and `/admin` → 302 to login. The home loader queries
  Supabase on every request and `listSpotsInViewport` throws, which reaches the root
  `ErrorBoundary` because `home.tsx` has none of its own.
- Live at https://photospots.vercel.app — the per-deployment URLs are behind Vercel's
  deployment protection and redirect to a Vercel login.

**Worth deciding separately from the credentials:** a database outage taking the homepage to 500 is
the same class of failure spec §10 rules out for tiles ("list, filters, and detail pages keep
working with a degraded map"). Real credentials fix today's 500; they do not make the homepage
survive Supabase being briefly unreachable.

**To finish the deploy** once logged in: create/link a hosted project, `supabase db push` all
fourteen migrations, set the real `SUPABASE_URL` and `SUPABASE_ANON_KEY` on Vercel
(`vercel env add … production`), redeploy, and verify sign-in end to end against it.

Vercel is already linked (project `photospots`, org `iamluisjs-projects`, GitHub repo connected).
**A push to `main` triggers a production deploy automatically.**

---

## Next: launch, not code

**The six MVP milestones are complete.** Every remaining item is in
[`Progress.html`](Progress.html), which is the tracker to work from. The two that gate everything:

1. **The hosted Supabase deploy** — still Blocked above. Nothing can be verified in production
   until it exists, and the environment needs three variables, not two:
   `SUPABASE_SERVICE_ROLE_KEY` is required because `spots.score` is deliberately not writable by
   ordinary users and the server refreshes it with the service role. Deploying without it looks
   fine until the first vote.
2. **Cold-start seeding.** Spec §14 names this the dominant risk and it is not a software risk:
   the map is worthless with twenty spots and useful with two hundred. Six exist. Budget real time
   for 30–50 Grand Rapids spots with real photographs *before* any friend sees the site.

Also needed before launch: a real `MAP_STYLE_URL`. The default is MapLibre's demo tiles, which are
development-only.

## Known gaps, deliberately deferred

- **`signals.profile_id` is readable by `anon`**, so anyone can enumerate which profile voted on
  which spot. `signals_read` is `using (true)` and vote *counts* are meant to be public, but the
  per-person ballot is not. Deliberately left out of plan 6: it is a privacy fix to a policy every
  page reads, and deserves its own change with its own verification.
- **Reports have no rate limit.** One angry user can file fifty, and the queue is the only thing
  that makes that visible. Knowing what limit to set needs the queue in use first.
- **A report whose target is deleted keeps only `dismiss`.** `reports.target_id` is polymorphic with
  no foreign key, so the row survives its target and the queue must still be clearable.
- **No moderation audit log.** `reports.resolved_by` records who closed each report, which is the
  accountability the MVP needs; a full history of every status change is not built.
- **Filters exclude spots whose data is missing, and the count cannot say which.** A filter
  promising a short walk correctly hides spots with no walk time recorded — but the "N spots do not
  match" notice mixes those with spots that genuinely do not match, because the summary rows do not
  carry the attribute values. Distinguishing them needs either a second aggregate query or widening
  the RPC's return.
- **The hidden-spots count is capped at 500**, like the query itself, so it undercounts on a busy
  viewport. It is worded as a hint rather than a figure for that reason.
- **No index backs the attribute filters, on purpose.** Measured at 5000 synthetic spots: the GIST
  viewport index does the work, and a GIN index on `accessibility` is used by the planner but buys
  ~11% against a write cost on every `UPDATE` to `spots` — which now happens on every vote. The
  numbers are in migration 13. Revisit when one viewport really holds thousands of spots.
- **Following a shared `?view=` link overwrites your remembered view.** The loader cannot tell a
  click from a shared link, because the view buttons set the same search parameter; separating them
  would cost a round trip on every view switch.
- **The results list is rendered twice** — once for the desktop panes and once for the mobile sheet
  — with CSS hiding one. `display: none` keeps the hidden copy out of the accessibility tree, so
  the cost is DOM size rather than duplicate announcements.
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
