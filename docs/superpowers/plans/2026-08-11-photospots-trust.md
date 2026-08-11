# Photospots Trust and Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give anyone a way to report a spot, photo or comment; give an admin one queue to act on those reports with hide and remove; and let a studio owner claim their listing.

**Architecture:** Resolving a report changes two rows — the target's status and the report itself — and doing that as two client calls leaves a half-resolved state nobody notices. So resolution is a single `resolve_report` function, `security definer` because `admin` is an application role rather than a Postgres one and no column grant can express it. The queue needs its own read path, because every existing spot query filters `status = 'published'` and an admin therefore cannot see what they just hid.

**Tech Stack:** React Router v8 · Supabase (Postgres, RLS, `security definer` functions) · Vitest

**Plan sequence:** Plan 6 of 6, the last MVP milestone. Plans 1–5 are complete with 440 passing tests across 45 files.

**Spec:** `docs/superpowers/specs/2026-08-09-photospots-design.md` — §3 (reports and takedown in MVP scope), §4.3 (a working takedown path is non-negotiable), §4.6 (trust and moderation), §9.3 (studio claim), §9.4 (reports and takedown; moderation must not be reversible by the author).

**Commit convention:** every commit message ends with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## What plans 1–5 leave you

Probed against the running database rather than read off the schema, because plan 5's lesson was that a missing write path is invisible from the schema alone. An admin user and an ordinary user were created, then each action attempted:

| Action | Result |
| --- | --- |
| `is_admin()` as an admin / as a user | `true` / `false` |
| Ordinary user inserts a report | **OK** |
| Admin reads the report queue | **OK** |
| Ordinary user reads the report queue | OK, **0 rows** — RLS hides it |
| Admin resolves a report (`status → resolved`) | **OK** |
| Admin removes a **comment** (`status → removed`) | **OK** |
| Admin hides a **spot** (`status → hidden`) | **`42501 permission denied for table spots`** |

**The gap that shapes this plan: hide and remove — the two resolution actions spec §9.4 names — are impossible on a spot.** `status` is deliberately absent from the column grants on `spots`, and that is correct: it is moderation state and must not be writable by the submitter. But `admin` is a value in `profiles.role`, not a Postgres role, so **no column grant can grant it to admins only**. Comments and photos are moderatable today only because their `UPDATE` grant is table-wide, which is the looser thing rather than the more considered one.

**Three more findings from the same probe:**

- **An admin cannot read what they have hidden.** `spot_by_slug` and `spots_in_viewport` both filter `status = 'published'`, so a hidden or removed spot disappears for everyone, admins included. A queue that cannot show the reported content is not a queue.
- **`reports.target_id` is polymorphic with no foreign key** — the table has two FKs, both to `profiles`. Deleting a spot leaves its reports pointing at nothing, and the queue has to resolve targets per `target_type`.
- **`claim_studio()` exists, is granted to `authenticated`, and has no caller anywhere in `app/`.** There is no `/studios/:slug` route either.

**One piece of test hygiene, noticed in passing:** the database currently holds 10 reports left behind by the existing suite (6 open, 4 resolved). Task 3 cleans up after itself; the pre-existing strays are worth a sweep while you are in `tests/db/rls.test.ts`.

**Two asymmetries to design around, not around which to paper over:**

1. `spots.status` is `spot_status` (`published | hidden | removed`); `photos.status` and `comments.status` are `content_status` (`published | removed`). **Hide exists only for spots.** The queue must not offer an action the target cannot take.
2. RLS already stops an author reversing moderation (`comments_update` and `photos_update` require `status = 'published'` for non-admins). `spots_update` does the same. Nothing new is needed there — but a test should prove it still holds once resolution runs through a `security definer` function, since that function bypasses those policies by design.

**Constraints carried forward. Each was a real bug once — see `docs/ENGINEERING-NOTES.md`:**

1. **Changing a function's arguments means `DROP`, not `create or replace`** — otherwise two overloads go live and PostgREST serves the old one. The drop takes the grants with it. This plan changes `spot_by_slug`, so it applies directly.
2. `revoke execute … from public` **before** granting any new function.
3. Assert `error.code`, never merely that an error is non-null.
4. An update RLS forbids reports **no error** — it matches zero rows. Check what changed, not that nothing failed.
5. `security definer` pins `search_path = ''` and schema-qualifies every reference.
6. Loaders and actions return `data(obj, { headers })`, and every return path carries `headers`.
7. A test that guards specific behavior must go red when that behavior breaks — and confirm the mutation was installed before believing a green suite.

---

## Design decisions

**Resolution is one function, not two writes.** Hiding a spot and marking its report resolved are two rows. Done as two calls, a failure between them leaves either content hidden with the report still open (an admin does the work twice) or a report closed over content still live (the report is lost). `resolve_report(report_id, action)` does both in one transaction — the same argument that produced `cast_signal` in plan 4, and the reason that one exists is worth re-reading before deciding this is over-engineering.

**`security definer`, and why there is no alternative.** `admin` lives in `profiles.role`. Postgres grants are per database role, and every signed-in user is the same `authenticated` role, so "grant UPDATE on `spots.status` to admins" is not expressible. The options are a definer function that checks `is_admin()` itself, or making `status` writable by everyone and relying on a policy — which is exactly the "policies authorize rows, grants authorize columns" trap in `ENGINEERING-NOTES.md`. This plan takes the function, and it must pin `search_path = ''` and re-check `is_admin()` on every call rather than trusting its caller.

**The queue reads through its own RPC.** Rather than loosening `spot_by_slug` for admins — which would put a moderation concern into the path every visitor takes — `admin_report_queue()` is a separate `security definer` read that returns each open report alongside enough of its target to judge it. One function, admin-only, and the public read path is untouched.

**Dismiss is a first-class action.** Spec §9.4 names hide and remove; `report_status` also has `dismissed`. A queue with no way to say "this is fine" fills up with reports an admin keeps re-reading. Dismissing resolves the report and leaves the target alone.

**Reporting requires an account.** `reports_insert` already demands `profile_id = auth.uid()`. Spec §4.6 keeps browsing open but gates contribution, and an anonymous report button is an abuse vector with no rate limit behind it.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260811000014_moderation.sql` | `resolve_report`, `admin_report_queue`, `spot_by_slug` extended, grants |
| `app/domain/reports/reasons.ts` | Report reason vocabulary and the actions each target allows. Pure. |
| `app/data/reports.ts` | File a report, read the queue, resolve one |
| `app/data/studios.ts` | Studio details, and the claim call |
| `app/components/spot/ReportButton.tsx` | The report control and its dialog |
| `app/components/admin/ReportRow.tsx` | One queue entry and its actions |
| `app/routes/admin.tsx` | The queue |
| `app/routes/studios.$slug.tsx` | Studio detail and the claim flow |
| `app/routes/spots.$slug.tsx` | Report controls on the spot and its comments |
| `app/routes.ts` | Two new routes |

`reasons.ts` is separate from `reports.ts` for the same reason `attributes.ts` is separate from `attribute-filters.ts`: one is the vocabulary the UI and the database agree on, the other is how the application talks to a table. They change for different reasons.

---

## Task 1: Report reasons and the actions a target allows

**Files:**
- Create: `app/domain/reports/reasons.ts`, `app/domain/reports/reasons.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/domain/reports/reasons.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  REPORT_REASONS,
  isReportReason,
  actionsFor,
  labelForReason,
  type ReportTarget,
} from "./reasons";

describe("REPORT_REASONS", () => {
  it("offers the takedown reason spec §4.3 requires", () => {
    expect(REPORT_REASONS.map((r) => r.value)).toContain("rights");
  });

  it("keeps values machine-shaped and labels human-shaped", () => {
    for (const reason of REPORT_REASONS) {
      expect(reason.value).toMatch(/^[a-z][a-z_]*$/);
      expect(reason.label[0]).toMatch(/[A-Z]/);
    }
  });

  it("has no duplicate values", () => {
    const values = REPORT_REASONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("recognises which strings are reasons", () => {
    expect(isReportReason("rights")).toBe(true);
    expect(isReportReason("Rights")).toBe(false);
    expect(isReportReason("")).toBe(false);
  });

  it("labels a known reason and falls back to the raw value", () => {
    expect(labelForReason("rights")).not.toBe("rights");
    // Reports filed before a reason was renamed still have to render.
    expect(labelForReason("mystery")).toBe("mystery");
  });
});

describe("actionsFor", () => {
  // spots.status is spot_status (published | hidden | removed); photos and
  // comments are content_status (published | removed). Hide does not exist for
  // them, and a queue must not offer an action the target cannot take.
  it("offers hide only for a spot", () => {
    expect(actionsFor("spot")).toContain("hide");
    expect(actionsFor("photo")).not.toContain("hide");
    expect(actionsFor("comment")).not.toContain("hide");
  });

  it("offers remove and dismiss for every target", () => {
    for (const target of ["spot", "photo", "comment"] as ReportTarget[]) {
      expect(actionsFor(target)).toContain("remove");
      expect(actionsFor(target)).toContain("dismiss");
    }
  });

  it("never offers the same action twice", () => {
    for (const target of ["spot", "photo", "comment"] as ReportTarget[]) {
      const actions = actionsFor(target);
      expect(new Set(actions).size).toBe(actions.length);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:unit -- reasons
```

Expected: FAIL — `Failed to resolve import "./reasons"`.

- [ ] **Step 3: Write the implementation**

Create `app/domain/reports/reasons.ts`:

```ts
/** Mirrors the `public.report_target` enum. */
export type ReportTarget = "spot" | "photo" | "comment";

/** What an admin can do about a report. `hide` is spot-only — see actionsFor. */
export type ResolutionAction = "hide" | "remove" | "dismiss";

export interface ReportReason {
  value: string;
  label: string;
}

/**
 * `reports.reason` is free text in the schema, so this is the only vocabulary
 * there is — the same drift risk the accessibility columns had before plan 5
 * pinned them. Kept in the domain layer because the reason list is expected to
 * change from what people actually report, which is a poor fit for a migration.
 *
 * `rights` is not optional: spec §4.3 requires a working takedown path from day
 * one, and these are photographs of real families.
 */
export const REPORT_REASONS: readonly ReportReason[] = Object.freeze([
  { value: "rights", label: "It is my photo and I did not agree to this" },
  { value: "private_land", label: "This is private property" },
  { value: "unsafe", label: "Going here is unsafe" },
  { value: "wrong_place", label: "The pin or the details are wrong" },
  { value: "spam", label: "Spam or advertising" },
  { value: "abuse", label: "Abusive or offensive" },
]);

export const isReportReason = (value: string): boolean =>
  REPORT_REASONS.some((r) => r.value === value);

/** Falls back to the raw value so a renamed reason does not blank an old report. */
export const labelForReason = (value: string): string =>
  REPORT_REASONS.find((r) => r.value === value)?.label ?? value;

/**
 * `spots.status` is `spot_status` (published | hidden | removed) but
 * `photos.status` and `comments.status` are `content_status`
 * (published | removed). Hiding a comment is not a state the column can hold,
 * so the queue must not offer it.
 */
export function actionsFor(target: ReportTarget): ResolutionAction[] {
  return target === "spot" ? ["hide", "remove", "dismiss"] : ["remove", "dismiss"];
}
```

- [ ] **Step 4: Run the test**

```bash
npm run test:unit -- reasons
```

Expected: 8 passing.

- [ ] **Step 5: Mutation-test**

| Mutation | Test that must go red |
| --- | --- |
| `actionsFor` returns the same list for every target | "offers hide only for a spot" |
| Drop `"dismiss"` from the non-spot branch | "offers remove and dismiss for every target" |
| `isReportReason` compares case-insensitively | "recognises which strings are reasons" |
| `labelForReason` returns `""` instead of the raw value | "labels a known reason and falls back to the raw value" |

- [ ] **Step 6: Commit**

```bash
git add app/domain/reports/
git commit -m "$(cat <<'EOF'
feat: add the report reason vocabulary

reports.reason is free text in the schema, so this is the only vocabulary there
is — the same drift the accessibility columns had before plan 5 pinned them.

actionsFor encodes an asymmetry that is easy to miss: spots.status is
spot_status (published, hidden, removed) while photos and comments are
content_status (published, removed). Hide is not a state a comment can hold, so
the queue must not offer it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: The moderation write and read paths

**Files:**
- Create: `supabase/migrations/20260811000014_moderation.sql`
- Test: `tests/db/moderation.test.ts`

- [ ] **Step 1: Record the exact `spot_by_slug` signature before touching it**

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker exec supabase_db_photospots psql -U postgres -d postgres -tAc \
  "select oid::regprocedure from pg_proc where proname = 'spot_by_slug';"
```

You are adding `created_by` and `owner_profile_id` to its return type, which means dropping it. A `create or replace` that changes only the *return* type fails outright ("cannot change return type of existing function"), so this one will not silently overload — but the drop still discards the grants, which must be rewritten. Copy the existing body out of `20260810000007_explore.sql` rather than reconstructing it.

- [ ] **Step 2: Write the failing test**

Create `tests/db/moderation.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";

let boss: TestUser;
let author: TestUser;
let spotId: string;
let spotSlug: string;
let commentId: string;
let spotReportId: string;
let commentReportId: string;

const admin = () => serviceClient();

/** Promotes a test user to admin, which no application code may do (plan 1). */
const promote = async (id: string) => {
  const { error } = await admin().from("profiles").update({ role: "admin" }).eq("id", id);
  if (error) throw error;
};

beforeAll(async () => {
  boss = await createTestUser("Moderator");
  author = await createTestUser("Reported Author");
  await promote(boss.id);

  spotSlug = `moderation-${crypto.randomUUID().slice(0, 8)}`;
  const { data: spot, error } = await admin()
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Moderation Target",
      slug: spotSlug,
      location: "POINT(-85.68 42.95)",
      created_by: author.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = spot.id;

  const { data: comment } = await admin()
    .from("comments")
    .insert({ spot_id: spotId, profile_id: author.id, body: "Reported comment." })
    .select("id")
    .single();
  commentId = comment!.id;

  // Both objects carry the same keys: PostgREST unions the keys of a bulk
  // insert and nulls the gaps, bypassing column defaults.
  const { data: reports, error: reportError } = await admin()
    .from("reports")
    .insert([
      { target_type: "spot", target_id: spotId, profile_id: author.id, reason: "unsafe", note: null },
      { target_type: "comment", target_id: commentId, profile_id: author.id, reason: "abuse", note: null },
    ])
    .select("id, target_type");
  if (reportError) throw reportError;
  spotReportId = reports!.find((r) => r.target_type === "spot")!.id;
  commentReportId = reports!.find((r) => r.target_type === "comment")!.id;
});

afterAll(async () => {
  await admin().from("reports").delete().eq("target_id", spotId);
  await admin().from("reports").delete().eq("target_id", commentId);
  const { error } = await admin().from("spots").delete().eq("id", spotId);
  if (error) throw error;
  await deleteTestUser(boss.id);
  await deleteTestUser(author.id);
});

const statusOf = async (table: "spots" | "comments", id: string) => {
  const { data } = await admin().from(table).select("status").eq("id", id).single();
  return data!.status;
};

const reportRow = async (id: string) => {
  const { data } = await admin().from("reports").select("status, resolved_by").eq("id", id).single();
  return data!;
};

/** A throwaway open report on the spot, for tests that need to consume one. */
const spareReport = async (targetType: "spot" | "comment", targetId: string) => {
  const { data } = await admin()
    .from("reports")
    .insert({ target_type: targetType, target_id: targetId, profile_id: author.id, reason: "spam" })
    .select("id")
    .single();
  return data!.id as string;
};

// These run in order and share state: the spot is hidden partway through.
describe("resolve_report", () => {
  it("refuses a caller who is not an admin", async () => {
    const { error } = await author.client.rpc("resolve_report", {
      p_report_id: spotReportId,
      p_action: "remove",
    });
    expect(error).not.toBeNull();
    expect(await statusOf("spots", spotId)).toBe("published");
  });

  it("refuses a logged-out caller", async () => {
    const { error } = await anonClient().rpc("resolve_report", {
      p_report_id: spotReportId,
      p_action: "remove",
    });
    expect(error?.code).toBe("42501");
  });

  // The gap this function exists to close: an admin cannot write spots.status
  // through PostgREST at all, because `admin` is a value in profiles.role and
  // no column grant can express it.
  it("hides a spot, which a direct update cannot do even as an admin", async () => {
    const direct = await boss.client.from("spots").update({ status: "hidden" }).eq("id", spotId);
    expect(direct.error?.code).toBe("42501");

    const { error } = await boss.client.rpc("resolve_report", {
      p_report_id: spotReportId,
      p_action: "hide",
    });
    expect(error).toBeNull();
    expect(await statusOf("spots", spotId)).toBe("hidden");
  });

  // Both rows move together, or an admin does the work twice and the queue
  // never empties.
  it("resolves the report in the same call", async () => {
    const row = await reportRow(spotReportId);
    expect(row.status).toBe("resolved");
    expect(row.resolved_by).toBe(boss.id);
  });

  it("removes a comment", async () => {
    const { error } = await boss.client.rpc("resolve_report", {
      p_report_id: commentReportId,
      p_action: "remove",
    });
    expect(error).toBeNull();
    expect(await statusOf("comments", commentId)).toBe("removed");
    expect((await reportRow(commentReportId)).status).toBe("resolved");
  });

  // spots.status is spot_status; comments.status is content_status, which has
  // no 'hidden'. Asking for one must fail loudly rather than storing something
  // adjacent.
  // The guard is about the message, not the outcome: without it,
  // `'hidden'::content_status` raises 22P02 and the report is left open just
  // the same. Asserting only "something threw" therefore passes with the guard
  // removed — so this asserts the sentence an admin would actually read.
  it("refuses to hide a comment, and says why rather than naming an enum", async () => {
    const id = await spareReport("comment", commentId);
    const { error } = await boss.client.rpc("resolve_report", { p_report_id: id, p_action: "hide" });

    expect(error?.message).toMatch(/only a spot can be hidden/i);
    expect(error?.message).not.toMatch(/invalid input value/i);
    expect((await reportRow(id)).status).toBe("open");
  });

  it("dismisses without touching the target", async () => {
    const id = await spareReport("spot", spotId);
    const before = await statusOf("spots", spotId);

    const { error } = await boss.client.rpc("resolve_report", {
      p_report_id: id,
      p_action: "dismiss",
    });
    expect(error).toBeNull();
    expect(await statusOf("spots", spotId)).toBe(before);
    expect((await reportRow(id)).status).toBe("dismissed");
  });

  // Without the guard, `p_action::spot_status` raises a cast error anyway — so
  // asserting only that something threw would pass for the wrong reason. The
  // report still being open is what proves the guard ran first.
  it("rejects an unknown action rather than resolving the report anyway", async () => {
    const id = await spareReport("spot", spotId);
    const { error } = await boss.client.rpc("resolve_report", {
      p_report_id: id,
      p_action: "delete_everything",
    });
    expect(error).not.toBeNull();
    expect((await reportRow(id)).status).toBe("open");
  });

  it("refuses a report id that does not exist", async () => {
    const { error } = await boss.client.rpc("resolve_report", {
      p_report_id: "00000000-0000-0000-0000-000000000000",
      p_action: "dismiss",
    });
    expect(error).not.toBeNull();
  });

  // Spec §9.4: moderation is not reversible by the author. The definer
  // function bypasses RLS by design, so this proves the policies still hold
  // for the author afterwards.
  it("leaves the author unable to un-remove their own comment", async () => {
    const { error } = await author.client
      .from("comments")
      .update({ status: "published" })
      .eq("id", commentId);
    // RLS matches no rows rather than erroring, so assert on what survived.
    expect(error).toBeNull();
    expect(await statusOf("comments", commentId)).toBe("removed");
  });
});

describe("admin_report_queue", () => {
  it("is refused to a non-admin", async () => {
    const { data, error } = await author.client.rpc("admin_report_queue");
    // Either a hard refusal or an empty queue is acceptable; leaking another
    // user's reports is not.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("is refused to a logged-out visitor", async () => {
    const { error } = await anonClient().rpc("admin_report_queue");
    expect(error?.code).toBe("42501");
  });

  // The reason this exists: spot_by_slug and spots_in_viewport both filter
  // status = 'published', so once a spot is hidden an admin can no longer load
  // the thing they are being asked to judge.
  it("shows a hidden spot's title, which no public query returns", async () => {
    const { data: bySlug } = await boss.client.rpc("spot_by_slug", { p_slug: spotSlug });
    expect(bySlug ?? []).toHaveLength(0);

    const { data, error } = await boss.client.rpc("admin_report_queue");
    expect(error).toBeNull();
    const row = (data ?? []).find((r: { target_id: string }) => r.target_id === spotId);
    expect(row).toBeDefined();
    expect(row.target_title).toBe("Moderation Target");
    expect(row.target_status).toBe("hidden");
  });

  it("carries the reason and the target type so the queue can be read at a glance", async () => {
    const { data } = await boss.client.rpc("admin_report_queue");
    const row = (data ?? []).find((r: { target_id: string }) => r.target_id === commentId);
    expect(row?.target_type).toBe("comment");
    expect(typeof row?.reason).toBe("string");
  });

  it("puts open reports before closed ones", async () => {
    const { data } = await boss.client.rpc("admin_report_queue");
    const statuses = (data ?? []).map((r: { status: string }) => r.status === "open");
    // Every open report comes before every closed one.
    expect(statuses.indexOf(false) === -1 || !statuses.slice(statuses.indexOf(false)).includes(true)).toBe(
      true,
    );
  });
});

describe("spot_by_slug after the signature change", () => {
  it("still returns published spots to anonymous visitors", async () => {
    const { data, error } = await anonClient().rpc("spot_by_slug", { p_slug: "fish-ladder-park" });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });

  // Added so the detail page can stop offering "Edit this spot" to everyone —
  // the silent no-op plan 5 turned into an error message.
  it("returns created_by so the page can tell who may edit", async () => {
    const { data } = await anonClient().rpc("spot_by_slug", { p_slug: "fish-ladder-park" });
    expect(data![0]).toHaveProperty("created_by");
    expect(data![0]).toHaveProperty("owner_profile_id");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npm run test:db -- moderation
```

Expected: every `resolve_report` and `admin_report_queue` test fails with `PGRST202` (function not found), and the two `spot_by_slug` property tests fail because the columns are absent. The "refuses a caller who is not an admin" test may pass for the wrong reason — a missing function refuses everyone — so do not read that one as signal yet.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260811000014_moderation.sql`:

```sql
-- Moderation needs a write path that does not exist. `status` is deliberately
-- absent from the column grants on spots — it is moderation state and must not
-- be writable by the submitter — but `admin` is a value in profiles.role, not a
-- Postgres role, and every signed-in user is the same `authenticated` role. So
-- "grant UPDATE on spots.status to admins" is not expressible, and an admin
-- attempting it gets `42501 permission denied for table spots`. Verified
-- against the running database before writing this.
--
-- The alternative — making status writable and relying on a policy — is the
-- "policies authorize rows, grants authorize columns" trap in
-- docs/ENGINEERING-NOTES.md, which is how a user could once promote themselves
-- to admin. So: a definer function that checks is_admin() itself.
--
-- One function rather than two writes, for the reason cast_signal exists.
-- Hiding the content and closing the report are two rows; done as two calls, a
-- failure between them leaves the content hidden with the report still open
-- (the admin does the work twice) or the report closed over live content (the
-- report is lost). Both move together or neither does.
create or replace function public.resolve_report(
  p_report_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_type public.report_target;
  v_target_id uuid;
  -- The action and the stored status are not the same word: the actions are
  -- `hide` and `remove`, the enum values are `hidden` and `removed`. Casting
  -- the action straight to the enum raises 22P02, which is how this was found.
  v_status text;
begin
  -- Re-checked here rather than trusted from the caller: this function runs as
  -- its owner and is the only thing standing between `authenticated` and
  -- spots.status.
  if not public.is_admin() then
    raise exception 'only an admin may resolve a report';
  end if;

  -- Before the cast below, not after. `p_action::public.spot_status` raises on
  -- a bad value anyway, but by then the target may already have been touched —
  -- and the error would name a cast rather than the mistake.
  if p_action not in ('hide', 'remove', 'dismiss') then
    raise exception 'unknown resolution action: %', p_action;
  end if;

  select r.target_type, r.target_id
    into v_target_type, v_target_id
  from public.reports r
  where r.id = p_report_id
  for update;

  if v_target_id is null then
    raise exception 'no such report';
  end if;

  -- Hide exists only for spots: spots.status is spot_status
  -- (published | hidden | removed) while photos and comments are
  -- content_status (published | removed). Fail rather than storing something
  -- adjacent to what was asked for.
  if p_action = 'hide' and v_target_type <> 'spot' then
    raise exception 'only a spot can be hidden; % supports remove or dismiss', v_target_type;
  end if;

  if p_action <> 'dismiss' then
    v_status := case p_action when 'hide' then 'hidden' else 'removed' end;

    if v_target_type = 'spot' then
      update public.spots
         set status = v_status::public.spot_status
       where id = v_target_id;
    elsif v_target_type = 'photo' then
      update public.photos
         set status = v_status::public.content_status
       where id = v_target_id;
    elsif v_target_type = 'comment' then
      update public.comments
         set status = v_status::public.content_status
       where id = v_target_id;
    end if;
  end if;

  -- Cast written out: a CASE over text literals is text, and assigning that to
  -- an enum column is 42804 rather than an implicit cast.
  update public.reports
     set status = (case when p_action = 'dismiss' then 'dismissed' else 'resolved' end)
                    ::public.report_status,
         resolved_by = auth.uid()
   where id = p_report_id;
end;
$$;

revoke execute on function public.resolve_report(uuid, text) from public;
grant execute on function public.resolve_report(uuid, text) to authenticated;

-- The queue's read path.
--
-- Separate from spot_by_slug rather than loosening it: every public query
-- filters status = 'published', which is what makes a hidden spot disappear —
-- including from the admin who just hid it and now cannot review the decision.
-- Loosening the public path would put a moderation concern in front of every
-- visitor; this keeps it in one admin-only function.
--
-- target_title is a best effort: reports.target_id is polymorphic with no
-- foreign key, so a deleted target leaves the report pointing at nothing and
-- the title comes back null rather than dropping the row. An orphaned report
-- still has to be dismissable.
create or replace function public.admin_report_queue()
returns table (
  id uuid,
  target_type public.report_target,
  target_id uuid,
  target_title text,
  target_status text,
  reason text,
  note text,
  status public.report_status,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin may read the report queue';
  end if;

  return query
    select
      r.id, r.target_type, r.target_id,
      case r.target_type
        when 'spot' then (select s.name from public.spots s where s.id = r.target_id)
        when 'comment' then (select left(c.body, 120) from public.comments c where c.id = r.target_id)
        when 'photo' then (select p.storage_path from public.photos p where p.id = r.target_id)
      end,
      case r.target_type
        when 'spot' then (select s.status::text from public.spots s where s.id = r.target_id)
        when 'comment' then (select c.status::text from public.comments c where c.id = r.target_id)
        when 'photo' then (select p.status::text from public.photos p where p.id = r.target_id)
      end,
      r.reason, r.note, r.status, r.created_at
    from public.reports r
    order by (r.status = 'open') desc, r.created_at desc;
end;
$$;

revoke execute on function public.admin_report_queue() from public;
grant execute on function public.admin_report_queue() to authenticated;

-- spot_by_slug gains created_by and owner_profile_id so the detail page can
-- stop offering "Edit this spot" to everyone. Plan 5 turned that silent no-op
-- into an error message; this is what lets the link disappear instead.
--
-- DROP first. A create-or-replace that changes the return type fails outright
-- rather than overloading, but the drop discards the grants either way, so they
-- are rewritten below. Body is migration 7's, with two columns added.
drop function if exists public.spot_by_slug(text);

create or replace function public.spot_by_slug(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  kind public.spot_kind,
  description text,
  lat double precision,
  lng double precision,
  locality text,
  region text,
  created_by uuid,
  owner_profile_id uuid,
  score numeric,
  hot_score numeric,
  shoot_type_upvote_count integer,
  shoot_again_yes_count integer,
  shoot_again_no_count integer,
  comment_count integer,
  scouting_photo_count integer,
  session_photo_count integer,
  cost_type public.cost_type,
  cost_notes text,
  permit_url text,
  hours_notes text,
  best_light text[],
  best_seasons text[],
  walk_minutes integer,
  parking_notes text,
  terrain text[],
  accessibility text[],
  max_group_size integer,
  dog_friendly boolean
)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.id, s.name, s.slug, s.kind, s.description,
    st_y(s.location::geometry) as lat,
    st_x(s.location::geometry) as lng,
    s.locality, s.region,
    s.created_by, s.owner_profile_id,
    s.score, s.hot_score,
    s.shoot_type_upvote_count, s.shoot_again_yes_count, s.shoot_again_no_count,
    s.comment_count, s.scouting_photo_count, s.session_photo_count,
    s.cost_type, s.cost_notes, s.permit_url, s.hours_notes,
    s.best_light, s.best_seasons, s.walk_minutes, s.parking_notes,
    s.terrain, s.accessibility, s.max_group_size, s.dog_friendly
  from public.spots s
  where s.slug = p_slug and s.status = 'published'
$$;

revoke execute on function public.spot_by_slug(text) from public;
grant execute on function public.spot_by_slug(text) to anon, authenticated, service_role;
```

- [ ] **Step 5: Apply, audit for overloads, and run the test**

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" && npx supabase db reset && npm run seed
docker exec supabase_db_photospots psql -U postgres -d postgres -c \
  "select p.proname, count(*) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' group by 1 having count(*) > 1;"
```

Expected: **no rows.** Then:

```bash
npm run test:db -- moderation
```

Expected: 17 passing. Run the whole database project too — `spot_by_slug` changed shape and `app/data/spots.ts` maps it.

- [ ] **Step 6: Mutation-test**

| Mutation | Test that must go red |
| --- | --- |
| Delete the `is_admin()` check in `resolve_report` | "refuses a caller who is not an admin" |
| Delete the `is_admin()` check in `admin_report_queue` | "is refused to a non-admin" |
| Drop the `p_action not in (...)` guard | "rejects an unknown action rather than resolving the report anyway" |
| Drop the `hide` / non-spot guard | "refuses to hide a comment, **and says why rather than naming an enum**" — see below |
| Skip the `reports` update at the end | "resolves the report in the same call" |
| Skip the target update (resolve the report only) | "hides a spot, which a direct update cannot do even as an admin" |
| `dismiss` also updates the target | "dismisses without touching the target" |

**Two of these need care, and both were got wrong on the first pass.**

The `hide`/non-spot guard is about the *message*, not the outcome: without it, `'hidden'::content_status` raises `22P02` and the report is left open just the same, so a test asserting "something threw" passes with the guard removed. Assert the sentence an admin would read — `only a spot can be hidden` — and that it is *not* `invalid input value`.

The same applies to the unknown-action row: the cast fails anyway, so confirm the report is still `open`, not merely that something threw.

**And verify the mutation reached the database, not just the file.** `psql` exits 0 even when a statement fails unless `-v ON_ERROR_STOP=1` is set, so a mutation whose SQL is invalid leaves the *original* function installed and the suite passes — indistinguishable from a surviving mutation. The first run of this table reported `hide → removed` as a survivor for exactly that reason; it is not. Check `pg_proc.prosrc` for the mutated text before believing any green result:

```bash
docker exec supabase_db_photospots psql -U postgres -d postgres -tAc \
  "select prosrc like '%then ''removed'' else ''removed''%' from pg_proc where proname='resolve_report';"
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260811000014_moderation.sql tests/db/moderation.test.ts
git commit -m "$(cat <<'EOF'
feat: add the moderation write and read paths

Hide and remove — the two resolution actions spec §9.4 names — were impossible
on a spot. `status` is deliberately absent from the column grants, which is
right, but `admin` is a value in profiles.role rather than a Postgres role, so
no column grant can express "admins only" and an admin attempting the update
got 42501. Verified against the running database before writing this.

resolve_report does the target status change and the report closure in one
transaction, for the reason cast_signal exists: done as two calls, a failure
between them leaves content hidden with the report still open, or the report
closed over live content.

admin_report_queue is a separate read rather than a loosened spot_by_slug.
Every public query filters status = 'published', which is what makes a hidden
spot vanish — including from the admin who just hid it. Loosening the public
path would put a moderation concern in front of every visitor.

spot_by_slug gains created_by and owner_profile_id, dropped and recreated
rather than replaced, so the detail page can stop offering the edit link to
everyone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The reports data layer

**Files:**
- Create: `app/data/reports.ts`
- Test: `tests/db/reports-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/reports-data.test.ts`. Build the same shape of fixture as task 2 — promote an admin via `serviceClient`, insert a spot owned by the author — but **name the spot `Report Target`**, which is what the assertions below expect. Then:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { fileReport, listReportQueue, resolveReport } from "../../app/data/reports";

let boss: TestUser;
let author: TestUser;
let spotId: string;

const admin = () => serviceClient();

beforeAll(async () => {
  boss = await createTestUser("Queue Admin");
  author = await createTestUser("Queue Author");
  const { error: promote } = await admin()
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", boss.id);
  if (promote) throw promote;

  const { data, error } = await admin()
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Report Target",
      slug: `report-target-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.67 42.94)",
      created_by: author.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = data.id;
});

afterAll(async () => {
  // Reports have no cascade from spots — target_id is polymorphic with no
  // foreign key — so they have to be deleted explicitly or they outlive the
  // fixture and pollute every later run of the queue tests.
  const { error: reportError } = await admin().from("reports").delete().eq("target_id", spotId);
  if (reportError) throw reportError;
  const { error } = await admin().from("spots").delete().eq("id", spotId);
  if (error) throw error;
  await deleteTestUser(boss.id);
  await deleteTestUser(author.id);
});

describe("fileReport", () => {
  it("stores a report attributed to the caller", async () => {
    await fileReport(author.client, {
      targetType: "spot",
      targetId: spotId,
      reason: "unsafe",
      note: "The stairs are broken.",
      profileId: author.id,
    });

    const { data } = await admin()
      .from("reports")
      .select("target_type, reason, note, status, profile_id")
      .eq("target_id", spotId)
      .single();
    expect(data).toEqual({
      target_type: "spot",
      reason: "unsafe",
      note: "The stairs are broken.",
      status: "open",
      profile_id: author.id,
    });
  });

  // RLS is the authority here (reports_insert: profile_id = auth.uid()), so
  // passing someone else's id must fail at the database rather than be trusted.
  it("cannot be attributed to somebody else", async () => {
    await expect(
      fileReport(author.client, {
        targetType: "spot",
        targetId: spotId,
        reason: "spam",
        note: null,
        profileId: boss.id,
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses a logged-out reporter", async () => {
    await expect(
      fileReport(anonClient(), {
        targetType: "spot",
        targetId: spotId,
        reason: "spam",
        note: null,
        profileId: author.id,
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  // reports.reason is free text, so the database will store anything and an
  // unrecognised value renders as itself in the queue forever.
  it("rejects a reason outside the vocabulary before it reaches the database", async () => {
    await expect(
      fileReport(author.client, {
        targetType: "spot",
        targetId: spotId,
        reason: "because_i_say_so",
        note: null,
        profileId: author.id,
      }),
    ).rejects.toThrow(/reason/i);
  });

  it("stores a whitespace-only note as no note", async () => {
    await fileReport(author.client, {
      targetType: "spot",
      targetId: spotId,
      reason: "wrong_place",
      note: "   \n ",
      profileId: author.id,
    });

    const { data } = await admin()
      .from("reports")
      .select("note")
      .eq("target_id", spotId)
      .eq("reason", "wrong_place")
      .single();
    expect(data!.note).toBeNull();
  });
});

describe("listReportQueue", () => {
  it("maps the RPC into camelCase rows the queue can render", async () => {
    const rows = await listReportQueue(boss.client);
    const row = rows.find((r) => r.targetId === spotId)!;
    expect(row.targetType).toBe("spot");
    expect(row.targetTitle).toBe("Report Target");
    expect(row.targetStatus).toBe("published");
    expect(row.status).toBe("open");
  });

  // An empty queue and a forbidden one look identical to a caller, and the
  // difference is what decides whether to show an admin surface at all.
  it("throws for a non-admin rather than returning an empty queue", async () => {
    await expect(listReportQueue(author.client)).rejects.toBeTruthy();
  });

  it("throws for a logged-out visitor", async () => {
    await expect(listReportQueue(anonClient())).rejects.toMatchObject({ code: "42501" });
  });
});

describe("resolveReport", () => {
  it("hides a spot and closes its report in one call", async () => {
    const open = (await listReportQueue(boss.client)).find(
      (r) => r.targetId === spotId && r.status === "open",
    )!;
    await resolveReport(boss.client, open.id, "hide");

    const { data } = await admin().from("spots").select("status").eq("id", spotId).single();
    expect(data!.status).toBe("hidden");

    const { data: report } = await admin()
      .from("reports")
      .select("status")
      .eq("id", open.id)
      .single();
    expect(report!.status).toBe("resolved");
  });

  it("refuses a non-admin", async () => {
    const open = (await listReportQueue(boss.client)).find(
      (r) => r.targetId === spotId && r.status === "open",
    )!;
    await expect(resolveReport(author.client, open.id, "remove")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then write `app/data/reports.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReportReason, type ReportTarget, type ResolutionAction } from "../domain/reports/reasons";

export interface NewReport {
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  note: string | null;
  profileId: string;
}

export interface QueuedReport {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  /** Null when the target has been deleted — the report is still dismissable. */
  targetTitle: string | null;
  targetStatus: string | null;
  reason: string;
  note: string | null;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
}

/**
 * `profile_id` is checked by RLS (`reports_insert with check (profile_id =
 * auth.uid())`), so passing someone else's id fails at the database rather
 * than being trusted here.
 *
 * The reason is validated before the insert because `reports.reason` is free
 * text in the schema — the database will happily store anything, and an
 * unrecognised value renders as itself in the queue forever.
 */
export async function fileReport(supabase: SupabaseClient, report: NewReport): Promise<void> {
  if (!isReportReason(report.reason)) {
    throw new Error(`Unknown report reason: ${report.reason}`);
  }

  const { error } = await supabase.from("reports").insert({
    target_type: report.targetType,
    target_id: report.targetId,
    profile_id: report.profileId,
    reason: report.reason,
    // A whitespace-only note is no note, not an empty string to store.
    note: report.note?.trim() || null,
  });

  if (error) throw error;
}

interface QueueRow {
  id: string;
  target_type: ReportTarget;
  target_id: string;
  target_title: string | null;
  target_status: string | null;
  reason: string;
  note: string | null;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
}

/**
 * Throws for a non-admin rather than returning an empty list: an empty queue
 * and a forbidden one look identical to a caller, and the difference is what
 * decides whether to render an admin surface at all.
 */
export async function listReportQueue(supabase: SupabaseClient): Promise<QueuedReport[]> {
  const { data, error } = await supabase.rpc("admin_report_queue");
  if (error) throw error;

  return ((data ?? []) as QueueRow[]).map((row) => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: row.target_title,
    targetStatus: row.target_status,
    reason: row.reason,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/** Target status and report closure move together — see migration 14. */
export async function resolveReport(
  supabase: SupabaseClient,
  reportId: string,
  action: ResolutionAction,
): Promise<void> {
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: reportId,
    p_action: action,
  });
  if (error) throw error;
}
```

- [ ] **Step 3: Run, then mutation-test**

| Mutation | Test that must go red |
| --- | --- |
| Drop the `isReportReason` guard | "rejects a reason outside the vocabulary before it reaches the database" |
| `if (error) throw error` → `if (false) …` in `listReportQueue` | "throws for a non-admin rather than returning an empty queue" |
| `note?.trim() \|\| null` → `note` | add a test for a whitespace-only note if none goes red |

- [ ] **Step 4: Clean up after the fixture, and sweep the strays**

The database currently holds 10 reports left by the existing suite. Delete the ones this file creates in `afterAll`, then check nothing else leaks:

```bash
docker exec supabase_db_photospots psql -U postgres -d postgres -tAc "select count(*) from public.reports;"
```

Run it before and after `npm run test:db`. The two numbers must match.

**They did not: three reports leaked**, from `rls.test.ts` and `schema-signals.test.ts`. The cause is worth knowing, because it is not the obvious one — `reports.target_id` is polymorphic with no foreign key, so deleting the spot does not cascade, *and* `reports.profile_id` is `ON DELETE SET NULL`, so deleting the reporter orphans the row rather than removing it. A fixture that cleans up its spot and its users still leaves its reports behind. Note also that `schema-signals.test.ts` reports against a second spot it cleans up inline, not the one its `afterAll` deletes.

- [ ] **Step 5: Commit**

```bash
git add app/data/reports.ts tests/db/reports-data.test.ts
git commit -m "$(cat <<'EOF'
feat: add the reports data layer

reports.reason is free text in the schema, so the reason is validated before
the insert rather than after: the database stores anything, and an unrecognised
value renders as itself in the queue forever.

The queue read throws for a non-admin rather than returning an empty list. An
empty queue and a refused one look identical to a caller, and the difference
matters when the caller is deciding whether to show an admin surface at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Reporting from the spot page

**Files:**
- Create: `app/components/spot/ReportButton.tsx`, `app/components/spot/ReportButton.test.tsx`
- Modify: `app/routes/spots.$slug.tsx`

- [ ] **Step 1: Write the failing component test**

Export and test the pure parts — the unit project runs in `node` with no DOM, so components are tested through their exported helpers, as `VotePanel` and `SpotCard` are.

```ts
import { describe, it, expect } from "vitest";
import { reportIntentFrom, reportConfirmation } from "./ReportButton";

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
};

describe("reportIntentFrom", () => {
  it("reads a target and reason", () => {
    expect(
      reportIntentFrom(form({ intent: "report", targetType: "comment", targetId: "c1", reason: "abuse" })),
    ).toEqual({ targetType: "comment", targetId: "c1", reason: "abuse", note: null });
  });

  it("is null for another intent", () => {
    expect(reportIntentFrom(form({ intent: "upvote", shootTypeId: "1" }))).toBeNull();
  });

  it("is null for a target type that is not one of the three", () => {
    expect(
      reportIntentFrom(form({ intent: "report", targetType: "profile", targetId: "p1", reason: "spam" })),
    ).toBeNull();
  });

  it("is null for a reason outside the vocabulary", () => {
    expect(
      reportIntentFrom(form({ intent: "report", targetType: "spot", targetId: "s1", reason: "nope" })),
    ).toBeNull();
  });

  // An empty note is "no note", not an empty string to store.
  it("reads a blank note as null", () => {
    const parsed = reportIntentFrom(
      form({ intent: "report", targetType: "spot", targetId: "s1", reason: "spam", note: "   " }),
    );
    expect(parsed?.note).toBeNull();
  });
});

describe("reportConfirmation", () => {
  // Reporting is not a vote: the reporter should be told it went somewhere and
  // not be invited to file it again.
  it("confirms without promising an outcome", () => {
    const text = reportConfirmation();
    expect(text).toMatch(/thank|received|logged/i);
    expect(text).not.toMatch(/removed|deleted/i);
  });
});
```

- [ ] **Step 2: Implement `ReportButton.tsx`**

The pure helpers first, since the action is a public endpoint and both the target type and the reason have to be validated there rather than trusted from the form:

```tsx
import { useFetcher } from "react-router";
import {
  REPORT_REASONS,
  isReportReason,
  type ReportTarget,
} from "~/domain/reports/reasons";

const TARGETS: readonly string[] = ["spot", "photo", "comment"];

export interface ReportIntent {
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  note: string | null;
}

/**
 * Reads a report submission out of the form, or null if this is not one.
 *
 * Validates the target type as well as the reason: `target_type` is a Postgres
 * enum, so a bad value is a 22P02 the user cannot act on, and `reason` is free
 * text, so a bad value is stored forever and renders as itself in the queue.
 */
export function reportIntentFrom(formData: FormData | undefined): ReportIntent | null {
  if (formData?.get("intent") !== "report") return null;

  const targetType = String(formData.get("targetType") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!TARGETS.includes(targetType) || targetId === "" || !isReportReason(reason)) return null;

  const note = String(formData.get("note") ?? "").trim();
  return {
    targetType: targetType as ReportTarget,
    targetId,
    reason,
    note: note === "" ? null : note,
  };
}

/**
 * Deliberately promises nothing. The reporter is told it arrived, not that
 * anything will happen — an admin may well dismiss it.
 */
export const reportConfirmation = (): string =>
  "Thank you — this has been logged for a moderator to look at.";

export function ReportButton({
  targetType,
  targetId,
  signedIn,
}: {
  targetType: ReportTarget;
  targetId: string;
  signedIn: boolean;
}) {
  const fetcher = useFetcher<{ error?: string; reported?: boolean }>();
  if (!signedIn) return null;

  if (fetcher.data?.reported) return <p className="report__done">{reportConfirmation()}</p>;

  return (
    <details className="report">
      <summary>Report</summary>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="report" />
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="targetId" value={targetId} />
        <label>
          What is wrong?
          <select name="reason" required defaultValue="">
            <option value="" disabled>
              Pick a reason
            </option>
            {REPORT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Anything else? (optional)
          <textarea name="note" rows={2} />
        </label>
        {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
        <button type="submit">Send report</button>
      </fetcher.Form>
    </details>
  );
}
```

Note the object literal in `reportIntentFrom` is written out rather than shorthand — `note === "" ? null : note` needs a key. Write it as `note: note === "" ? null : note`.

Render one on the spot itself, one per comment, and one per photo — spec §4.3 makes the photo takedown path non-negotiable, and it is the same component with a different `targetType`.

- [ ] **Step 3: Extend the route action**

Add a `case "report"` to the existing `intent` switch in `app/routes/spots.$slug.tsx`, calling `fileReport`. Return `{ ok: true, reported: true }` so the component can show the confirmation. Requires a signed-in profile, like voting and commenting.

- [ ] **Step 4: Hide the edit link from people who cannot edit**

`spot_by_slug` now returns `created_by` and `owner_profile_id`. Replace the current `{profile && <Link …>Edit this spot</Link>}` with a check that the viewer is the submitter, the listing owner, or an admin. This is the other half of the plan 5 finding: the action already refuses politely, and now the link stops appearing at all.

The viewer's admin status is on `profile.role`, which `getCurrentProfile` already returns.

- [ ] **Step 5: Verify in the browser**

Sign in, report a comment, and confirm: the confirmation appears, a row lands in `reports` with `status = 'open'` attributed to you, and the comment is still visible (reporting is not moderation). Then check the edit link is gone on a spot you did not submit, and present on one you did.

- [ ] **Step 6: Commit**

```bash
git add app/components/spot/ReportButton.tsx app/components/spot/ReportButton.test.tsx app/routes/spots.\$slug.tsx
git commit -m "$(cat <<'EOF'
feat: let anyone signed in report a spot, photo or comment

Spec §4.3 makes a working takedown path non-negotiable, because session photos
show real families and frequently children. The photo control is the same
component as the others with a different target type.

The confirmation deliberately promises nothing: the reporter is told it was
received, not that anything will be removed.

The edit link now appears only for the submitter, the listing owner, or an
admin. Plan 5 turned the non-owner case from a silent no-op into an error
message; spot_by_slug returning created_by is what lets the link disappear.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: The admin queue

**Files:**
- Create: `app/routes/admin.tsx`, `app/components/admin/ReportRow.tsx`, `app/components/admin/ReportRow.test.tsx`
- Modify: `app/routes.ts`, `app/app.css`

- [ ] **Step 1: Write the failing component test**

```ts
import { describe, it, expect } from "vitest";
import { queueSummary, isActionable } from "./ReportRow";

const report = (over = {}) => ({
  id: "r1",
  targetType: "spot" as const,
  targetId: "s1",
  targetTitle: "Millennium Park Meadow",
  targetStatus: "published",
  reason: "unsafe",
  note: null,
  status: "open" as const,
  createdAt: "2026-08-11T10:00:00.000Z",
  ...over,
});

describe("queueSummary", () => {
  it("leads with the target title and the reason in words", () => {
    const line = queueSummary(report());
    expect(line).toContain("Millennium Park Meadow");
    expect(line).toContain("unsafe");
  });

  // A deleted target leaves the report pointing at nothing — it still has to
  // render, and still has to be dismissable.
  it("copes with a target that no longer exists", () => {
    const line = queueSummary(report({ targetTitle: null, targetStatus: null }));
    expect(line).toContain("deleted");
  });

  it("says what has already been done to the target", () => {
    expect(queueSummary(report({ targetStatus: "removed" }))).toContain("removed");
  });
});

describe("isActionable", () => {
  it("is true for an open report", () => {
    expect(isActionable(report())).toBe(true);
  });

  // Re-resolving a closed report would reopen work that is already done.
  it("is false once resolved or dismissed", () => {
    expect(isActionable(report({ status: "resolved" }))).toBe(false);
    expect(isActionable(report({ status: "dismissed" }))).toBe(false);
  });

  it("is false when the target is gone, except to dismiss", () => {
    expect(isActionable(report({ targetTitle: null, targetStatus: null }))).toBe(false);
  });
});
```

Note the last case: a report whose target is deleted cannot be hidden or removed, but must still be dismissable, so the row renders a dismiss button even when `isActionable` is false. Make that explicit in the component rather than implied.

- [ ] **Step 2: Implement the row and the route**

`ReportRow` renders the summary, the note if there is one, and one `fetcher.Form` button per entry in `actionsFor(report.targetType)` — filtered to `dismiss` when the target is gone:

```tsx
export function queueSummary(report: QueuedReport): string {
  const title = report.targetTitle ?? `(deleted ${report.targetType})`;
  const state = report.targetStatus && report.targetStatus !== "published"
    ? ` — already ${report.targetStatus}`
    : "";
  return `${report.targetType}: ${title} · ${labelForReason(report.reason)} (${report.reason})${state}`;
}

/**
 * A closed report must not be re-resolved, and a report whose target has been
 * deleted cannot be hidden or removed — but it must still be dismissable, or
 * it sits in the queue forever with no way to clear it. So the row renders a
 * dismiss button even when this is false; it gates the *destructive* actions.
 */
export function isActionable(report: QueuedReport): boolean {
  return report.status === "open" && report.targetTitle !== null;
}
```

`admin.tsx`'s loader calls `listReportQueue` and **must handle the throw** — an empty queue and a forbidden one look identical, and the difference is what a non-admin needs to be told:

```tsx
export async function loader({ request }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const profile = await getCurrentProfile(supabase);
  if (!profile) throw redirect("/auth/login", { headers });

  try {
    const reports = await listReportQueue(supabase);
    return routeData({ reports }, { headers });
  } catch {
    // admin_report_queue raises for a non-admin rather than returning nothing,
    // which is the whole reason it is a function and not a view.
    throw new Response("Not an admin", { status: 403, headers });
  }
}
```

Add `route("admin", "routes/admin.tsx")` to `app/routes.ts`, and give the route an `ErrorBoundary` so the 403 renders as a sentence rather than a stack trace.

- [ ] **Step 3: Verify by hand, as an admin and as a non-admin**

Promote a test user with `update profiles set role = 'admin'`, then: file a report as someone else, open `/admin`, confirm it appears, hide the spot, and confirm the spot disappears from the map and the report leaves the open list. Then open `/admin` as an ordinary user and confirm a 403 rather than an empty queue.

Confirm the hidden spot's author can still see it (RLS gives them their own rows) but cannot edit it — `spots_update` requires `status = 'published'` for non-admins, which is what makes moderation stick.

- [ ] **Step 4: Commit**

```bash
git add app/routes/admin.tsx app/routes.ts app/components/admin/ app/app.css
git commit -m "$(cat <<'EOF'
feat: add the admin report queue

One page, hide and remove and dismiss, matching spec §9.4's resolution actions.
Hide is offered only for spots, because photos and comments use content_status
which has no such state.

A report whose target has been deleted still renders and is still dismissable —
reports.target_id is polymorphic with no foreign key, so a deleted spot leaves
its reports pointing at nothing and they would otherwise sit in the queue
forever with no way to clear them.

The loader turns a refused queue read into a 403 rather than an empty page. An
empty queue and a forbidden one look identical, and the difference is exactly
what a non-admin hitting /admin needs to be told.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Studio listings and the claim flow

**Files:**
- Create: `app/data/studios.ts`, `app/routes/studios.$slug.tsx`
- Test: `tests/db/studios-data.test.ts`
- Modify: `app/routes.ts`

`claim_studio()` has existed since plan 1, is granted to `authenticated`, and has never had a caller. Spec §9.3: verification is against the listing's `contact_email`, and the caller must have that address confirmed on their own auth account.

- [ ] **Step 1: Write the failing database test**

Cover, using two test users and a studio spot with `studio_details.contact_email` set to one of their addresses:

```ts
it("lets the owner of the contact email claim the listing", async () => {
  await claimStudio(owner.client, spotId);

  const { data } = await serviceClient()
    .from("studio_details")
    .select("claimed_by, claimed_at")
    .eq("spot_id", spotId)
    .single();
  expect(data!.claimed_by).toBe(owner.id);
  expect(data!.claimed_at).not.toBeNull();

  const { data: spot } = await serviceClient()
    .from("spots")
    .select("owner_profile_id")
    .eq("id", spotId)
    .single();
  expect(spot!.owner_profile_id).toBe(owner.id);
});

// The whole point of §9.3: without the email check this is first-come,
// first-served across every listing in the database.
it("refuses somebody whose email does not match the listing", async () => {
  await expect(claimStudio(stranger.client, otherSpotId)).rejects.toThrow(/confirmed email/i);
});

it("refuses a listing that is already claimed", async () => {
  await expect(claimStudio(owner.client, spotId)).rejects.toThrow(/not claimable/i);
});

it("refuses a logged-out caller", async () => {
  await expect(claimStudio(anonClient(), otherSpotId)).rejects.toMatchObject({ code: "42501" });
});

// claimed_by is not writable through PostgREST by anyone — only claim_studio
// sets it. Otherwise any signed-in user could claim any listing directly.
it("cannot be done by writing the column directly", async () => {
  const { error } = await stranger.client
    .from("studio_details")
    .update({ claimed_by: stranger.id })
    .eq("spot_id", otherSpotId);
  expect(error?.code).toBe("42501");
});
```

- [ ] **Step 2: Write `app/data/studios.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface StudioDetails {
  spotId: string;
  hourlyRateCents: number | null;
  bookingUrl: string | null;
  contactEmail: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
}

interface StudioRow {
  spot_id: string;
  hourly_rate_cents: number | null;
  booking_url: string | null;
  contact_email: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
}

/** Null for an outdoor spot, which has no studio_details row at all. */
export async function getStudioDetails(
  supabase: SupabaseClient,
  spotId: string,
): Promise<StudioDetails | null> {
  const { data, error } = await supabase
    .from("studio_details")
    .select("spot_id, hourly_rate_cents, booking_url, contact_email, claimed_by, claimed_at")
    .eq("spot_id", spotId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as StudioRow;
  return {
    spotId: row.spot_id,
    hourlyRateCents: row.hourly_rate_cents,
    bookingUrl: row.booking_url,
    contactEmail: row.contact_email,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
  };
}

/**
 * Spec §9.3: claiming is a command, not a row write. `claimed_by` is not
 * writable through PostgREST by anyone — only this function sets it, after
 * confirming the caller's own verified email matches the listing contact.
 * Without that check it would be first come, first served across every
 * unclaimed listing in the database.
 */
export async function claimStudio(supabase: SupabaseClient, spotId: string): Promise<void> {
  const { error } = await supabase.rpc("claim_studio", { p_spot_id: spotId });
  if (error) throw error;
}
```

Note `maybeSingle()` rather than `single()`: an outdoor spot has no `studio_details` row, and `single()` treats that as a `PGRST116` error rather than an answer.

- [ ] **Step 3: Build `/studios/:slug`**

Spec §8: the studio page is the spot page plus rate, booking link, and the claim flow. Reuse `getSpotBySlug`; add the studio fields. Show the claim control only when the listing is unclaimed and the viewer is signed in, and surface the mismatch error in words — "claiming needs a confirmed email matching the listing's contact address" — rather than the raw exception.

Add `route("studios/:slug", "routes/studios.$slug.tsx")` to `app/routes.ts`.

- [ ] **Step 4: Verify the claim end to end**

Create a studio spot with `contact_email` set to a Mailpit address you can sign in as, sign in through the magic-link flow, claim it, and confirm both `studio_details.claimed_by` and `spots.owner_profile_id` are set. Then confirm the claim control is gone and the listing is editable by the new owner — `spots_update` allows `owner_profile_id = auth.uid()`.

- [ ] **Step 5: Commit**

```bash
git add app/data/studios.ts app/routes/studios.\$slug.tsx app/routes.ts tests/db/studios-data.test.ts
git commit -m "$(cat <<'EOF'
feat: add studio listings and the owner claim flow

claim_studio has existed since plan 1 with no caller. Spec §9.3 verifies
against the listing's contact_email and the caller's own confirmed address,
because claimed_by is not writable through the API by anyone — otherwise any
signed-in user could claim any unclaimed studio, first come first served,
across every listing at once.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Verify end to end, then sync the docs

**Files:**
- Modify: `docs/STATUS.md`, `README.md`, this plan
- Possibly modify: `docs/ENGINEERING-NOTES.md`

- [ ] **Step 1: Full suite, typecheck, build**

```bash
npm test && npm run typecheck && npm run build
```

- [ ] **Step 2: Replay every migration from empty, and audit for overloads**

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" && npx supabase db reset && npm run seed && npm run test:db
docker exec supabase_db_photospots psql -U postgres -d postgres -c \
  "select p.proname, count(*) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' group by 1 having count(*) > 1;"
```

Expected: clean replay, and no rows from the overload query. This plan drops and recreates `spot_by_slug`, so that check is not ceremonial.

- [ ] **Step 3: Confirm no test file leaks reports**

```bash
docker exec supabase_db_photospots psql -U postgres -d postgres -tAc "select count(*) from public.reports;"
npm run test:db
docker exec supabase_db_photospots psql -U postgres -d postgres -tAc "select count(*) from public.reports;"
```

The two numbers must match.

- [ ] **Step 4: Drive the whole trust flow in the browser**

As an ordinary user: report a spot and a comment. As an admin: open `/admin`, dismiss one, hide the spot behind the other, and confirm the spot leaves the map. As the spot's author: confirm you can still see it, cannot edit it, and are told why. As a studio owner: claim a listing and confirm it becomes editable.

- [ ] **Step 5: Update `docs/STATUS.md`**

Move milestone 6 to ✅ — **the MVP is then complete**, so rewrite the "Next" section as what comes after the milestones rather than a seventh one: the cold-start seeding work in spec §14, the hosted Supabase deploy still listed under Blocked, and the deferred items already recorded. Update the test count, the migration count, and the `app/` inventory.

Remove from "Known gaps" the entry about the edit link being offered to everyone; task 4 closes it.

- [ ] **Step 6: Update `README.md`** in the same voice as the existing entries.

- [ ] **Step 7: Sync this plan** — tick every checkbox and add a "What diverged" table, as plans 4 and 5 do.

- [ ] **Step 8: Add any new trap to `docs/ENGINEERING-NOTES.md`**

Only if this plan hit a real one. The likeliest candidate is already half-written there: **an application role is not a database role**, so a column grant cannot express "admins only" and the only honest options are a `security definer` function or a policy — with the trade-off that the function bypasses RLS and must re-check `is_admin()` itself. Add it if it bit; do not add anything merely anticipated.

- [ ] **Step 9: Commit**

```bash
git add docs/ README.md
git commit -m "$(cat <<'EOF'
docs: record the trust and moderation milestone

Plan 6 ticked off against what was built, with the divergences named. This
completes the MVP milestones, so STATUS now points at the cold-start seeding in
spec §14 and the hosted deploy rather than a seventh plan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

Checked against spec §13 milestone 6 ("Trust — reports, admin queue, takedown handling, studio claim flow"):

| Requirement | Where |
| --- | --- |
| Reports | Tasks 1, 3, 4 |
| Admin queue | Tasks 2, 5 |
| Takedown handling | Task 2 (`resolve_report`), task 4 (the `rights` reason spec §4.3 requires) |
| Studio claim flow | Task 6 |
| Moderation not reversible by the author | Already enforced by RLS; task 2 proves it still holds once resolution runs through a definer function |

Also folded in, because they block or undermine the above:

| Carried in | Why here |
| --- | --- |
| `spots.status` write path (task 2) | Hide and remove were impossible; the milestone is unbuildable without it |
| Edit link hidden from non-owners (task 4) | Recorded in STATUS from plan 5; needs `created_by` on the detail payload, which task 2 adds anyway |
| Report-leak sweep in the db tests (task 3) | The queue's own tests are unreadable against 10 stray rows |

Deliberately **not** in this plan, and why:

- **`signals.profile_id` readable by `anon`** — recorded in STATUS from plan 5. It is a privacy fix to `signals_read`, not a moderation feature, and changing that policy touches the vote counts every page reads. It deserves its own change with its own verification, not a corner of this one.
- **Rate limiting on reports.** One angry user can file fifty. The queue makes that visible, which is the prerequisite for knowing what limit to set.
- **Email notifications to reporters or authors.** Spec §3 puts notifications explicitly out of MVP scope.
- **A moderation audit log.** `reports.resolved_by` records who closed each report, which is the accountability the MVP needs; a full log of every status change is a milestone-7 concern if it becomes one.
