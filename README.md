# Photospots

A map of photography locations, cultivated by local photographers.

Photographers find shoot locations through Google searches and tribal knowledge. Instagram geotags
don't solve it: there's no map view, and a geotag can't tell you whether a spot needs a permit, when
the light is good, or whether grandparents can manage the walk from the parking lot.

The driving case is a family booking a session. They or their photographer have a vague idea —
"beach photos" — and have to turn it into a specific public location that will actually work. Today
that conversion depends on knowing a local photographer. Photospots makes that knowledge queryable.

Launching in Grand Rapids, Michigan. Built for the US generally; nothing in the code is
Grand-Rapids-specific.

## Status

**In development — the foundation is being built task by task.** Not yet deployed, and there is no
UI to look at.

| | |
| --- | --- |
| ✅ Pure domain layer | Scoring, time decay, geography — 38 tests, no database |
| ✅ Database foundation | Profiles, shoot types, auth trigger, RLS test harness |
| 🔨 In progress | Spots schema, contribution tables, counters, row-level security |
| ⬜ Next | Supabase client, auth routes, score backfill |

Design and implementation plan live in [`docs/superpowers/`](docs/superpowers/).

## How it works

**Two kinds of photo.** *Scouting shots* show what a place looks like — the meadow, the parking lot,
the gravel path, the light at 7pm. Phone snaps are fine; useful beats pretty. *Session photos* are
real client work shot there, which is what actually persuades a family. Those carry a photographer
credit and a link back, and require an explicit rights attestation at upload.

**Votes are signals, not a counter.** There are no downvotes. An upvote is scoped to a shoot type,
because a park isn't good or bad in the abstract — it's good for engagement photos and bad for
toddlers. Separately, "would you shoot here again?" A spot's score is a weighted aggregate over all
of them, and *hot* is the same signals with time decay, so a freshly shot spot can surface above an
established favourite.

**Duplicates are prevented, not merged.** Dropping a pin checks for existing spots within ~200 m
*before* showing the form and asks "is it one of these?" — turning a rejection into a contribution.

## Requirements

- Node 20+
- Docker, for the local Supabase stack

## Setup

```bash
npm install
```

```bash
npx supabase start
```

Copy the printed values into `.env` using [`.env.example`](.env.example) as the template
(`npx supabase status -o env` reprints them). Then:

```bash
npm run dev
```

Local Supabase Studio runs at `http://127.0.0.1:54323`, and Mailpit — where magic-link emails
land — at `http://127.0.0.1:54324`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Everything |
| `npm run test:unit` | Pure domain tests — fast, no Docker needed |
| `npm run test:db` | Database and RLS tests — requires `npx supabase start` |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `npx supabase db reset` | Replay all migrations from empty |

## Layout

```
app/domain/    pure functions, no I/O — scoring and geography live here
app/routes/    thin loaders and actions
supabase/      migrations: schema, triggers, row-level security
tests/db/      integration and RLS tests against local Supabase
app/data/      (planned) Supabase queries; database types won't escape here
```

The organising rule: **every rule worth testing lives in a pure function that never touches a
database.** That's why `npm run test:unit` runs in well under a second with no fixtures, no network,
and no Docker.

## Conventions

**Tunables are a named exported constant plus an optional trailing parameter that overrides it** —
`DEFAULT_WEIGHTS`/`weights`, `HOT_HALF_LIFE_DAYS`/`halfLifeDays`,
`DUPLICATE_RADIUS_METERS`/`radiusMeters`. This is what lets every domain module be tested at its
edges without fixtures.

**Scoring weights are configuration**, in `app/domain/scoring/weights.ts`. They are deliberately
tunable, which is why score is stored rather than computed on read — changing them will require a
backfill run to recompute every stored score.

**Database types will stay in `app/data/`.** The domain layer defines its own shapes; mapping
functions belong in the data layer, pointing inward.

**Authorization lives in the database.** Row-level security carries the rules rather than
application `if` statements. Two things that are easy to get wrong and are documented in the
migrations: RLS *filters* access but does not *grant* it, so every table also needs explicit
`GRANT`s; and policies authorize rows while only column grants authorize columns — which is what
stops a user editing their own `role`.

## History

This repository previously held an Expo mobile prototype (2020–21), preserved at the
[`legacy-expo-mvp`](https://github.com/IAmLuisJ/Photospot/tree/legacy-expo-mvp) tag.
