# Photospots Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed-in photographers upvote a spot for a specific kind of shoot, answer "would you shoot here again?", and leave a comment — with the counts and the conversation visible to everyone, including logged-out visitors.

**Architecture:** The database side of voting already exists: `cast_signal` flips a vote atomically, statement-level triggers keep the counters correct, and the `comments` table has policies and grants. This plan adds what sits on top — a `spot_signal_summary` RPC for the per-shoot-type breakdown (the counters on `spots` only carry totals), thin data modules for signals and comments, pure functions for optimistic display state, and the detail-page UI. It also closes the one wiring gap in spec §7: `spots.score` is a derived column that `authenticated` cannot write, so the route action recomputes it with `computeScore` through a service-role client after every signal or comment write.

**Tech Stack:** React Router v8 (`useFetcher` for optimistic UI) · Supabase (Postgres, RLS) · Vitest

**Plan sequence:** Plan 4 of 6. Plans 1–3 are complete — schema, RLS, auth, the pure domain layer, read-only explore, and the contribution flow — with 240 passing tests.

**Spec:** `docs/superpowers/specs/2026-08-09-photospots-design.md` — §4.4 (votes are signals, not a counter), §4.5 (two rankings), §7 (ranking implementation), §8 (spot detail), §9.2 (voting), §9.4 (moderation is not reversible by the author).

**Commit convention:** every commit message ends with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## What plans 1–3 leave you

| Available | Where |
| --- | --- |
| `cast_signal(p_spot_id, p_kind, p_shoot_type_id, p_value)` — atomic vote change, `authenticated` only | migration 6 |
| `signals` with `UNIQUE NULLS NOT DISTINCT (spot_id, profile_id, kind, shoot_type_id)` and the `signals_shape` check | migration 3 |
| `comments` with `check (length(trim(body)) > 0)`, `status` defaulting to `published` | migration 3 |
| Statement-level recount triggers on `signals`, `comments`, `photos` → the `*_count` columns on `spots` | migration 4 |
| RLS: `signals_read` (public), `signals_insert`/`signals_delete` (own rows only), `comments_read`/`comments_insert`/`comments_update` | migration 5 |
| `computeScore(counters, weights)`, `DEFAULT_WEIGHTS`, `ZERO_COUNTERS` | `app/domain/scoring/` |
| `backfillScores(supabase, weights)` — recomputes every stored score | `scripts/backfill-scores.ts` |
| `getSpotBySlug`, `getSpotMedia`, `SpotDetail` (already carries the three total counters) | `app/data/spots.ts` |
| `getCurrentProfile` | `app/data/profiles.ts` |
| `createSupabaseServerClient(request)` → `{ supabase, headers }` | `app/lib/supabase.server.ts` |
| `createTestUser`, `deleteTestUser`, `serviceClient`, `anonClient` | `tests/db/helpers.ts` |

**Three gaps this plan closes, each verified against the running database:**

- **No per-shoot-type counts exist.** `spots.shoot_type_upvote_count` is a single total across every shoot type. Spec §4.4 makes the vote *scoped* to a shoot type — a park is good for engagement and bad for toddlers — so the detail page needs a breakdown that no query currently produces.
- **Nothing writes `spots.score` outside the backfill script.** Migration 5 grants `authenticated` UPDATE on named columns and `score` is deliberately not among them. Confirmed against the live database: the seeded spots' scores come from `npm run backfill:scores`, and a vote cast today would move the counters and leave `score` stale.
- **The detail page says "Comments and voting arrive in the next milestone."** (`app/routes/spots.$slug.tsx:143`)

**Constraints carried forward. Each was a real bug once — see `docs/ENGINEERING-NOTES.md`:**

1. `revoke execute … from public` **before** granting any new function. Postgres grants EXECUTE to PUBLIC by default, so a bare `grant … to authenticated` restricts nothing.
2. Assert `error.code`, never just `expect(error).not.toBeNull()`. A `42501 permission denied` satisfies a bare non-null assertion exactly as well as the RLS denial you meant to test.
3. `numeric` arrives from PostgREST as a **string**. `score` must be `Number(...)`-ed at the mapping boundary.
4. Every object in a bulk insert must carry the same keys — PostgREST unions the keys and sets the gaps to `null`, bypassing column defaults.
5. Write `status = 'published'` explicitly in queries even though RLS enforces it.
6. Loaders and actions return `data(obj, { headers })` from `react-router`, never `Response.json`, and **every** return path carries `headers`.
7. supabase-js returns errors, it does not throw. Check `error` on every call.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260810000009_signals.sql` | `spot_signal_summary` RPC and its grants |
| `app/domain/comments/comment.ts` | Comment body validation. Pure. |
| `app/domain/signals/vote-state.ts` | Optimistic display state — what to draw while a vote is in flight. Pure. |
| `app/data/signals.ts` | Read the summary, cast a signal, retract one |
| `app/data/comments.ts` | List and add comments |
| `app/data/scores.ts` | Counter row → `SpotCounters`, and the derived-column write |
| `app/lib/supabase.server.ts` | Add `createSupabaseAdminClient` (service role, server only) |
| `app/lib/env.server.ts` | Add the optional `SUPABASE_SERVICE_ROLE_KEY` |
| `app/components/spot/VotePanel.tsx` | Shoot-type upvotes and the shoot-again question |
| `app/components/spot/CommentThread.tsx` | Comment list and the add-comment form |
| `app/routes/spots.$slug.tsx` | Loader additions and one action with an `intent` switch |
| `scripts/backfill-scores.ts` | Re-point at the shared mapping in `app/data/scores.ts` |

`signals.ts` and `comments.ts` are separate modules per aggregate, matching `spots.ts` / `spot-writes.ts`. The two components exist so the route stays a thin loader/action pair; both export the small pure helpers their tests exercise, because the unit project runs in `node` with no DOM (see `vitest.config.ts`) and this codebase tests components through their exported functions, not by rendering.

---

## Task 1: The per-shoot-type vote summary

**Files:**
- Create: `supabase/migrations/20260810000009_signals.sql`
- Test: `tests/db/signal-summary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/signal-summary.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";

interface SummaryRow {
  shoot_type_id: number;
  slug: string;
  label: string;
  sort_order: number;
  upvote_count: number;
  viewer_upvoted: boolean;
}

let voter: TestUser;
let other: TestUser;
let spotId: string;
let familyId: number;
let petsId: number;
let probeId: number;

beforeAll(async () => {
  voter = await createTestUser("Summary Voter");
  other = await createTestUser("Summary Other");
  const admin = serviceClient();

  const { data: types, error: typeError } = await admin.from("shoot_types").select("id, slug");
  if (typeError) throw typeError;
  familyId = types!.find((t) => t.slug === "family")!.id;
  petsId = types!.find((t) => t.slug === "pets")!.id;

  const { data, error } = await admin
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Signal Summary Park",
      slug: `signal-summary-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.68 42.95)",
      created_by: voter.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = data.id;

  // A probe type that makes the ordering observable. The seed sets
  // sort_order = id * 10, so across the seeded rows id order and sort_order
  // order agree exactly and no assertion can distinguish them. This row is the
  // newest id (so it sorts last by id), the lowest sort_order (so it sorts
  // first by sort_order) and a label that sorts last alphabetically — which
  // makes `order by id`, `order by label` and a missing ORDER BY all visible.
  //
  // Note the cost: shoot_types is global reference data, so while this row
  // exists the seeded set has ten types rather than nine, and two other files
  // assert on that count. This file is therefore safe only because the db
  // project sets `fileParallelism: false`. helpers.ts deliberately refuses to
  // lean on that flag for user uniqueness; this fixture cannot avoid it, so
  // the dependency is stated rather than left implicit — and afterAll throws
  // if the cleanup that ends it ever fails.
  const { data: probe, error: probeError } = await admin
    .from("shoot_types")
    .insert({ slug: "zz-order-probe", label: "Zulu Probe", sort_order: 5 })
    .select("id")
    .single();
  if (probeError) throw probeError;
  probeId = probe.id;

  // Every object carries the same keys: PostgREST unions the keys of a bulk
  // insert and nulls the gaps, bypassing column defaults.
  const { error: linkError } = await admin.from("spot_shoot_types").insert([
    { spot_id: spotId, shoot_type_id: familyId },
    { spot_id: spotId, shoot_type_id: petsId },
    { spot_id: spotId, shoot_type_id: probeId },
  ]);
  if (linkError) throw linkError;
});

afterAll(async () => {
  const admin = serviceClient();

  // The spot goes first: spot_shoot_types cascades from it, and those rows
  // reference the probe type, which cannot be deleted while they exist.
  const { error: spotError } = await admin.from("spots").delete().eq("id", spotId);
  if (spotError) throw spotError;

  // Thrown rather than discarded, for the reason deleteTestUser gives in
  // helpers.ts — and more sharply here, because the damage lands in another
  // file. The probe is a row in shoot_types, which is global reference data:
  // leaking it makes schema-profiles.test.ts and rls.test.ts fail on their
  // count of the nine seeded categories, in code with no connection to this
  // change. A silent failure here would be diagnosed in the wrong file.
  const { error: probeError } = await admin.from("shoot_types").delete().eq("id", probeId);
  if (probeError) throw probeError;

  await deleteTestUser(voter.id);
  await deleteTestUser(other.id);
});

const summary = async (client = anonClient(), id = spotId): Promise<SummaryRow[]> => {
  const { data, error } = await client.rpc("spot_signal_summary", { p_spot_id: id });
  expect(error).toBeNull();
  return (data ?? []) as SummaryRow[];
};

// These tests run in order and share state deliberately: each one builds on
// the votes cast by the one before it.
describe("spot_signal_summary", () => {
  it("is callable by a logged-out visitor, since browsing is open (spec §4.6)", async () => {
    const rows = await summary();
    expect(rows).toHaveLength(3);
  });

  it("lists every tagged shoot type at zero before anyone votes", async () => {
    const rows = await summary();
    expect(rows.map((r) => r.slug).sort()).toEqual(["family", "pets", "zz-order-probe"]);
    expect(rows.every((r) => r.upvote_count === 0)).toBe(true);
    expect(rows.every((r) => r.viewer_upvoted === false)).toBe(true);
  });

  it("counts upvotes per shoot type, not as one total", async () => {
    for (const [user, typeId] of [
      [voter, familyId],
      [other, familyId],
      [voter, petsId],
    ] as const) {
      const { error } = await user.client.rpc("cast_signal", {
        p_spot_id: spotId,
        p_kind: "shoot_type_upvote",
        p_shoot_type_id: typeId,
      });
      expect(error).toBeNull();
    }

    const rows = await summary();
    expect(rows.find((r) => r.slug === "family")!.upvote_count).toBe(2);
    expect(rows.find((r) => r.slug === "pets")!.upvote_count).toBe(1);
  });

  it("reports viewer_upvoted for the caller and nobody else", async () => {
    const mine = await summary(voter.client);
    expect(mine.find((r) => r.slug === "family")!.viewer_upvoted).toBe(true);
    expect(mine.find((r) => r.slug === "pets")!.viewer_upvoted).toBe(true);

    const theirs = await summary(other.client);
    expect(theirs.find((r) => r.slug === "family")!.viewer_upvoted).toBe(true);
    expect(theirs.find((r) => r.slug === "pets")!.viewer_upvoted).toBe(false);

    const loggedOut = await summary();
    expect(loggedOut.every((r) => r.viewer_upvoted === false)).toBe(true);
  });

  // Asserts the exact sequence, not merely that sort_order is non-decreasing.
  // The weaker form passes under `order by id`, under `order by label` and
  // with no ORDER BY at all, because the seeded rows have sort_order = id * 10
  // and every one of those orders coincides. zz-order-probe is last by id and
  // by label but first by sort_order, so only a real sort_order ordering
  // produces this sequence.
  it("orders by sort_order", async () => {
    const rows = await summary();
    expect(rows.map((r) => r.slug)).toEqual(["zz-order-probe", "family", "pets"]);
  });

  // A spot's shoot types are editable (plan 3). Listing only the currently
  // tagged types would drop these votes off the page while
  // spots.shoot_type_upvote_count still counts them, so the totals line and
  // the breakdown would disagree with no error anywhere.
  it("keeps a shoot type that still carries votes after it is untagged", async () => {
    const { error } = await serviceClient()
      .from("spot_shoot_types")
      .delete()
      .eq("spot_id", spotId)
      .eq("shoot_type_id", petsId);
    expect(error).toBeNull();

    const rows = await summary();
    const pets = rows.find((r) => r.slug === "pets");
    expect(pets).toBeDefined();
    expect(pets!.upvote_count).toBe(1);
  });

  // Depends on running after the voting tests: it is the votes on the *other*
  // spot that give `where s.spot_id = p_spot_id` something to exclude. Move
  // this test earlier and it still passes, but stops covering that filter.
  it("returns nothing for a spot with no shoot types and no votes", async () => {
    const admin = serviceClient();
    const { data, error } = await admin
      .from("spots")
      .insert({
        kind: "outdoor",
        name: "Untagged Spot",
        slug: `untagged-${crypto.randomUUID().slice(0, 8)}`,
        location: "POINT(-85.69 42.96)",
        created_by: voter.id,
        status: "published",
      })
      .select("id")
      .single();
    if (error) throw error;

    // finally, so a failed assertion cannot strand a published spot in the
    // database: spots.created_by is `on delete set null`, so deleting the test
    // user would leave the row behind without any error to notice.
    try {
      expect(await summary(anonClient(), data.id)).toEqual([]);
    } finally {
      await admin.from("spots").delete().eq("id", data.id);
    }
  });

  // The function never selects from public.spots, so spots_read cannot filter
  // it. Without an explicit status check the vote breakdown of a removed spot
  // is readable by anyone holding its id. The spot is both tagged and voted on
  // so that neither branch of the union can smuggle it through — a status
  // check left outside the parentheses would still fail this test.
  it("returns nothing for a spot RLS hides, even to a caller holding its id", async () => {
    const admin = serviceClient();
    const { data, error } = await admin
      .from("spots")
      .insert({
        kind: "outdoor",
        name: "Removed Spot",
        slug: `removed-${crypto.randomUUID().slice(0, 8)}`,
        location: "POINT(-85.7 42.97)",
        created_by: voter.id,
        status: "removed",
      })
      .select("id")
      .single();
    if (error) throw error;

    try {
      await admin.from("spot_shoot_types").insert({ spot_id: data.id, shoot_type_id: familyId });
      await admin.from("signals").insert({
        spot_id: data.id,
        profile_id: voter.id,
        kind: "shoot_type_upvote",
        shoot_type_id: familyId,
        value: 1,
      });

      // The spot really is hidden by RLS, so the RPC is the only way in.
      const { data: visible } = await anonClient().from("spots").select("id").eq("id", data.id);
      expect(visible).toEqual([]);

      expect(await summary(anonClient(), data.id)).toEqual([]);
    } finally {
      await admin.from("spots").delete().eq("id", data.id);
    }
  });

  // The other half of the guard: it must hide unpublished spots without
  // hiding published ones.
  it("still returns rows for a published spot", async () => {
    const rows = await summary();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.find((r) => r.slug === "family")!.upvote_count).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail for the right reason**

```bash
npm run test:db -- signal-summary
```

Expected: every test fails with `Could not find the function public.spot_signal_summary(p_spot_id)` — the function does not exist yet. A failure mentioning anything else means the fixture is wrong, not the feature.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810000009_signals.sql`:

```sql
-- Per-shoot-type vote counts for the detail page (spec §4.4, §8).
--
-- spots.shoot_type_upvote_count is one total across every shoot type, which
-- cannot answer the question the vote is actually scoped to: this park is good
-- for engagement photos and bad for toddlers.
--
-- An RPC rather than letting the client aggregate: the alternative ships one
-- row per vote to the browser and grows without bound on a popular spot.
--
-- The row set is (shoot types tagged on the spot) UNION (shoot types that
-- already carry votes on it). A spot's shoot types are editable, so a type can
-- be untagged after people have voted on it. Listing only the tagged ones would
-- drop those votes from the page while the total counter still counts them, and
-- the breakdown would silently disagree with the total.
--
-- SECURITY INVOKER: signals_read is `using (true)`, so counting needs no
-- elevated rights, and viewer_upvoted must be evaluated as the caller.
create or replace function public.spot_signal_summary(p_spot_id uuid)
returns table (
  shoot_type_id integer,
  slug text,
  label text,
  sort_order integer,
  upvote_count integer,
  viewer_upvoted boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.id,
    t.slug,
    t.label,
    t.sort_order,
    v.upvote_count,
    -- bool_or over `profile_id = auth.uid()` is null for a logged-out caller
    -- (null = uuid is null, not false), and null for a type with no votes at
    -- all, so both collapse to false here.
    coalesce(v.viewer_upvoted, false)
  from public.shoot_types t
  join lateral (
    select
      count(*)::integer as upvote_count,
      bool_or(s.profile_id = auth.uid()) as viewer_upvoted
    from public.signals s
    where s.spot_id = p_spot_id
      -- Defence in depth, and inert as written: signals_shape forces every
      -- shoot_again row to carry a null shoot_type_id, which the join below
      -- already excludes. Deleting this line changes no result today. It
      -- becomes load-bearing the day a new signal kind carries a shoot type.
      and s.kind = 'shoot_type_upvote'
      and s.shoot_type_id = t.id
  ) v on true
  -- status is filtered explicitly rather than left to RLS. This function never
  -- selects from public.spots, so spots_read never runs on it: without this
  -- clause anyone holding the id of a hidden or removed spot could read its
  -- shoot types and vote counts straight off the public API. Both sibling RPCs
  -- in 20260810000007_explore.sql filter status the same way.
  where exists (
      select 1 from public.spots sp
      where sp.id = p_spot_id and sp.status = 'published'
    )
    -- These parentheses are load-bearing: `and` binds tighter than `or`, so
    -- without them the tagged-types branch would satisfy the where clause on
    -- its own and bypass the status filter entirely.
    and (
      v.upvote_count > 0
      or exists (
        select 1 from public.spot_shoot_types st
        where st.spot_id = p_spot_id and st.shoot_type_id = t.id
      )
    )
  order by t.sort_order, t.id
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, so the grant below
-- would restrict nothing without this revoke first.
revoke execute on function public.spot_signal_summary(uuid) from public;

-- anon included: the counts are public and browsing never hits a signup wall
-- (spec §4.6). service_role included because revoking from PUBLIC takes the
-- privilege from it too — BYPASSRLS skips row policies, not the GRANT system.
grant execute on function public.spot_signal_summary(uuid) to anon, authenticated, service_role;

-- shoot_types is reference data, and it was the one table where service_role
-- held SELECT alone; every other table in this schema already grants it write.
--
-- The tests need it. The seed sets sort_order = id * 10 for all nine types, so
-- across the seeded rows `order by sort_order` and `order by id` are perfectly
-- correlated and no assertion over them can tell the two apart — a dropped
-- ORDER BY would go unnoticed. Writing a probe type whose id is highest and
-- whose sort_order is lowest is what makes the ordering observable.
--
-- Deliberately no grant on shoot_types_id_seq: nextval accepts USAGE *or*
-- UPDATE, and Supabase's default privileges already give service_role UPDATE
-- ('w') on sequences in public. Verified by inserting as service_role with the
-- table grants below and no sequence grant at all; had it been required this
-- would fail loudly at db-reset time, not silently.
grant insert, delete on public.shoot_types to service_role;
```

- [ ] **Step 4: Apply the migration and run the test**

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" && npx supabase db reset
```

Then:

```bash
npm run test:db -- signal-summary
```

Expected: 9 passing.

- [ ] **Step 5: Mutation-test every clause that a test claims to guard**

Each row below is one temporary edit to the migration, followed by `npx supabase db reset` and `npm run test:db -- signal-summary`. Exactly the named test must go red, and the other eight must stay green. Restore the clause and reset before moving to the next row.

| # | Mutation | Test that must fail |
| --- | --- | --- |
| 1 | `order by t.sort_order, t.id` → `order by t.id` | orders by sort_order |
| 2 | `order by t.sort_order, t.id` → `order by t.label` | orders by sort_order |
| 3 | delete the ORDER BY line entirely | orders by sort_order |
| 4 | `order by t.sort_order, t.id` → `order by t.sort_order desc` | orders by sort_order |
| 5 | delete the `exists (… sp.status = 'published')` guard | returns nothing for a spot RLS hides… |
| 6 | delete `v.upvote_count > 0 or` from the union | keeps a shoot type that still carries votes after it is untagged |
| 7 | drop the parentheses: `where exists (…status…) and v.upvote_count > 0 or exists (…tagged…)` | returns nothing for a spot RLS hides… |

Row 7 is the reason the guard is written with parentheses at all. `and` binds tighter than `or`, so the unparenthesised form lets the tagged-types branch satisfy the `where` on its own and the status filter never applies — which is why the hidden-spot fixture is both tagged and voted on.

Rows 1–3 are the point of the probe shoot type. Against the seeded rows alone all three of those mutations pass every assertion, because the seed sets `sort_order = id * 10` and id order, sort_order order and label order all coincide — a test that only checks `sort_order` is non-decreasing catches nothing but a full reversal (row 4). If any mutation here leaves the suite green, the test is not guarding what it claims and must be fixed before continuing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260810000009_signals.sql tests/db/signal-summary.test.ts
git commit -m "$(cat <<'EOF'
feat: add spot_signal_summary for per-shoot-type vote counts

spots.shoot_type_upvote_count is a single total, but a vote is scoped to a
shoot type (spec §4.4) — a park can be good for engagement and wrong for
toddlers, and the total cannot say so.

The result set unions the spot's tagged shoot types with any type that already
carries votes on it. Shoot types are editable, so a type can be untagged after
people have voted; listing only the tagged ones would drop those votes from the
breakdown while the total counter kept counting them.

status is filtered explicitly inside the function. It never selects from
public.spots, so spots_read never runs on it, and both sibling RPCs in the
explore migration filter status the same way for the same reason. The union is
parenthesised so the tagged-types branch cannot bypass that filter.

service_role gains insert/delete on shoot_types — reference data, and the one
table where it held select alone. Without it no test can make sort_order and id
disagree, because the seed sets sort_order = id * 10, and an ordering assertion
over the seeded rows alone cannot tell a correct ORDER BY from a missing one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Comment validation

**Files:**
- Create: `app/domain/comments/comment.ts`
- Test: `app/domain/comments/comment.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/domain/comments/comment.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateComment, MAX_COMMENT_LENGTH } from "./comment";

describe("validateComment", () => {
  it("accepts an ordinary comment", () => {
    expect(validateComment("Golden hour here is unreal in October.").errors).toEqual([]);
  });

  it("rejects an empty body", () => {
    const { errors } = validateComment("");
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("body");
  });

  // The database has `check (length(trim(body)) > 0)`, so whitespace-only text
  // fails there too — but as a 23514 the user never sees explained.
  it("rejects whitespace-only text, matching the database check", () => {
    expect(validateComment("   \n\t ").errors).toHaveLength(1);
  });

  it(`accepts a comment of exactly ${MAX_COMMENT_LENGTH} characters`, () => {
    expect(validateComment("x".repeat(MAX_COMMENT_LENGTH)).errors).toEqual([]);
  });

  it("rejects one character past the limit", () => {
    expect(validateComment("x".repeat(MAX_COMMENT_LENGTH + 1)).errors).toHaveLength(1);
  });

  // The trim is what the data layer will store, so the limit has to be measured
  // on the same string. Otherwise padding a body with spaces changes whether it
  // is accepted without changing what gets saved.
  it("measures the length after trimming", () => {
    const padded = `  ${"x".repeat(MAX_COMMENT_LENGTH)}  `;
    expect(validateComment(padded).errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm run test:unit -- comment
```

Expected: FAIL — `Failed to resolve import "./comment"`.

- [ ] **Step 3: Write the implementation**

Create `app/domain/comments/comment.ts`:

```ts
import type { FieldError, ValidationResult } from "../spots/submission";

/**
 * Long enough for a paragraph of practical advice about a location, short
 * enough that the comment list stays readable. The database has no length
 * constraint, so this is the only limit — deliberately, since it is the kind of
 * number that gets tuned from feedback and a migration is a poor place for that.
 */
export const MAX_COMMENT_LENGTH = 2000;

/**
 * Mirrors the database's `check (length(trim(body)) > 0)`. The check is the
 * authority; this exists so the user is told what is wrong in words rather than
 * seeing a 23514.
 */
export function validateComment(body: string): ValidationResult {
  const errors: FieldError[] = [];
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    errors.push({ field: "body", message: "Write something first." });
  } else if (trimmed.length > MAX_COMMENT_LENGTH) {
    errors.push({
      field: "body",
      message: `Keep it under ${MAX_COMMENT_LENGTH} characters.`,
    });
  }

  return { errors };
}
```

- [ ] **Step 4: Run the test**

```bash
npm run test:unit -- comment
```

Expected: 6 passing.

- [ ] **Step 5: Mutation-test the trim**

Change `body.trim()` to `body` and re-run.

Expected: **"rejects whitespace-only text" and "measures the length after trimming" both fail.** Restore the trim.

- [ ] **Step 6: Commit**

```bash
git add app/domain/comments/
git commit -m "$(cat <<'EOF'
feat: validate comment bodies in the domain layer

The database check `length(trim(body)) > 0` is the authority, but it surfaces
as a 23514 the user cannot act on. This says the same thing in words, measured
on the trimmed string the data layer actually stores — otherwise padding with
spaces changes whether a body is accepted without changing what is saved.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Optimistic vote state

**Files:**
- Create: `app/domain/signals/vote-state.ts`
- Test: `app/domain/signals/vote-state.test.ts`

Spec §9.2 asks for optimistic UI with rollback. Rollback comes free from React Router — when the fetcher settles, the loader revalidates and the server's answer wins. What does not come free is *what to draw while it is in flight*, and that is arithmetic worth testing without a browser.

- [ ] **Step 1: Write the failing test**

Create `app/domain/signals/vote-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  applyPendingUpvote,
  applyPendingShootAgain,
  type ShootTypeVoteState,
  type ShootAgainState,
} from "./vote-state";

const rows = (): ShootTypeVoteState[] => [
  { shootTypeId: 1, label: "Family", upvoteCount: 3, viewerUpvoted: false },
  { shootTypeId: 9, label: "Pets", upvoteCount: 1, viewerUpvoted: true },
];

describe("applyPendingUpvote", () => {
  it("returns the rows unchanged when nothing is in flight", () => {
    expect(applyPendingUpvote(rows(), null)).toEqual(rows());
  });

  it("adds the viewer's vote optimistically", () => {
    const [family] = applyPendingUpvote(rows(), { shootTypeId: 1, upvoted: true });
    expect(family.upvoteCount).toBe(4);
    expect(family.viewerUpvoted).toBe(true);
  });

  it("removes it again on a retraction", () => {
    const pets = applyPendingUpvote(rows(), { shootTypeId: 9, upvoted: false })[1];
    expect(pets.upvoteCount).toBe(0);
    expect(pets.viewerUpvoted).toBe(false);
  });

  // The server treats a duplicate vote as success (spec §9.2), so a double
  // click sends the same intent twice. If that incremented twice the count
  // would visibly jump by two and then snap back on revalidation.
  it("is idempotent — re-asserting a vote the viewer already cast changes nothing", () => {
    expect(applyPendingUpvote(rows(), { shootTypeId: 9, upvoted: true })).toEqual(rows());
    expect(applyPendingUpvote(rows(), { shootTypeId: 1, upvoted: false })).toEqual(rows());
  });

  it("leaves every other row alone", () => {
    const after = applyPendingUpvote(rows(), { shootTypeId: 1, upvoted: true });
    expect(after[1]).toEqual(rows()[1]);
  });

  it("ignores a shoot type that is not on the list", () => {
    expect(applyPendingUpvote(rows(), { shootTypeId: 404, upvoted: true })).toEqual(rows());
  });

  it("does not mutate the rows it was given", () => {
    const original = rows();
    applyPendingUpvote(original, { shootTypeId: 1, upvoted: true });
    expect(original).toEqual(rows());
  });

  // Distinct from the mutation check above: this proves the *output* rows
  // are independent copies, not aliases back into the input array — even on
  // the unchanged paths where the values happen to be identical. Without
  // this, a caller that mutates a returned row in place would corrupt the
  // input too, and no other test here would notice.
  it("returns fresh row objects, not aliases into the input", () => {
    const input = rows();
    const after = applyPendingUpvote(input, { shootTypeId: 1, upvoted: true });
    after.forEach((row, i) => expect(row).not.toBe(input[i]));
  });
});

const shootAgain = (over: Partial<ShootAgainState> = {}): ShootAgainState => ({
  yesCount: 5,
  noCount: 2,
  viewerAnswer: null,
  ...over,
});

describe("applyPendingShootAgain", () => {
  it("returns the state unchanged when nothing is in flight", () => {
    expect(applyPendingShootAgain(shootAgain(), undefined)).toEqual(shootAgain());
  });

  it("counts a first answer", () => {
    expect(applyPendingShootAgain(shootAgain(), 1)).toEqual(
      shootAgain({ yesCount: 6, viewerAnswer: 1 }),
    );
  });

  // The reason cast_signal exists: flipping is a delete plus an insert, and
  // both counters move. Adding to the new side without removing from the old
  // shows the viewer voting twice.
  it("moves the vote across when the viewer flips their answer", () => {
    const before = shootAgain({ viewerAnswer: 1 });
    expect(applyPendingShootAgain(before, 0)).toEqual(
      shootAgain({ yesCount: 4, noCount: 3, viewerAnswer: 0 }),
    );
  });

  it("takes the vote back on a retraction", () => {
    const before = shootAgain({ viewerAnswer: 0 });
    expect(applyPendingShootAgain(before, null)).toEqual(
      shootAgain({ noCount: 1, viewerAnswer: null }),
    );
  });

  it("is idempotent — repeating the current answer changes nothing", () => {
    const before = shootAgain({ viewerAnswer: 1 });
    expect(applyPendingShootAgain(before, 1)).toEqual(before);
  });

  // As originally drafted this asserted `toEqual(before)`, i.e. that
  // retracting leaves viewerAnswer at 1 unchanged. That contradicts "takes
  // the vote back on a retraction" above, which requires viewerAnswer to
  // become null on any `null` pending — the only way to satisfy both would
  // be to branch on the counters being zero, which is not a rule anyone
  // wants. Corrected to check the actual intent: clamp keeps yesCount from
  // going negative, while viewerAnswer still transitions.
  it("never shows a negative count", () => {
    const before = shootAgain({ yesCount: 0, noCount: 0, viewerAnswer: 1 });
    expect(applyPendingShootAgain(before, null)).toEqual(
      shootAgain({ yesCount: 0, noCount: 0, viewerAnswer: null }),
    );
  });
});
```

Note the two different "nothing pending" values: `null` is a real answer for shoot-again (it means *retract*), so "nothing in flight" has to be `undefined` there. The upvote type has no such collision.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm run test:unit -- vote-state
```

Expected: FAIL — `Failed to resolve import "./vote-state"`.

- [ ] **Step 3: Write the implementation**

Create `app/domain/signals/vote-state.ts`:

```ts
/** One shoot type as the detail page draws it. */
export interface ShootTypeVoteState {
  shootTypeId: number;
  label: string;
  upvoteCount: number;
  viewerUpvoted: boolean;
}

/** The state the viewer just asked for, while the request is in flight. */
export interface PendingUpvote {
  shootTypeId: number;
  upvoted: boolean;
}

export interface ShootAgainState {
  yesCount: number;
  noCount: number;
  /** 1 yes, 0 no, null for no answer yet. */
  viewerAnswer: 0 | 1 | null;
}

/**
 * `null` retracts; `undefined` means nothing is in flight.
 *
 * Three of the four values are falsy — `0` is a real answer meaning "no". So
 * `if (!pending)` is always wrong here: it reads a "no" vote as nothing
 * happening. Compare against `undefined` explicitly, as below.
 */
export type PendingShootAgain = 0 | 1 | null | undefined;

const clamp = (n: number) => (n < 0 ? 0 : n);

/**
 * What to draw while an upvote is in flight.
 *
 * Idempotent by construction: the server treats a duplicate vote as success
 * (spec §9.2), so a double click submits the same intent twice, and an
 * unconditional +1 would jump the count by two before snapping back on
 * revalidation. Rollback itself needs no code — when the fetcher settles the
 * loader revalidates and the server's numbers replace these.
 */
export function applyPendingUpvote(
  rows: readonly ShootTypeVoteState[],
  pending: PendingUpvote | null,
): ShootTypeVoteState[] {
  return rows.map((row) => {
    // Copy even on the unchanged paths. Without it these rows would be the
    // exact objects from the input array, so a caller that mutates the
    // returned rows would silently mutate the input too. Copying makes the
    // function safe by construction rather than by convention.
    if (!pending || pending.shootTypeId !== row.shootTypeId) return { ...row };
    if (pending.upvoted === row.viewerUpvoted) return { ...row };

    return {
      ...row,
      viewerUpvoted: pending.upvoted,
      upvoteCount: pending.upvoted ? row.upvoteCount + 1 : clamp(row.upvoteCount - 1),
    };
  });
}

/**
 * What to draw while a "would you shoot here again?" answer is in flight.
 *
 * Flipping moves the vote rather than adding one: `cast_signal` deletes the old
 * row and inserts the new one in a single transaction, so both counters move
 * together and the display has to match.
 */
export function applyPendingShootAgain(
  state: ShootAgainState,
  pending: PendingShootAgain,
): ShootAgainState {
  if (pending === undefined || pending === state.viewerAnswer) return { ...state };

  let { yesCount, noCount } = state;
  if (state.viewerAnswer === 1) yesCount = clamp(yesCount - 1);
  if (state.viewerAnswer === 0) noCount = clamp(noCount - 1);
  if (pending === 1) yesCount += 1;
  if (pending === 0) noCount += 1;

  return { yesCount, noCount, viewerAnswer: pending };
}
```

- [ ] **Step 4: Run the test**

```bash
npm run test:unit -- vote-state
```

Expected: 14 passing.

- [ ] **Step 5: Mutation-test the rules that matter**

Run each of these, confirm the named test(s) fail, then restore:

| Mutation | Test(s) that must go red |
| --- | --- |
| Delete `if (pending.upvoted === row.viewerUpvoted) return { ...row };` | "is idempotent — re-asserting a vote the viewer already cast changes nothing" |
| Delete both `if (state.viewerAnswer === …) …` lines in `applyPendingShootAgain` | "moves the vote across when the viewer flips their answer" **and** "takes the vote back on a retraction" — deleting the pair kills two tests, not the one you'd guess from reading only the "flip" test |
| Change `clamp` to `(n) => n` | "never shows a negative count" |
| Remove `!pending \|\|` from the upvote guard, leaving `pending.shootTypeId !== row.shootTypeId` (now dereferences `pending` unconditionally) | "returns the rows unchanged when nothing is in flight" — throws `TypeError: Cannot read properties of null`, which counts as red |
| Flip the upvote comparison from `!==` to `===` | four tests: "adds the viewer's vote optimistically", "removes it again on a retraction", "is idempotent — re-asserting a vote the viewer already cast changes nothing", "ignores a shoot type that is not on the list" |
| Replace both `{ ...row }` early-return copies with bare `row` | "returns fresh row objects, not aliases into the input" — this test exists specifically to catch this mutation; without it, this mutation is invisible (13/13 stayed green when this was first tried, before the test was added) |
| Delete only `if (state.viewerAnswer === 1) yesCount = clamp(yesCount - 1);` (keep the `=== 0` line) | "moves the vote across when the viewer flips their answer" |
| Delete only `if (state.viewerAnswer === 0) noCount = clamp(noCount - 1);` (keep the `=== 1` line) | "takes the vote back on a retraction" |
| Delete only `if (pending === 1) yesCount += 1;` | "counts a first answer" |
| Delete only `if (pending === 0) noCount += 1;` | "moves the vote across when the viewer flips their answer" |

If any of them stays green, the test is not testing what it says. The `{ ...row }` row above is a real example of that happening: it survived on the first pass, which is why "returns fresh row objects, not aliases into the input" is in the Step 1 test block at all — the copies were correct all along, but nothing proved it until this test existed.

- [ ] **Step 6: Commit**

```bash
git add app/domain/signals/
git commit -m "$(cat <<'EOF'
feat: add pure optimistic-vote state for the detail page

Rollback is free — the loader revalidates when the fetcher settles and the
server's numbers win. What is not free is the arithmetic in between, and it has
two traps worth a test rather than a browser: re-asserting a vote the viewer
already cast must not increment (the server treats a duplicate as success, so a
double click sends the same intent twice), and flipping a shoot-again answer
must move the vote across rather than add one, because cast_signal deletes and
inserts in one transaction.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The signals data layer

**Files:**
- Create: `app/data/signals.ts`
- Test: `tests/db/signals-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/signals-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import {
  getShootTypeVotes,
  getViewerShootAgain,
  castSignal,
  retractSignal,
  isDuplicateSignal,
} from "../../app/data/signals";

let voter: TestUser;
let other: TestUser;
let spotId: string;
/** A second spot, so "retract" can be shown not to reach across spots. */
let otherSpotId: string;
let familyId: number;

beforeAll(async () => {
  voter = await createTestUser("Data Voter");
  other = await createTestUser("Data Other");
  const admin = serviceClient();

  const { data: types, error: typeError } = await admin
    .from("shoot_types")
    .select("id, slug")
    .eq("slug", "family");
  if (typeError) throw typeError;
  familyId = types![0].id;

  const { data, error } = await admin
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Signals Data Park",
      slug: `signals-data-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.67 42.94)",
      created_by: voter.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = data.id;

  const { data: second, error: secondError } = await admin
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Signals Data Park Two",
      slug: `signals-data-two-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.66 42.93)",
      created_by: voter.id,
      status: "published",
    })
    .select("id")
    .single();
  if (secondError) throw secondError;
  otherSpotId = second.id;

  // Both objects carry the same keys: PostgREST unions the keys of a bulk
  // insert and nulls the gaps, bypassing column defaults.
  const { error: linkError } = await admin.from("spot_shoot_types").insert([
    { spot_id: spotId, shoot_type_id: familyId },
    { spot_id: otherSpotId, shoot_type_id: familyId },
  ]);
  if (linkError) throw linkError;
});

afterAll(async () => {
  // Throws rather than discarding the error, matching deleteTestUser: a silent
  // cleanup failure here leaves a published spot on the local map.
  const { error } = await serviceClient()
    .from("spots")
    .delete()
    .in("id", [spotId, otherSpotId]);
  if (error) throw error;
  await deleteTestUser(voter.id);
  await deleteTestUser(other.id);
});

const upvote = (shootTypeId: number) =>
  ({ spotId, kind: "shoot_type_upvote", shootTypeId }) as const;
const shootAgain = () => ({ spotId, kind: "shoot_again", shootTypeId: null }) as const;

// These tests share state and run in order: each builds on the votes cast by
// the one before it.
describe("getShootTypeVotes", () => {
  it("maps the RPC into camelCase rows a component can render", async () => {
    const rows = await getShootTypeVotes(anonClient(), spotId);
    expect(rows).toEqual([
      {
        shootTypeId: familyId,
        slug: "family",
        label: "Family",
        upvoteCount: 0,
        viewerUpvoted: false,
      },
    ]);
  });
});

describe("castSignal", () => {
  it("records an upvote and reflects it back to the voter", async () => {
    await castSignal(voter.client, upvote(familyId));

    const rows = await getShootTypeVotes(voter.client, spotId);
    expect(rows[0].upvoteCount).toBe(1);
    expect(rows[0].viewerUpvoted).toBe(true);
  });

  it("swallows a duplicate, because a double click is a no-op not an error (spec §9.2)", async () => {
    await expect(castSignal(voter.client, upvote(familyId))).resolves.toBeUndefined();

    const rows = await getShootTypeVotes(voter.client, spotId);
    expect(rows[0].upvoteCount).toBe(1);
  });

  it("flips a shoot-again answer in one call", async () => {
    await castSignal(voter.client, shootAgain(), 1);
    expect(await getViewerShootAgain(voter.client, spotId, voter.id)).toBe(1);

    await castSignal(voter.client, shootAgain(), 0);
    expect(await getViewerShootAgain(voter.client, spotId, voter.id)).toBe(0);

    const { data } = await serviceClient()
      .from("spots")
      .select("shoot_again_yes_count, shoot_again_no_count")
      .eq("id", spotId)
      .single();
    expect(data).toEqual({ shoot_again_yes_count: 0, shoot_again_no_count: 1 });
  });

  // A permission failure must surface, not be swallowed alongside duplicates.
  it("refuses a logged-out caller with a permission error, not a silent no-op", async () => {
    await expect(castSignal(anonClient(), upvote(familyId))).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("isDuplicateSignal", () => {
  // Built from an error Postgres actually produced, not a hand-written object:
  // the whole point of the predicate is that it matches the real SQLSTATE.
  it("recognises the unique violation the constraint raises", async () => {
    const insert = () =>
      other.client.from("signals").insert({
        spot_id: spotId,
        profile_id: other.id,
        kind: "shoot_type_upvote",
        shoot_type_id: familyId,
        value: 1,
      });

    const first = await insert();
    expect(first.error).toBeNull();

    const second = await insert();
    expect(second.error?.code).toBe("23505");
    expect(isDuplicateSignal(second.error)).toBe(true);
  });

  it("does not mistake a permission error for a duplicate", async () => {
    const { error } = await anonClient().from("signals").insert({
      spot_id: spotId,
      profile_id: other.id,
      kind: "shoot_again",
      shoot_type_id: null,
      value: 1,
    });
    expect(error?.code).toBe("42501");
    expect(isDuplicateSignal(error)).toBe(false);
  });

  it("is false for no error at all", () => {
    expect(isDuplicateSignal(null)).toBe(false);
  });
});

describe("retractSignal", () => {
  it("removes the caller's own vote and leaves everyone else's", async () => {
    // `other` upvoted family in the isDuplicateSignal test above.
    await retractSignal(voter.client, upvote(familyId));

    const rows = await getShootTypeVotes(other.client, spotId);
    expect(rows[0].upvoteCount).toBe(1);
    expect(rows[0].viewerUpvoted).toBe(true);
  });

  // RLS carries this rule, not an application filter: signals_delete is
  // `using (profile_id = auth.uid())`. A delete naming someone else's row
  // matches nothing rather than erroring, so assert on what survived.
  it("cannot delete somebody else's vote", async () => {
    await retractSignal(voter.client, upvote(familyId));

    const { count, error } = await serviceClient()
      .from("signals")
      .select("id", { count: "exact", head: true })
      .eq("spot_id", spotId)
      .eq("profile_id", other.id)
      .eq("kind", "shoot_type_upvote");
    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  // Without the spot filter the delete is scoped only by kind and shoot type,
  // so taking back one upvote would silently remove the same vote from every
  // other spot the user had upvoted for that shoot type.
  it("retracts the vote on one spot only, not the same vote everywhere", async () => {
    await castSignal(voter.client, upvote(familyId));
    await castSignal(voter.client, { ...upvote(familyId), spotId: otherSpotId });

    await retractSignal(voter.client, upvote(familyId));

    const here = await getShootTypeVotes(voter.client, spotId);
    const there = await getShootTypeVotes(voter.client, otherSpotId);
    expect(here[0].viewerUpvoted).toBe(false);
    expect(there[0].viewerUpvoted).toBe(true);
  });

  // shoot_again rows carry a null shoot_type_id, and `.eq(col, null)` sends
  // `col=eq.null`, which matches nothing. This is the `.is` path.
  it("retracts a shoot-again answer, matching the null shoot_type_id", async () => {
    expect(await getViewerShootAgain(voter.client, spotId, voter.id)).toBe(0);

    await retractSignal(voter.client, shootAgain());
    expect(await getViewerShootAgain(voter.client, spotId, voter.id)).toBeNull();
  });
});

describe("getViewerShootAgain", () => {
  it("returns null for a logged-out visitor without querying", async () => {
    expect(await getViewerShootAgain(anonClient(), spotId, null)).toBeNull();
  });
});

// supabase-js returns errors, it does not throw. A mapper that ignores `error`
// and reads `data` returns an empty list on failure, so the page renders "no
// votes yet" for what is actually a broken query.
describe("error propagation", () => {
  it("throws when the summary RPC fails rather than returning nothing", async () => {
    await expect(getShootTypeVotes(anonClient(), "not-a-uuid")).rejects.toMatchObject({
      code: "22P02",
    });
  });

  it("throws when the shoot-again lookup fails", async () => {
    await expect(
      getViewerShootAgain(anonClient(), "not-a-uuid", voter.id),
    ).rejects.toMatchObject({ code: "22P02" });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm run test:db -- signals-data
```

Expected: FAIL — `Failed to resolve import "../../app/data/signals"`.

- [ ] **Step 3: Write the implementation**

Create `app/data/signals.ts`:

```ts
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ShootTypeVoteState } from "../domain/signals/vote-state";

export type SignalKind = "shoot_type_upvote" | "shoot_again";

/** Identifies one ballot: a spot, a kind, and — for upvotes — a shoot type. */
export interface SignalRef {
  spotId: string;
  kind: SignalKind;
  /** Null for `shoot_again`, which the `signals_shape` check requires. */
  shootTypeId: number | null;
}

export interface ShootTypeVotes extends ShootTypeVoteState {
  slug: string;
}

interface SummaryRow {
  shoot_type_id: number;
  slug: string;
  label: string;
  sort_order: number;
  upvote_count: number;
  viewer_upvoted: boolean;
}

/**
 * The rows come back already ordered by `sort_order`, so `sort_order` itself is
 * dropped here rather than carried into the UI as a field nothing reads.
 */
export async function getShootTypeVotes(
  supabase: SupabaseClient,
  spotId: string,
): Promise<ShootTypeVotes[]> {
  const { data, error } = await supabase.rpc("spot_signal_summary", { p_spot_id: spotId });
  if (error) throw error;

  return ((data ?? []) as SummaryRow[]).map((row) => ({
    shootTypeId: row.shoot_type_id,
    slug: row.slug,
    label: row.label,
    upvoteCount: row.upvote_count,
    viewerUpvoted: row.viewer_upvoted,
  }));
}

/**
 * The viewer's own "would you shoot here again?" answer, or null.
 *
 * Takes the profile id rather than calling `auth.getUser()`: the route already
 * has it from `getCurrentProfile`, and a logged-out visitor should cost no
 * round trip at all.
 */
export async function getViewerShootAgain(
  supabase: SupabaseClient,
  spotId: string,
  profileId: string | null,
): Promise<0 | 1 | null> {
  if (!profileId) return null;

  const { data, error } = await supabase
    .from("signals")
    .select("value")
    .eq("spot_id", spotId)
    .eq("profile_id", profileId)
    .eq("kind", "shoot_again")
    .maybeSingle();

  if (error) throw error;
  return data ? ((data.value as 0 | 1) ?? null) : null;
}

const UNIQUE_VIOLATION = "23505";

/**
 * Spec §9.2: a duplicate vote is the state the caller asked for, already
 * present. Surfacing it would turn a double click into an error toast.
 *
 * Checks the SQLSTATE rather than the message, which is localised and free to
 * change. Matching on "already exists" text would also catch a 42501, which is
 * a completely different failure and must not be swallowed.
 */
export const isDuplicateSignal = (error: PostgrestError | null): boolean =>
  error?.code === UNIQUE_VIOLATION;

/**
 * One RPC, one transaction. Changing a vote is a delete plus an insert; done
 * from the client as two round trips, a delete that succeeds followed by an
 * insert that fails silently discards the vote the optimistic UI already drew
 * (spec §9.2).
 */
export async function castSignal(
  supabase: SupabaseClient,
  ref: SignalRef,
  value: 0 | 1 = 1,
): Promise<void> {
  const { error } = await supabase.rpc("cast_signal", {
    p_spot_id: ref.spotId,
    p_kind: ref.kind,
    p_shoot_type_id: ref.shootTypeId,
    p_value: value,
  });

  if (error && !isDuplicateSignal(error)) throw error;
}

/**
 * Taking a vote back. A plain DELETE rather than an RPC: it is a single
 * statement, so it is already atomic, and `signals_delete` limits it to the
 * caller's own rows — the authorization stays in RLS rather than in a filter
 * this function could forget.
 */
export async function retractSignal(
  supabase: SupabaseClient,
  ref: SignalRef,
): Promise<void> {
  // The `kind` filter is currently inert and no test can make it bite: the
  // `signals_shape` check gives shoot_again rows a null shoot_type_id and
  // upvotes a non-null one, so the shoot-type filter below already separates
  // the two kinds. It stays as defence for the day a second kind carries a
  // shoot type, which would make it load-bearing overnight.
  const query = supabase
    .from("signals")
    .delete()
    .eq("spot_id", ref.spotId)
    .eq("kind", ref.kind);

  // `.eq(col, null)` sends `col=eq.null`, which matches nothing. shoot_again
  // rows have a null shoot_type_id, so they need `is`.
  const { error } =
    ref.shootTypeId === null
      ? await query.is("shoot_type_id", null)
      : await query.eq("shoot_type_id", ref.shootTypeId);

  if (error) throw error;
}
```

- [ ] **Step 4: Run the test**

```bash
npm run test:db -- signals-data
```

Expected: 15 passing. If "retracts a shoot-again answer" fails, the `.is` vs `.eq` distinction in `retractSignal` is the cause — that is the trap the comment names.

- [ ] **Step 5: Mutation-test the duplicate rule and the null filter**

Run each against the committed file, confirming the mutation is genuinely installed before running the suite — a pattern that fails to match leaves the code unchanged and the suite green, which looks like a passing mutation test but is its opposite.

| Mutation | Test that must go red |
| --- | --- |
| `isDuplicateSignal` → `error !== null` | "does not mistake a permission error for a duplicate" **and** "refuses a logged-out caller with a permission error" |
| Delete the `if (error && !isDuplicateSignal(error)) throw error;` line entirely | "refuses a logged-out caller with a permission error" |
| `query.is("shoot_type_id", null)` → `query.eq("shoot_type_id", null)` | "retracts a shoot-again answer, matching the null shoot_type_id" |
| Drop `.eq("spot_id", ref.spotId)` from `retractSignal` | "retracts the vote on one spot only, not the same vote everywhere" |
| Drop the logged-out short circuit in `getViewerShootAgain` | "returns null for a logged-out visitor without querying" |
| Drop `.eq("kind", "shoot_again")` from `getViewerShootAgain` | "flips a shoot-again answer in one call" **and** "retracts a shoot-again answer" |
| `if (error) throw error;` → `if (false) …` in `getShootTypeVotes` | "throws when the summary RPC fails rather than returning nothing" |
| `viewerUpvoted: row.viewer_upvoted` → `false` | "records an upvote and reflects it back to the voter" |
| `if (error) throw error;` in `castSignal` (dropping only the duplicate check) | **nothing — survives** |
| Drop `.eq("kind", ref.kind)` from `retractSignal` | **nothing — survives** |

The two survivors are the honest result and both are worth knowing rather than papering over:

- The duplicate swallow is a concurrency guard the suite cannot deterministically provoke, because `cast_signal` deletes before it inserts. That is exactly why `isDuplicateSignal` is tested directly against an error Postgres really raised, rather than through `castSignal`.
- `retractSignal`'s `kind` filter is inert today: `signals_shape` gives `shoot_again` rows a null `shoot_type_id` and upvotes a non-null one, so the shoot-type filter already separates the kinds. It stays as defence for the day a second kind carries a shoot type, and the code says so.

The spot-filter row is the one that matters most and is easy to miss: with a single-spot fixture it also survives, and the bug it hides is a user taking back one upvote and silently losing the same vote on every other spot. The fixture therefore builds **two** spots.

- [ ] **Step 6: Commit**

```bash
git add app/data/signals.ts tests/db/signals-data.test.ts
git commit -m "$(cat <<'EOF'
feat: add the signals data layer

castSignal routes through the cast_signal RPC so a vote change stays one
transaction, and swallows 23505: a duplicate is the state the caller asked for
and a double click should be a no-op (spec §9.2). retractSignal is a plain
DELETE — a single statement is already atomic, and signals_delete limits it to
the caller's own rows, so authorization stays in RLS.

The duplicate swallow is a concurrency guard the suite cannot provoke
deterministically, so isDuplicateSignal is tested against an error Postgres
actually raised from the unique constraint rather than a hand-built object.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: The comments data layer

**Files:**
- Create: `app/data/comments.ts`
- Create: `supabase/migrations/20260810000010_comment_constraints.sql`
- Test: `tests/db/comments-data.test.ts`

**Widened scope (recorded during Task 2's review, not yet implemented):** `MAX_COMMENT_LENGTH`
in `app/domain/comments/comment.ts` is a product limit enforced only in a layer any client can
skip — `body` is currently unconstrained `text`, so a direct PostgREST insert can store up to 1GB
in a column every visitor to that spot then downloads. Separately, `comment.ts`'s
`validateComment` rejects on JS `.trim()`, which strips all Unicode whitespace, while the
database's `check (length(trim(body)) > 0)` uses Postgres `trim()`, which strips **only spaces**
(it is `btrim(body, ' ')`). Confirmed against the live local database during Task 2's review:
`"   "` (spaces only) is rejected with `23514`, but `"\n\t"`, `"   \n\t "`, and `" "` (U+00A0,
non-breaking space) are all **accepted** — a signed-in user can POST a blank-looking comment
straight to PostgREST (bypassing
this domain function entirely) and it will store and count toward `comment_count`, which feeds
`computeScore`.

The repo already resolved the identical question for photo caps: `MAX_PHOTOS_PER_KIND` is
duplicated into `enforce_photo_cap()` (`20260810000008_contribution.sql:33`) as a trigger below
the command layer, "so it holds for anything that reaches the table — the API directly, a future
import script, a careless migration." Apply the same resolution here — two numbers with two
different jobs, a generous hard ceiling in the schema as an abuse guard plus the tunable product
limit in TypeScript — rather than trying to make one number do both jobs:

- [ ] Replace the `comments_body` check with a whitespace-class test —
  `check (body ~ '[^[:space:]]')`, "contains at least one non-whitespace character," which is what
  `.trim().length > 0` actually means. POSIX `[:space:]` covers space, tab, newline, CR, FF, VT but
  **not** U+00A0, so a residual gap remains after this change too; document that rather than
  claiming parity with the TypeScript check. Whether a variant (e.g. adding ` ` to the
  excluded class) closes that residual gap needs to be tested against a running Postgres before
  it's written down as the answer — don't assume a regex snippet works from reasoning about it;
  confirm it, then record what was actually confirmed.
- [ ] Add `check (length(body) <= 10000)` as the abuse ceiling, with a migration comment
  explaining the two-numbers split, and noting that Postgres `length()` counts code points while
  JS `.length` counts UTF-16 units — the two limits must never be set equal, since a codepoint
  above the BMP would make the JS-side count exceed the Postgres-side count for the same string.
- [ ] Extend `tests/db/comments-data.test.ts`: the existing "refuses an empty body at the
  database" test should also assert `23514` for `"\n\t"` (not just spaces), and a new test should
  assert the 10000-codepoint ceiling rejects an over-long body.
- [ ] Once this migration lands, update the doc comment on `validateComment` in
  `app/domain/comments/comment.ts` — it currently says (accurately, as of Task 2) that this
  function is deliberately stricter than the database check and that the gap is tracked here.
  That wording will be stale once the whitespace-class and ceiling checks land, and needs to be
  rewritten to describe the new database behavior rather than left describing the old one.

- [ ] **Step 1: Verify the embedded-author shape against the running database**

The list query embeds the author through the `comments.profile_id → profiles.id` foreign key. PostgREST returns a to-one embed as an object, but supabase-js has typed it as an array in some versions, and this mapping has to match reality rather than documentation.

```bash
set -a && . ./.env && set +a && curl -s "$SUPABASE_URL/rest/v1/comments?select=id,body,profile_id,profiles(display_name)&limit=1" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Expected: `[]` or a row whose `profiles` field is an **object**, not an array. A `PGRST200` "Could not find a relationship" response means the embed name is wrong and the query below must be fixed before continuing.

- [ ] **Step 2: Write the failing test**

Create `tests/db/comments-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { listComments, addComment } from "../../app/data/comments";

let author: TestUser;
let leaver: TestUser;
let spotId: string;

beforeAll(async () => {
  author = await createTestUser("Comment Author");
  leaver = await createTestUser("Departing Photographer");

  const { data, error } = await serviceClient()
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Comments Park",
      slug: `comments-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.66 42.93)",
      created_by: author.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = data.id;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  await deleteTestUser(author.id);
});

describe("addComment / listComments", () => {
  it("stores a comment and lists it with its author", async () => {
    await addComment(author.client, spotId, "Best light is about an hour before sunset.", author.id);

    const comments = await listComments(anonClient(), spotId);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Best light is about an hour before sunset.");
    expect(comments[0].authorName).toBe("Comment Author");
    expect(comments[0].authorId).toBe(author.id);
  });

  it("trims the body it stores, so the database check sees what was validated", async () => {
    await addComment(author.client, spotId, "  Parking fills up by nine.  ", author.id);

    const comments = await listComments(anonClient(), spotId);
    expect(comments.map((c) => c.body)).toContain("Parking fills up by nine.");
  });

  it("orders oldest first", async () => {
    const comments = await listComments(anonClient(), spotId);
    const times = comments.map((c) => Date.parse(c.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("refuses an empty body at the database, not just in the form", async () => {
    const { error } = await author.client
      .from("comments")
      .insert({ spot_id: spotId, profile_id: author.id, body: "   " });
    expect(error?.code).toBe("23514");
  });

  it("refuses a logged-out commenter", async () => {
    await expect(
      addComment(anonClient(), spotId, "Drive-by spam.", author.id),
    ).rejects.toMatchObject({ code: "42501" });
  });

  // Spec §9.4: moderation is not reversible by the author, and removed content
  // is not shown to anyone else.
  it("hides a removed comment from other visitors", async () => {
    const { data } = await serviceClient()
      .from("comments")
      .insert({ spot_id: spotId, profile_id: author.id, body: "Removed later." })
      .select("id")
      .single();

    await serviceClient().from("comments").update({ status: "removed" }).eq("id", data!.id);

    const comments = await listComments(anonClient(), spotId);
    expect(comments.map((c) => c.id)).not.toContain(data!.id);
  });

  // Spec §4.6a: deleting an account must not destroy other people's context.
  // comments.profile_id is ON DELETE SET NULL, so the comment survives with no
  // author — and the mapping has to cope with the embed being null.
  it("keeps a comment whose author deleted their account, with no name", async () => {
    await addComment(leaver.client, spotId, "I shot a maternity session here in May.", leaver.id);
    await deleteTestUser(leaver.id);

    const comments = await listComments(anonClient(), spotId);
    const orphan = comments.find((c) => c.body.startsWith("I shot a maternity session"));
    expect(orphan).toBeDefined();
    expect(orphan!.authorId).toBeNull();
    expect(orphan!.authorName).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

```bash
npm run test:db -- comments-data
```

Expected: FAIL — `Failed to resolve import "../../app/data/comments"`.

- [ ] **Step 4: Write the implementation**

Create `app/data/comments.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SpotComment {
  id: string;
  body: string;
  createdAt: string;
  /** Null once the author deletes their account (spec §4.6a). */
  authorId: string | null;
  authorName: string | null;
}

interface CommentRow {
  id: string;
  body: string;
  created_at: string;
  profile_id: string | null;
  profiles: { display_name: string } | null;
}

/**
 * `status = 'published'` is written explicitly even though comments_read
 * enforces it. The RLS predicate is a disjunction, so it can never match a
 * partial index's predicate and the filter has to be in the query to be usable.
 *
 * Oldest first: the thread is flat (spec §6), and a conversation about a
 * location reads in the order it happened.
 */
export async function listComments(
  supabase: SupabaseClient,
  spotId: string,
  limit = 200,
): Promise<SpotComment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("id, body, created_at, profile_id, profiles(display_name)")
    .eq("spot_id", spotId)
    .eq("status", "published")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as unknown as CommentRow[]).map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    authorId: row.profile_id,
    authorName: row.profiles?.display_name ?? null,
  }));
}

/**
 * `profile_id` is supplied by the caller and checked by RLS
 * (`comments_insert with check (profile_id = auth.uid())`), so passing someone
 * else's id fails at the database rather than being trusted here.
 */
export async function addComment(
  supabase: SupabaseClient,
  spotId: string,
  body: string,
  profileId: string,
): Promise<void> {
  const { error } = await supabase.from("comments").insert({
    spot_id: spotId,
    profile_id: profileId,
    body: body.trim(),
  });

  if (error) throw error;
}
```

- [ ] **Step 5: Run the test**

```bash
npm run test:db -- comments-data
```

Expected: 7 passing. If the author name comes back `null` on the first test, the embed is an array in this version of supabase-js — change `row.profiles?.display_name` to read the first element and update `CommentRow` to match what step 1 actually showed.

- [ ] **Step 6: Mutation-test the moderation filter**

Remove `.eq("status", "published")` and re-run.

Expected: **"hides a removed comment from other visitors" fails.** If it passes, the test is leaning on RLS rather than on the query, and the explicit-filter rule is untested. Restore the filter.

- [ ] **Step 7: Commit**

```bash
git add app/data/comments.ts tests/db/comments-data.test.ts
git commit -m "$(cat <<'EOF'
feat: add the comments data layer

Lists published comments with their author embedded through profile_id, and
copes with that embed being null: comments.profile_id is ON DELETE SET NULL, so
a comment outlives its author's account with no name attached (spec §4.6a).

status = 'published' is filtered in the query rather than left to RLS. The
policy is a disjunction and can never match a partial index, and a test proves
the filter — not the policy — is what hides removed content from other readers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Writing the derived score

**Files:**
- Create: `app/data/scores.ts`
- Modify: `app/lib/env.server.ts`, `app/lib/supabase.server.ts`, `scripts/backfill-scores.ts`
- Test: `tests/db/score-refresh.test.ts`, `app/lib/env.server.test.ts`, `app/lib/supabase.server.test.ts`

Spec §7 puts the weights in TypeScript and the counters in Postgres, which leaves someone to multiply them together after a write. `authenticated` has no UPDATE privilege on `spots.score` — deliberately, since score drives the default sort order and a writable column would be rank manipulation. So the route action does it with a service-role client, exactly as `scripts/backfill-scores.ts` already does.

- [ ] **Step 1: Write the failing database test**

Create `tests/db/score-refresh.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { refreshSpotScore } from "../../app/data/scores";
import { castSignal } from "../../app/data/signals";
import { addComment } from "../../app/data/comments";
import { DEFAULT_WEIGHTS } from "../../app/domain/scoring/weights";

let voter: TestUser;
let spotId: string;
let familyId: number;

beforeAll(async () => {
  voter = await createTestUser("Score Voter");
  const admin = serviceClient();

  const { data: types } = await admin.from("shoot_types").select("id, slug").eq("slug", "family");
  familyId = types![0].id;

  const { data, error } = await admin
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Score Park",
      slug: `score-park-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.65 42.92)",
      created_by: voter.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = data.id;

  const { error: linkError } = await admin
    .from("spot_shoot_types")
    .insert({ spot_id: spotId, shoot_type_id: familyId });
  if (linkError) throw linkError;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  await deleteTestUser(voter.id);
});

const storedScore = async (): Promise<number> => {
  const { data } = await serviceClient().from("spots").select("score").eq("id", spotId).single();
  // numeric arrives from PostgREST as a string, to avoid precision loss.
  return Number(data!.score);
};

describe("refreshSpotScore", () => {
  it("starts at zero, since nothing has happened to the spot", async () => {
    expect(await storedScore()).toBe(0);
  });

  // The gap this closes: authenticated cannot write spots.score, so a vote
  // moves the counters and leaves the score behind.
  it("leaves the score stale until it is called", async () => {
    await castSignal(voter.client, {
      spotId,
      kind: "shoot_type_upvote",
      shootTypeId: familyId,
    });

    const { data } = await serviceClient()
      .from("spots")
      .select("shoot_type_upvote_count, score")
      .eq("id", spotId)
      .single();
    expect(data!.shoot_type_upvote_count).toBe(1);
    expect(Number(data!.score)).toBe(0);
  });

  it("writes the weighted score the counters imply", async () => {
    const written = await refreshSpotScore(serviceClient(), spotId);
    expect(written).toBe(DEFAULT_WEIGHTS.shootTypeUpvote);
    expect(await storedScore()).toBe(DEFAULT_WEIGHTS.shootTypeUpvote);
  });

  it("counts comments and shoot-again answers too, not just upvotes", async () => {
    await addComment(voter.client, spotId, "Gravel path, but short.", voter.id);
    await castSignal(voter.client, { spotId, kind: "shoot_again", shootTypeId: null }, 1);

    const expected =
      DEFAULT_WEIGHTS.shootTypeUpvote + DEFAULT_WEIGHTS.comment + DEFAULT_WEIGHTS.shootAgainYes;
    expect(await refreshSpotScore(serviceClient(), spotId)).toBe(expected);
    expect(await storedScore()).toBe(expected);
  });

  it("follows the counters back down when a vote is retracted", async () => {
    await serviceClient()
      .from("signals")
      .delete()
      .eq("spot_id", spotId)
      .eq("kind", "shoot_type_upvote");

    const expected = DEFAULT_WEIGHTS.comment + DEFAULT_WEIGHTS.shootAgainYes;
    expect(await refreshSpotScore(serviceClient(), spotId)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:db -- score-refresh
```

Expected: FAIL — `Failed to resolve import "../../app/data/scores"`.

- [ ] **Step 3: Write `app/data/scores.ts`**

Create `app/data/scores.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScore, type SpotCounters } from "../domain/scoring/score";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "../domain/scoring/weights";

/** The trigger-maintained columns, in one place so the backfill and the request path cannot drift. */
export const COUNTER_COLUMNS =
  "shoot_type_upvote_count, shoot_again_yes_count, shoot_again_no_count, comment_count, scouting_photo_count, session_photo_count";

export interface CounterRow {
  shoot_type_upvote_count: number;
  shoot_again_yes_count: number;
  shoot_again_no_count: number;
  comment_count: number;
  scouting_photo_count: number;
  session_photo_count: number;
}

export const toCounters = (row: CounterRow): SpotCounters => ({
  shootTypeUpvoteCount: row.shoot_type_upvote_count,
  shootAgainYesCount: row.shoot_again_yes_count,
  shootAgainNoCount: row.shoot_again_no_count,
  commentCount: row.comment_count,
  scoutingPhotoCount: row.scouting_photo_count,
  sessionPhotoCount: row.session_photo_count,
});

/**
 * Recompute and store one spot's score. Spec §7: the counters are dumb and live
 * in Postgres, the weights live in TypeScript, and this is where they meet.
 *
 * Requires a service-role client. `authenticated` has no UPDATE privilege on
 * `spots.score` and must not — score is the default sort order, so a writable
 * column is rank manipulation.
 *
 * Read-then-write, not one atomic statement: two votes landing together can
 * both read the same counters and write the same score, leaving it one vote
 * behind. The counters themselves are always right (the recount trigger is
 * statement-level and runs inside the vote's transaction), so this is a stale
 * derived number, not lost data, and `npm run backfill:scores` repairs it.
 * Making it atomic would mean doing the arithmetic in SQL — a second copy of
 * the weights in a second language, which is the drift spec §7 exists to stop.
 */
export async function refreshSpotScore(
  admin: SupabaseClient,
  spotId: string,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): Promise<number> {
  const { data, error } = await admin
    .from("spots")
    .select(COUNTER_COLUMNS)
    .eq("id", spotId)
    .single();

  if (error) throw error;

  const score = computeScore(toCounters(data as unknown as CounterRow), weights);

  const { error: writeError } = await admin.from("spots").update({ score }).eq("id", spotId);
  if (writeError) throw writeError;

  return score;
}
```

- [ ] **Step 4: Point the backfill script at the shared mapping**

In `scripts/backfill-scores.ts`, delete the local `CounterRow` interface and `toCounters` (lines 7–24) and the now-unused `SpotCounters` import, then use the shared ones:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeScore } from "../app/domain/scoring/score";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "../app/domain/scoring/weights";
import { COUNTER_COLUMNS, toCounters, type CounterRow } from "../app/data/scores";

const PAGE_SIZE = 500;
```

and replace the `.select(...)` argument with `COUNTER_COLUMNS`:

```ts
    const { data, error } = await supabase
      .from("spots")
      .select(COUNTER_COLUMNS)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
```

The rest of the file is unchanged. Two copies of this mapping is exactly how the backfill and the request path would come to disagree about what a counter means.

- [ ] **Step 5: Run the score and backfill tests together**

```bash
npm run test:db -- score-refresh backfill
```

Expected: 5 passing in `score-refresh`, and every existing test in `tests/db/backfill.test.ts` still passing.

- [ ] **Step 6: Add the service-role client, with a unit test**

Add to `app/lib/env.server.test.ts`:

```ts
  it("accepts a missing service role key, which only the write path needs", () => {
    const env = readEnv({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "anon",
    });
    expect(env.supabaseServiceRoleKey).toBeUndefined();
  });

  it("carries the service role key through when it is set", () => {
    const env = readEnv({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    });
    expect(env.supabaseServiceRoleKey).toBe("service");
  });
```

Add to `app/lib/supabase.server.test.ts`. That file already imports from `./supabase.server`; extend the existing import rather than adding a second one:

```ts
import { createSupabaseServerClient, createSupabaseAdminClient } from "./supabase.server";
```

```ts
describe("createSupabaseAdminClient", () => {
  const base = {
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseAnonKey: "anon",
    mapStyleUrl: "https://example.test/style.json",
  };

  // Loud, not silent: a missing key here means votes land and scores quietly
  // stop moving, which nothing else in the system would report.
  it("refuses to build a client without a service role key", () => {
    expect(() => createSupabaseAdminClient({ ...base, supabaseServiceRoleKey: undefined })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("builds a client when the key is present", () => {
    expect(createSupabaseAdminClient({ ...base, supabaseServiceRoleKey: "service" })).toBeDefined();
  });
});
```

(Keep the existing `describe` blocks in both files; these are additions.)

The existing `readEnv` test asserts the whole object with `toEqual`, which treats an `undefined` property as equal to a missing one — so it keeps passing once `supabaseServiceRoleKey: undefined` joins the return value. If it goes red, the assertion is `toStrictEqual` and needs the new key spelled out.

- [ ] **Step 7: Run the new unit tests and watch them fail**

```bash
npm run test:unit -- env.server supabase.server
```

Expected: FAIL — `supabaseServiceRoleKey` is not on `Env`, and `createSupabaseAdminClient` is not exported.

- [ ] **Step 8: Implement both**

In `app/lib/env.server.ts`, extend the schema and the interface:

```ts
const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  // Optional on purpose. readEnv() runs in every loader, so requiring this
  // would take the whole site down where it is absent rather than only the
  // paths that write derived columns — and production currently runs on
  // placeholder credentials (see docs/STATUS.md).
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  MAP_STYLE_URL: z.string().url().optional(),
});

export interface Env {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Server-only. Absent in environments that never write derived columns. */
  supabaseServiceRoleKey: string | undefined;
  mapStyleUrl: string;
}
```

and in the return object:

```ts
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
```

In `app/lib/supabase.server.ts`, add the import and the function:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnv, type Env } from "./env.server";
```

```ts
/**
 * Bypasses RLS. Only for writing columns the application roles deliberately
 * cannot write — `spots.score` is the whole reason this exists, because it is
 * the default sort order and a user-writable rank is rank manipulation.
 *
 * This file is `.server.ts`, so the key can never reach the browser bundle.
 * Takes its environment as an argument so the failure case is unit-testable
 * without mutating process.env.
 */
export function createSupabaseAdminClient(env: Env = readEnv()): SupabaseClient {
  if (!env.supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required to update derived columns such as spots.score.",
    );
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}
```

Note the existing `import type { SupabaseClient }` line must become a value import of `createClient` alongside it, as shown.

- [ ] **Step 9: Run everything**

```bash
npm run test:unit && npm run typecheck
```

Expected: all unit tests pass and typecheck is clean.

- [ ] **Step 10: Commit**

```bash
git add app/data/scores.ts app/lib/env.server.ts app/lib/env.server.test.ts app/lib/supabase.server.ts app/lib/supabase.server.test.ts scripts/backfill-scores.ts tests/db/score-refresh.test.ts
git commit -m "$(cat <<'EOF'
feat: recompute spots.score from a service-role client

Spec §7 splits the ranking deliberately: dumb counters in Postgres, weights in
TypeScript. Nothing joined them outside the backfill script, so a vote moved the
counters and left score behind — a test now asserts that stale state explicitly
before refreshSpotScore fixes it.

authenticated has no UPDATE on spots.score and must not: score is the default
sort order, so a writable column is rank manipulation. The key is optional in
readEnv because every loader calls it and production runs on placeholders, but
createSupabaseAdminClient throws rather than degrading quietly.

The counter mapping now lives in app/data/scores.ts and the backfill script
imports it, so the batch path and the request path cannot drift on what a
counter means.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Voting and comments on the detail page

**Files:**
- Create: `app/components/spot/VotePanel.tsx`, `app/components/spot/VotePanel.test.tsx`, `app/components/spot/CommentThread.tsx`, `app/components/spot/CommentThread.test.tsx`
- Modify: `app/routes/spots.$slug.tsx`

- [ ] **Step 1: Write the failing component tests**

The unit project runs in `node` with no DOM, so components are tested through the pure helpers they export — the same approach as `SpotCard.test.tsx`.

Create `app/components/spot/VotePanel.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { pendingUpvoteFrom, pendingShootAgainFrom, upvoteLabel } from "./VotePanel";

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
};

describe("pendingUpvoteFrom", () => {
  it("is null when no submission is in flight", () => {
    expect(pendingUpvoteFrom(undefined)).toBeNull();
  });

  it("reads an upvote in flight", () => {
    expect(pendingUpvoteFrom(form({ intent: "upvote", shootTypeId: "3" }))).toEqual({
      shootTypeId: 3,
      upvoted: true,
    });
  });

  it("reads a retraction in flight", () => {
    expect(pendingUpvoteFrom(form({ intent: "unvote", shootTypeId: "3" }))).toEqual({
      shootTypeId: 3,
      upvoted: false,
    });
  });

  it("ignores a submission for a different intent", () => {
    expect(pendingUpvoteFrom(form({ intent: "comment", body: "hi" }))).toBeNull();
  });
});

describe("pendingShootAgainFrom", () => {
  // undefined means "nothing in flight" and null means "retract", so these two
  // cases must not collapse into each other.
  it("distinguishes nothing-in-flight from a retraction", () => {
    expect(pendingShootAgainFrom(undefined)).toBeUndefined();
    expect(pendingShootAgainFrom(form({ intent: "shoot-again", answer: "retract" }))).toBeNull();
  });

  it("reads yes and no", () => {
    expect(pendingShootAgainFrom(form({ intent: "shoot-again", answer: "yes" }))).toBe(1);
    expect(pendingShootAgainFrom(form({ intent: "shoot-again", answer: "no" }))).toBe(0);
  });

  it("ignores a submission for a different intent", () => {
    expect(pendingShootAgainFrom(form({ intent: "upvote", shootTypeId: "1" }))).toBeUndefined();
  });
});

describe("upvoteLabel", () => {
  it("offers to add a vote", () => {
    expect(upvoteLabel({ shootTypeId: 1, label: "Family", upvoteCount: 2, viewerUpvoted: false }))
      .toBe("Upvote Family");
  });

  it("offers to take it back once cast", () => {
    expect(upvoteLabel({ shootTypeId: 1, label: "Family", upvoteCount: 3, viewerUpvoted: true }))
      .toBe("Remove your Family upvote");
  });
});
```

Create `app/components/spot/CommentThread.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { commentByline } from "./CommentThread";

const comment = (over = {}) => ({
  id: "c1",
  body: "Parking fills up by nine.",
  createdAt: "2026-08-10T17:30:00.000Z",
  authorId: "p1",
  authorName: "Dana",
  ...over,
});

describe("commentByline", () => {
  it("names the author and the day", () => {
    expect(commentByline(comment())).toBe("Dana · 2026-08-10");
  });

  // Spec §4.6a: the comment outlives the account that wrote it.
  it("says Anonymous when the author's account is gone", () => {
    expect(commentByline(comment({ authorId: null, authorName: null }))).toBe(
      "Anonymous · 2026-08-10",
    );
  });

  // A locale-formatted date would make this test pass or fail depending on the
  // machine running it.
  it("formats the date in UTC, so the byline does not move with the reader", () => {
    expect(commentByline(comment({ createdAt: "2026-08-10T23:30:00.000Z" }))).toContain(
      "2026-08-10",
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm run test:unit -- VotePanel CommentThread
```

Expected: FAIL — neither module exists.

- [ ] **Step 3: Write `VotePanel.tsx`**

Create `app/components/spot/VotePanel.tsx`:

```tsx
import { Link, useFetcher } from "react-router";
import {
  applyPendingUpvote,
  applyPendingShootAgain,
  type PendingUpvote,
  type PendingShootAgain,
  type ShootAgainState,
  type ShootTypeVoteState,
} from "~/domain/signals/vote-state";
import type { ShootTypeVotes } from "~/data/signals";

/**
 * The state a submission is asking for, read back out of the in-flight form.
 *
 * `fetcher.formData` rather than a useState mirror: React Router already holds
 * the pending submission, and a second copy of it is a second thing to keep in
 * sync — which is where optimistic UI usually goes wrong.
 */
export function pendingUpvoteFrom(formData: FormData | undefined): PendingUpvote | null {
  const intent = formData?.get("intent");
  if (intent !== "upvote" && intent !== "unvote") return null;

  const shootTypeId = Number(formData?.get("shootTypeId"));
  if (!Number.isInteger(shootTypeId)) return null;

  return { shootTypeId, upvoted: intent === "upvote" };
}

/** `undefined` is nothing in flight; `null` is an explicit retraction. */
export function pendingShootAgainFrom(formData: FormData | undefined): PendingShootAgain {
  if (formData?.get("intent") !== "shoot-again") return undefined;

  const answer = formData.get("answer");
  if (answer === "yes") return 1;
  if (answer === "no") return 0;
  if (answer === "retract") return null;
  return undefined;
}

export function upvoteLabel(row: ShootTypeVoteState): string {
  return row.viewerUpvoted ? `Remove your ${row.label} upvote` : `Upvote ${row.label}`;
}

/**
 * Its own fetcher per row, so one pending vote does not grey out the others.
 *
 * Typed as `{ error?: string }` rather than `typeof action`: importing the
 * route's action type into a component the route imports is a cycle, and the
 * error shape is the only part of the response this needs.
 */
function ShootTypeRow({ row, signedIn }: { row: ShootTypeVotes; signedIn: boolean }) {
  const fetcher = useFetcher<{ error?: string }>();
  const [shown] = applyPendingUpvote([row], pendingUpvoteFrom(fetcher.formData));

  return (
    <li className="vote-panel__row">
      <span className="vote-panel__label">{shown.label}</span>
      <span className="vote-panel__count">{shown.upvoteCount}</span>
      {signedIn ? (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value={shown.viewerUpvoted ? "unvote" : "upvote"} />
          <input type="hidden" name="shootTypeId" value={row.shootTypeId} />
          <button type="submit" aria-pressed={shown.viewerUpvoted}>
            {upvoteLabel(shown)}
          </button>
        </fetcher.Form>
      ) : null}
      {fetcher.data?.error && <span role="alert">{fetcher.data.error}</span>}
    </li>
  );
}

export function VotePanel({
  rows,
  shootAgain,
  signedIn,
}: {
  rows: ShootTypeVotes[];
  shootAgain: ShootAgainState;
  signedIn: boolean;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const shown = applyPendingShootAgain(shootAgain, pendingShootAgainFrom(fetcher.formData));

  return (
    <section className="vote-panel">
      <h2>What is it good for?</h2>
      {rows.length === 0 ? (
        <p>No shoot types on this spot yet.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <ShootTypeRow key={row.shootTypeId} row={row} signedIn={signedIn} />
          ))}
        </ul>
      )}

      <h2>Would you shoot here again?</h2>
      <p className="vote-panel__again">
        {shown.yesCount} yes · {shown.noCount} no
      </p>

      {signedIn ? (
        <fetcher.Form method="post" className="vote-panel__again-form">
          <input type="hidden" name="intent" value="shoot-again" />
          <button type="submit" name="answer" value="yes" aria-pressed={shown.viewerAnswer === 1}>
            Yes
          </button>
          <button type="submit" name="answer" value="no" aria-pressed={shown.viewerAnswer === 0}>
            No
          </button>
          {shown.viewerAnswer !== null && (
            <button type="submit" name="answer" value="retract">
              Clear my answer
            </button>
          )}
          {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
        </fetcher.Form>
      ) : (
        <p>
          <Link to="/auth/login">Sign in</Link> to vote or comment.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Write `CommentThread.tsx`**

Create `app/components/spot/CommentThread.tsx`:

```tsx
import { useFetcher } from "react-router";
import type { SpotComment } from "~/data/comments";
import { MAX_COMMENT_LENGTH } from "~/domain/comments/comment";

/**
 * ISO date, sliced, not `toLocaleDateString`: a locale-formatted byline renders
 * differently for the reader than for the test, and this is the kind of thing
 * that only fails on somebody else's machine.
 */
export function commentByline(comment: SpotComment): string {
  const day = comment.createdAt.slice(0, 10);
  return `${comment.authorName ?? "Anonymous"} · ${day}`;
}

export function CommentThread({
  comments,
  signedIn,
}: {
  comments: SpotComment[];
  signedIn: boolean;
}) {
  // `{ error?: string }` rather than `typeof action`, which would be a cycle:
  // the route imports this component.
  const fetcher = useFetcher<{ error?: string }>();
  const posting = fetcher.state !== "idle";

  return (
    <section className="comments">
      <h2>Comments</h2>

      {comments.length === 0 ? (
        <p>Nobody has said anything about this spot yet.</p>
      ) : (
        <ul className="comments__list">
          {comments.map((c) => (
            <li key={c.id}>
              <p className="comments__byline">{commentByline(c)}</p>
              <p className="comments__body">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {signedIn && (
        <fetcher.Form method="post" className="comments__form">
          <input type="hidden" name="intent" value="comment" />
          <label>
            Add a comment
            <textarea name="body" rows={3} maxLength={MAX_COMMENT_LENGTH} required />
          </label>
          {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
          <button type="submit" disabled={posting}>
            {posting ? "Posting…" : "Post comment"}
          </button>
        </fetcher.Form>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the component tests**

```bash
npm run test:unit -- VotePanel CommentThread
```

Expected: 12 passing.

- [ ] **Step 6: Wire the route**

In `app/routes/spots.$slug.tsx`, replace the import block, the loader, and the page body. Add to the imports:

```tsx
import { getShootTypeVotes, getViewerShootAgain, castSignal, retractSignal } from "~/data/signals";
import { listComments, addComment } from "~/data/comments";
import { validateComment } from "~/domain/comments/comment";
import { refreshSpotScore } from "~/data/scores";
import { createSupabaseServerClient, createSupabaseAdminClient } from "~/lib/supabase.server";
import { VotePanel } from "~/components/spot/VotePanel";
import { CommentThread } from "~/components/spot/CommentThread";
```

(`createSupabaseServerClient` is already imported — extend that line rather than duplicating it.)

Extend the loader, after the existing `media` / `profile` pair:

```tsx
  const [shootTypeVotes, viewerShootAgain, comments] = await Promise.all([
    getShootTypeVotes(supabase, spot.id),
    getViewerShootAgain(supabase, spot.id, profile?.id ?? null),
    listComments(supabase, spot.id),
  ]);

  return routeData(
    {
      spot,
      media,
      profile,
      supabaseUrl: env.supabaseUrl,
      shootTypeVotes,
      shootAgain: {
        yesCount: spot.shootAgainYesCount,
        noCount: spot.shootAgainNoCount,
        viewerAnswer: viewerShootAgain,
      },
      comments,
    },
    { headers },
  );
```

Add the action:

```tsx
export async function action({ request, params }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const profile = await getCurrentProfile(supabase);
  // Voting and commenting require an account; browsing never does (spec §4.6).
  if (!profile) {
    return routeData({ error: "Sign in to vote or comment." }, { headers, status: 401 });
  }

  const spot = await getSpotBySlug(supabase, params.slug);
  if (!spot) throw new Response("Not found", { status: 404, headers });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    switch (intent) {
      case "upvote":
      case "unvote": {
        const shootTypeId = Number(form.get("shootTypeId"));
        if (!Number.isInteger(shootTypeId)) {
          return routeData({ error: "Unknown shoot type." }, { headers, status: 400 });
        }
        const ref = { spotId: spot.id, kind: "shoot_type_upvote" as const, shootTypeId };
        if (intent === "upvote") await castSignal(supabase, ref, 1);
        else await retractSignal(supabase, ref);
        break;
      }
      case "shoot-again": {
        const ref = { spotId: spot.id, kind: "shoot_again" as const, shootTypeId: null };
        const answer = String(form.get("answer") ?? "");
        if (answer === "retract") await retractSignal(supabase, ref);
        else if (answer === "yes") await castSignal(supabase, ref, 1);
        else if (answer === "no") await castSignal(supabase, ref, 0);
        else return routeData({ error: "Unknown answer." }, { headers, status: 400 });
        break;
      }
      case "comment": {
        const body = String(form.get("body") ?? "");
        const { errors } = validateComment(body);
        if (errors.length > 0) {
          return routeData({ error: errors[0].message }, { headers, status: 400 });
        }
        await addComment(supabase, spot.id, body, profile.id);
        break;
      }
      default:
        return routeData({ error: "Unknown action." }, { headers, status: 400 });
    }
  } catch (err) {
    return routeData(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { headers, status: 500 },
    );
  }

  // The write landed; the derived score is what is left. spots.score is not
  // writable by `authenticated` (it is the default sort order), so this needs
  // the service-role client.
  //
  // A failure here must not be reported as a failed vote, because the vote
  // succeeded — but it must not be silent either, since nothing else in the
  // system would notice a score that stopped moving.
  try {
    await refreshSpotScore(createSupabaseAdminClient(), spot.id);
  } catch (err) {
    console.error(
      `Score refresh failed for spot ${spot.id}; the vote or comment was saved. ` +
        `Run \`npm run backfill:scores\` to repair. Cause:`,
      err,
    );
  }

  return routeData({ ok: true }, { headers });
}
```

Replace the placeholder line at the bottom of the component. Delete:

```tsx
      <p className="spot-detail__pending">Comments and voting arrive in the next milestone.</p>
```

and put in its place:

```tsx
      <VotePanel
        rows={shootTypeVotes}
        shootAgain={shootAgain}
        signedIn={profile !== null}
      />

      <CommentThread comments={comments} signedIn={profile !== null} />
```

Update the destructuring at the top of the component:

```tsx
  const { spot, media, profile, supabaseUrl, shootTypeVotes, shootAgain, comments } = loaderData;
```

The totals line above (`spot.shootTypeUpvoteCount` upvotes · …) stays: it is the lifetime summary, and the panel is the breakdown.

- [ ] **Step 7: Typecheck and run everything**

```bash
npm run typecheck && npm test
```

Expected: clean typecheck; all previous tests plus the new ones passing.

- [ ] **Step 8: Commit**

```bash
git add app/components/spot/ app/routes/spots.\$slug.tsx
git commit -m "$(cat <<'EOF'
feat: add voting and comments to the spot detail page

One action with an intent switch, and a fetcher per vote so a pending upvote
does not freeze the rest of the page. Optimistic state is read back out of
fetcher.formData rather than mirrored into useState — React Router already
holds the pending submission, and rollback then costs nothing: when the fetcher
settles the loader revalidates and the server's numbers replace the guess.

A failed score refresh is logged with the repair command rather than reported
as a failed vote. The vote did land; the derived column is what is behind.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Verify it end to end, then sync the docs

Nothing above proves a human can vote. The two silent auth bugs this project has already hit were both found by scripting the flow rather than reading the code (`docs/ENGINEERING-NOTES.md`, "Verify by script, not by eye").

**Files:**
- Modify: `docs/STATUS.md`, `README.md`, `docs/superpowers/plans/2026-08-10-photospots-signals.md`
- Possibly modify: `docs/ENGINEERING-NOTES.md`

- [ ] **Step 1: Confirm the whole suite and the build**

```bash
npm test && npm run typecheck && npm run build
```

Expected: all three clean. Record the test count.

- [ ] **Step 2: Drive the real application**

Start the dev server through the preview tooling (never `npm run dev` in a bash call), then:

1. Open a seeded spot — `/spots/fish-ladder-park` — logged out. Confirm the vote counts render, no vote buttons appear, and the comment form is absent.
2. Sign in through `/auth/login`, collecting the magic link from Mailpit at `http://127.0.0.1:54324`.
3. Upvote a shoot type. Confirm the count moves and the button flips to "Remove your … upvote".
4. Click the same button again to retract. Confirm the count returns.
5. Answer "would you shoot here again?" yes, then no. Confirm the yes count drops as the no count rises — one vote, moved, not two.
6. Post a comment. Confirm it appears with your display name and today's date.
7. Check the browser console and the server log for errors.

- [ ] **Step 3: Confirm the score actually moved**

Immediately after step 2's voting, with the spot slug you used:

```bash
set -a && . ./.env && set +a && curl -s "$SUPABASE_URL/rest/v1/spots?slug=eq.fish-ladder-park&select=slug,score,shoot_type_upvote_count,shoot_again_yes_count,shoot_again_no_count,comment_count" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Expected: `score` equals `computeScore` over those counters with `DEFAULT_WEIGHTS` — upvotes ×1.0 + shoot-again yes ×2.0 + shoot-again no ×−1.5 + comments ×0.5 + scouting photos ×1.0 + session photos ×1.5. Do the arithmetic and check it. A score of 0 next to non-zero counters means the refresh silently failed; the server log will say why.

- [ ] **Step 4: Confirm the ranking is consistent**

```bash
npm run backfill:scores
```

Then re-run the query from step 3. Expected: **`score` is unchanged.** The backfill and the request path both route through `computeScore` over the same counter mapping, so a difference here means they have drifted — which is precisely what task 6's shared `toCounters` exists to prevent.

- [ ] **Step 5: Update `docs/STATUS.md`**

- Move milestone 4 to ✅ with a link to this plan; mark 5 as Next.
- Update the test count and the date in the header.
- Rewrite the "Next: plan 4" section as "Next: plan 5 — filters and remaining views", listing what plan 5 needs (shoot-type and attribute filters are partly built: `parseExploreFilters` already handles `type`, `sort` and `view`; the map and gallery arrangements are not).
- Add `spot_signal_summary` to the function list and `signals`, `comments`, `scores` to the `app/data/` list.
- Add to "Known gaps, deliberately deferred": **the score refresh is read-then-write, so two simultaneous votes can leave `score` one vote behind until the next backfill.** Note that the counters are never wrong, only the derived number.
- Note that voting and commenting need `SUPABASE_SERVICE_ROLE_KEY` in the app environment, not just for scripts.

- [ ] **Step 6: Update `README.md`**

Extend the feature list with voting and comments, in the same voice as the existing entries.

- [ ] **Step 7: Sync this plan with what was actually built**

Tick every checkbox. Where the implementation deviated from the plan, edit the plan text to match the code and say so in the commit message. Several bugs in this project were caught precisely by comparing plan against code, which only works if the plan is kept honest.

- [ ] **Step 8: Add any new trap to `docs/ENGINEERING-NOTES.md`**

Only if this plan hit a real one. Candidates that would qualify: the `.is` vs `.eq` null-filter distinction in PostgREST, or the shape of an embedded to-one resource. Do not add anything that was merely anticipated — every entry in that file is a bug that shipped or nearly shipped, and diluting it with hypotheticals is how it stops being read.

- [ ] **Step 9: Commit**

```bash
git add docs/ README.md
git commit -m "$(cat <<'EOF'
docs: record the voting and comments milestone

Plan 4 ticked off against what was actually built, STATUS moved to milestone 5,
and the read-then-write score refresh recorded as a known gap: two simultaneous
votes can leave spots.score one vote behind until the next backfill. The
counters are never wrong — only the derived number.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

Checked against spec §13 milestone 4 ("Signals — voting, comments, counters, score and hot computation, backfill script, sort orders"):

| Requirement | Where |
| --- | --- |
| Voting | Tasks 1, 3, 4, 7 |
| Comments | Tasks 2, 5, 7 |
| Counters | Already built (migration 4); tasks 4 and 6 assert they stay correct across a flip |
| Score computation | Task 6 — the gap was the write, not the arithmetic |
| Hot computation | Already built — `scripts/refresh-hot-scores.ts`, `domain/scoring/hot.ts` |
| Backfill script | Already built; task 6 re-points it at the shared counter mapping, task 8 step 4 proves the two paths agree |
| Sort orders | Already built — `p_sort` in `spots_in_viewport`, `sort` in `parseExploreFilters` |

Deliberately **not** in this plan, and why:

- **Reporting a comment.** Spec §9.4 puts reports in milestone 6 with the admin queue. Building the report button without the queue produces rows nobody can action.
- **Editing or deleting your own comment.** `comments_update` allows it, but nothing in the spec's MVP scope asks for it, and the moderation-reversal rule makes the status handling subtle enough to want its own task.
- **Votes on the explore list.** Spec §8 puts the vote UI on the detail page. Voting from a card would need the summary in the viewport RPC, which is a per-row lateral join over every spot in view.
