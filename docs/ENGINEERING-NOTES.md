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

If a test guards a specific behavior, break that behavior and confirm the test goes red.
