# Engineering notes

Traps this codebase has already fallen into. **Every entry below was a real bug that shipped or
nearly shipped.** They are not style preferences — re-breaking any of them reintroduces a defect
that took real work to find.

Read this before writing a migration, a query, or a route.

---

## Postgres and RLS

### RLS filters access; it does not grant it

A policy decides *which rows* a role may touch. It does not give the role any privilege on the
table. With no `GRANT`, `anon` and `authenticated` get `42501 permission denied` before a policy is
ever consulted.

This is **not** handled automatically. Supabase's default grants apply to tables owned by
`supabase_admin`; migrations run as `postgres`, whose default ACL confers only
`Dxtm` (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) — no SELECT/INSERT/UPDATE/DELETE.

Every new table needs explicit grants. See `20260809000005_rls.sql`.

> **How it surfaced:** Task 11's entire policy set would have been inert. Its own tests asserted only
> that `error` was non-null, which a `42501` satisfies just as well as a real RLS denial — so they
> would have passed for completely the wrong reason.

### Assert `error.code`, not just that an error exists

Following from the above: `expect(error).not.toBeNull()` cannot distinguish a permission error from
the RLS denial you meant to test. Assert the SQLSTATE (`42501` permission, `23505` unique,
`23514` check).

### Policies authorize rows; column grants authorize columns

A row-level policy cannot stop a user editing a *particular column* of a row they legitimately own.

- `profiles_update_own` let a user edit their own row — including `role`. Since `is_admin()` reads
  `profiles.role`, any user could promote themselves to admin. Fixed with a column-scoped
  `GRANT UPDATE (display_name, avatar_url, …)` that omits `role`.
- The same shape protects `spots.score`, the counter columns, and `spots.status`.

### Changing a function's arguments means DROP, not `create or replace`

Postgres keys functions by their **argument list**. `create or replace function f(a, b, c)` where
`f(a, b)` already exists creates a *second overload*; it does not replace anything. PostgREST then
cannot choose between them, and the old one — the one that ignores your new arguments — keeps
serving existing callers.

So: `drop function f(<exact old argument types>)` first. Two consequences follow.

- **The drop takes the grants with it**, so the `revoke … from public` and every `grant` have to be
  rewritten in the same migration.
- **If the dropped signature does not match exactly, the drop is a silent no-op** and both versions
  go live. Read the real one out of the catalogue rather than reconstructing it:

  ```sql
  select oid::regprocedure from pg_proc where proname = 'spots_in_viewport';
  ```

Audit the whole schema after any such migration; the expected result is no rows:

```sql
select p.proname, count(*) from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' group by 1 having count(*) > 1;
```

### Functions are executable by `PUBLIC` unless revoked

Postgres grants `EXECUTE` on every new function to `PUBLIC`. Writing `grant execute … to
authenticated` restricts **nothing** — the default grant is still underneath.

Always `revoke execute on function … from public;` first, then grant.

> **How it surfaced:** `recount_spot` is `SECURITY DEFINER` and was callable by anonymous users — an
> unauthenticated write path into `spots`, the one table where UPDATE on counter columns is
> deliberately revoked.

Two follow-on subtleties:

- **`is_admin()` must be granted to `anon` too.** RLS policy expressions are evaluated with the
  querying role's privileges, and `spots_read` calls `is_admin()` on anonymous reads. Without the
  grant, every policy referencing it fails outright.
- **`service_role` still needs grants.** It has `BYPASSRLS` but is *not* a superuser. `BYPASSRLS`
  skips row policies, not the GRANT system. Revoking from `PUBLIC` takes the privilege from
  `service_role` as well.

### Foreign keys decide whether accounts can be deleted

A plain `references profiles(id)` is `NO ACTION`, so the `auth.users → profiles` cascade aborts and
**account deletion becomes impossible for exactly the users who contributed most.**

Convention here (spec §4.6a): authored content is `on delete set null` — it survives with an
anonymous author. Votes `cascade`, because a ballot is not content others read.

`signals.profile_id` **must** cascade, not set null: two anonymised rows would land on the same
`(spot_id, kind, shoot_type_id)` key, which the `NULLS NOT DISTINCT` constraint then rejects.

### Postgres `trim()` strips spaces only

`trim(x)` is `btrim(x, ' ')`. It is **not** the equivalent of JavaScript's `.trim()`, which strips
all Unicode whitespace. So `check (length(trim(body)) > 0)` accepts a body of `E'\n\t'`.

> **How it surfaced:** `comments` carried that check from milestone 1. Since `comments_insert`
> requires only `profile_id = auth.uid()`, any signed-in user could POST a newline straight to
> PostgREST: a blank comment that rendered, bumped `comment_count`, and was worth `weights.comment`
> in `computeScore`. Repeatable in a loop. Migration 10 replaced it with `body ~ '[^[:space:]]'`.

Two things worth knowing before writing the replacement:

- POSIX `[:space:]` **does** include U+00A0 here, contrary to the usual claim. Measure rather than
  assume — the two definitions still differ on U+FEFF and U+0085, in opposite directions.
- A limit that only the application enforces is not a limit. `MAX_PHOTOS_PER_KIND` is duplicated
  into `enforce_photo_cap()` precisely so the cap holds for anything reaching the table, and
  `comments.body` now carries a hard ceiling for the same reason. Keep the tunable product number
  in TypeScript and the abuse ceiling in the schema; they are two numbers with two jobs.

### `<@` and `&&` are one character apart and mean opposite things for empty arrays

Constraining a `text[]` to a vocabulary wants `<@` ("is contained by"). `&&` ("overlaps") is wrong
in both directions: it accepts any array holding at least one valid value, and it **rejects the
empty array**, because `'{}' && anything` is false.

That second half is the one that bites. `'{}'` is "none of these apply" and `null` is "nobody
said" — both legitimate answers for an optional attribute (spec §4.7). Measured here, `&&` could
not even be installed: two seeded spots record `accessibility = '{}'` and the `ALTER` failed on
them.

Related: **an array column with no vocabulary drifts silently.** Nothing stops one contributor
writing `wheelchair` and the next `Wheelchair accessible`, and a filter matching an exact string
then misses half the map with no error anywhere. The vocabulary lives in `app/domain/spots/
attributes.ts` and is mirrored by a check constraint — adding a value is deliberately two edits.

### SQL's three-valued logic already excludes unknowns from a filter

`null <= 20`, `null = any(...)` and `null @> array[...]` are all null, and a `WHERE` treats null as
not-matching. So a filter predicate excludes rows where the attribute is unknown **without any
explicit null check** — mutation-testing `s.walk_minutes is not null and …` showed removing it
changes nothing.

The exception is a boolean you are filtering *for*: `s.dog_friendly is true` excludes null, but
`s.dog_friendly is not false` includes it. That one is load-bearing and the mutation proves it.

### `UNIQUE NULLS NOT DISTINCT` is required, not stylistic

Postgres treats NULLs as distinct in unique constraints by default. `signals` allows one vote per
user per kind, and `shoot_again` votes have a null `shoot_type_id` — so a plain `UNIQUE` enforces
nothing and a user can vote unlimited times. Requires Postgres 15+; local runs 17.

### Prefer statement-level triggers with transition tables

`FOR EACH ROW` on a recount trigger is quadratic in the wrong place. Measured: a 200-row insert
across two spots fired **200** recounts as `FOR EACH ROW` versus **2** as `FOR EACH STATEMENT` with
`REFERENCING NEW TABLE`.

### `SECURITY DEFINER` functions pin `search_path = ''`

`pg_temp` is searched ahead of `public` for relation names, which is the classic shadowing vector.
Every reference inside such a function must be schema-qualified.

### PostGIS lives in the `extensions` schema

Not `public`. Moving it later requires `drop extension postgis cascade`, which drops every
`geography` column — so this is effectively a one-way door taken early.

Resolution works because the `postgres` role's `search_path` is `"$user", public, extensions`, and
PostgREST runs with `PGRST_DB_EXTRA_SEARCH_PATH=public,extensions`. Functions that call PostGIS
still pin `set search_path = public, extensions` so they don't depend on the caller.

---

## PostgREST / supabase-js

### `geography` serialises as hex EWKB

`select location` returns `0101000020E6100000…`, which no map library can read. Any query the client
needs coordinates from **must** be an RPC that projects `st_x`/`st_y` into plain doubles. See
`spots_in_viewport`, `spot_by_slug`, `spots_within_meters`.

### `numeric` arrives as a **string**

To avoid precision loss in JSON. `score` and `hot_score` must be `Number(...)`-ed in the mapping
layer or they sort and render as text.

### Bulk inserts union their keys and null the gaps

Given an array of objects, PostgREST takes the **union of keys** and explicitly sets missing ones to
`null` — **bypassing column defaults**. An object omitting `rights_attested` sends `null` and trips
its `NOT NULL` constraint.

**Every object in a bulk insert must carry the same keys.**

### An update that RLS forbids reports no error — it matches zero rows

`update … .eq("id", x)` against a row the policy excludes returns `error: null`. Nothing failed;
nothing happened. A route that treats "no error" as "saved" then redirects to a success page having
silently discarded everything the user typed.

`.select("id")` on the update is what turns that into an answer: zero rows back means not
permitted. `updateSpot` returns a boolean for exactly this reason.

> **How it surfaced:** the edit form was reachable by any signed-in user on any spot, because the
> detail page offers the link to everyone. Filling it in as a non-owner redirected to the spot page
> looking successful. Found by driving the form while verifying something else.

### supabase-js returns errors, it does not throw

`await supabase.from(…).insert(…)` without checking `error` fails silently.

> **How it surfaced:** the seed script reported "Seeded 6 spots" while every photo insert failed —
> six spots, zero photos, and nothing said so. The missing check was worse than the bug it hid.

### Write `status = 'published'` explicitly

Even though RLS enforces it. The RLS predicate is a *disjunction*
(`status='published' OR created_by=auth.uid() OR is_admin()`), which can never match a partial
index's predicate — so any `where status='published'` partial index is dead weight unless the query
also states the filter.

---

## React Router v8

The project is on **React Router 8**, not 7. Several APIs differ from v7 docs.

### Loaders return `data()`, never `Response.json()`

`import { data } from "react-router"` — it carries headers *and* keeps the loader return type
inferable. A raw `Response` is not inferable, so `loaderData` degrades to `unknown` and `meta()`
cannot read it.

### Every auth return path must carry `headers`

`supabase.auth.signInWithOtp` starts a PKCE exchange and writes a `code_verifier` cookie through the
client's `setAll`. Returning a bare object drops those headers, the verifier never reaches the
browser, and `/auth/callback` then fails to exchange the code — **the login silently does nothing.**

### In `meta()` the property is `loaderData`, not `data`

And it is optional on any route with an `ErrorBoundary`, because meta also runs for the error case.

### `maplibre-gl` v6 has no default export

`import maplibregl from "maplibre-gl"` fails with `TS1192`. Use named imports:
`import { Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl"`.

`@vercel/react-router` (the SSR preset) peer-depends on `@react-router/dev@7` and **cannot** be
installed here. Vercel's own React Router framework detection handles v8 — the first deploy built
successfully in 18s.

---

## Tooling

### Vitest does not load `.env`

`vitest.config.ts` calls Vite's `loadEnv` and merges the result into `process.env`. Without it,
`tests/db/helpers.ts` sees undefined credentials.

### CLI scripts need `--env-file-if-exists=.env`

`npm run` does not load `.env`. The `-if-exists` variant keeps the script working in production,
where the platform supplies the environment and no `.env` file exists.

### Two Vitest projects, deliberately

`unit` (`app/**`, no Docker, ~120 ms) and `db` (`tests/db/**`, `fileParallelism: false`). Keep
`passWithNoTests` **off** the root config — there it applies to the whole run, so a broken glob would
exit 0 with nothing executed. The `test:db` script passes the flag on the command line instead.

### Verify by script, not by eye

Both silent auth bugs above were found by scripting the magic-link flow end to end against Mailpit.
A human following "open the link, expect to be signed in" would have hit them and had to debug
backwards.

### Mutation-test the tests that matter

Several suites passed against deliberately wrong implementations:

- The hot-decay suite sampled only exact multiples of the half-life, where a staircase and a smooth
  curve agree — `floor`, `ceil`, `round` step decay **and** linear interpolation all passed.
- The rounding test used a value where `round`, `floor` and `trunc` agree.
- `boundsContain`'s inclusive comparisons and the grid divisor had no test at all.
- The `spot_signal_summary` ordering test survived `order by t.id`, `order by t.label`, **and
  deleting the `ORDER BY` entirely** — it only caught a full reversal. It was also unfixable by
  rewriting the assertion, because the seed sets `sort_order = id * 10`, so the two orderings are
  perfectly correlated. It took a probe row whose id, `sort_order` and label all disagree.
- Dropping `.eq("spot_id", …)` from `retractSignal` passed every test, because the fixture had only
  one spot. The bug that hides: taking back one upvote silently removes that vote from every other
  spot the user upvoted for the same shoot type.

**A filter the database would enforce anyway needs a viewer who can see past it.** Testing
`listComments`' explicit `status = 'published'` against an anonymous viewer proves nothing — RLS
hides removed rows from `anon` either way, so the mutation survives. `comments_read` deliberately
lets authors see their own removed comments, so only listing *as the author* makes the query filter
load-bearing. That is also the case that matters in the product: the page lists with the viewer's
own client, so without the filter an author sees their removed comment still sitting in the thread.

If a test guards a specific behavior, break that behavior and confirm the test goes red — and check
the mutation was actually installed before you believe a green suite, since a pattern that fails to
match leaves the code unchanged and looks exactly like a passing mutation test.
