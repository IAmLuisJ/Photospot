# Photospots Filters and Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone narrow the map to spots that will actually work for their shoot — free, a short walk from parking, stroller-friendly — and give the three explore views the arrangements spec §8 describes, including on a phone.

**Architecture:** Attribute filtering happens inside `spots_in_viewport`, not in the client, because the RPC caps results at 500 and a filter applied after the cap would appear to lose spots that were merely beyond it. The filter vocabulary is a domain constant mirrored by a check constraint, so the values the form offers and the values the database accepts cannot drift. The chosen view is remembered in a cookie read during the loader, so the server renders the right arrangement rather than flashing the default first.

**Tech Stack:** React Router v8 (`createCookie`, `useSearchParams`) · Supabase (PostGIS, RLS) · Vitest

**Plan sequence:** Plan 5 of 6. Plans 1–4 are complete — schema, RLS, auth, the pure domain layer, read-only explore, contribution, and voting and comments — with 333 passing tests across 37 files.

**Spec:** `docs/superpowers/specs/2026-08-09-photospots-design.md` — §1 (permits, light, and whether grandparents can make the walk), §4.7 (optional metadata as real nullable columns), §8 (three views, URL state), §14 (cold start is the dominant risk).

**Commit convention:** every commit message ends with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## What plans 1–4 leave you

| Available | Where |
| --- | --- |
| `spots_in_viewport(west, south, east, north, shoot_type_id, sort, limit)` | migration 7 |
| `parseExploreFilters` / `filtersToSearchParams` — viewport, zoom, shootTypeId, sort, view | `app/domain/filters/explore-filters.ts` |
| `ExploreLayout` with `split` / `map` / `gallery` arrangements and `photoDepthFor` | `app/components/explore/ExploreLayout.tsx` |
| Shoot-type filter buttons and the Best/Hot sort toggle | `app/routes/home.tsx` |
| Nullable attribute columns — `cost_type`, `walk_minutes`, `terrain`, `accessibility`, `dog_friendly`, `best_light`, `best_seasons`, `max_group_size` | migration 2 |
| `updateSpot` with a field-by-field optional update | `app/data/spot-writes.ts` |
| Pill buttons whose selected state keys off `aria-pressed` | `app/app.css` |

**The gap that reshapes this plan: nobody can enter the data these filters would filter on.**

Verified against the running database and the code. `submit.tsx` collects name, kind, position, description, locality, region, shoot types and photos. `updateSpot` handles name, description, locality, region, `walk_minutes` and `parking_notes`. **`cost_type`, `accessibility`, `terrain` and `dog_friendly` have no write path at all** — the only rows that carry them are the six the seed script inserts.

So a filter milestone that only builds filters would ship controls that match seeded spots and nothing else, and would look broken the moment a user added their own spot and could not find it. Tasks 2 and 3 therefore close the write path first. That is arguably milestone 3's unfinished business, but a filter over data nobody can enter is not a feature, so it belongs here.

**A second finding, from the same check:** the values in `accessibility` and `terrain` are free text with no vocabulary. The seed happens to use `wheelchair`, `stroller`, `restrooms`, `shade` and `paved`, `grass`, `gravel`, `steep`, `stairs`, but nothing stops the next writer using `Wheelchair` or `wheelchair accessible`, and a filter button matching an exact string would silently miss them. Task 1 introduces the vocabulary before anything writes to those columns.

**Constraints carried forward. Each was a real bug once — see `docs/ENGINEERING-NOTES.md`:**

1. `revoke execute … from public` **before** granting any new function.
2. **`create or replace function` with a different argument list creates an overload, it does not replace.** Two overloads leave PostgREST unable to choose. Changing a function's signature means `drop function` with the *old* argument types first — and a drop takes the grants with it, so they must be rewritten.
3. Assert `error.code`, never merely that an error is non-null.
4. `numeric` arrives from PostgREST as a **string**.
5. Every object in a bulk insert must carry the same keys.
6. Loaders and actions return `data(obj, { headers })`, and **every** return path carries `headers`.
7. A test that guards specific behavior must go red when that behavior breaks — and confirm the mutation was actually installed before believing a green suite.

---

## Design decisions

**Filters exclude unknowns, and the empty state has to say so.** Most attributes are nullable, so "walk under 10 minutes" hides every spot whose walk time nobody recorded. That is the correct semantics — a filter promising a short walk must not return spots that might have a long one — but it means filtering bites hardest on a thin map, which is exactly the cold-start risk spec §14 names as dominant. The results panel therefore reports how many spots in view were hidden for lacking the data, so the user can tell "nothing matches" from "nothing has been filled in yet".

**`accessibility` matches all, `terrain` matches any.** Accessibility selections are requirements: someone who picks *wheelchair* and *restrooms* needs both, so the predicate is `@>`. Terrain selections are preferences: someone picking *beach* and *wooded* wants either, so it would be `&&`. Terrain is not in this plan (see below), but the distinction is recorded because the operator is the whole meaning of the filter and the two read identically in a UI.

**Four filters, not eight.** `cost_type`, `walk_minutes`, `accessibility` and `dog_friendly` are the ones spec §1's problem statement names — permits, the walk from the parking lot, whether grandparents can manage. Deliberately left out: `terrain` and `max_group_size` (useful, but no evidence yet that anyone narrows by them), and `best_light` / `best_seasons`, which answer *when to shoot*, not *whether the spot works* — filtering by them would hide spots that simply have not filled the field in, for a question the reader wants answered on the page rather than used as a gate. Spec §4.7 expects this set to change; adding one is a domain constant, one RPC predicate and one control.

**`view` is always written to the URL.** Today `filtersToSearchParams` omits any value matching the default, so `view=split` never appears. Once a cookie remembers the view, that creates a bug with no error: the cookie says `gallery`, the user clicks **split**, the param is omitted, the loader falls back to the cookie, and the click does nothing. Making `view` unconditional costs one query parameter and removes the whole class. This changes an existing test — `explore-filters.test.ts`'s "omits values that match the default" asserts the empty string for default filters — and that test must be updated deliberately rather than deleted.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260811000011_attribute_vocabulary.sql` | Check constraints pinning `accessibility` and `terrain` to the agreed values |
| `supabase/migrations/20260811000012_attribute_filters.sql` | `spots_in_viewport` rebuilt with attribute parameters, plus its grants |
| `app/domain/spots/attributes.ts` | The vocabularies and their labels. Pure, shared by form and filter. |
| `app/domain/filters/attribute-filters.ts` | The attribute filter type, parsing and serialisation. Pure. |
| `app/domain/filters/explore-filters.ts` | Extended to carry attributes; `view` always serialised |
| `app/domain/explore/results-sheet.ts` | Which snap point a drag lands on. Pure. |
| `app/data/spots.ts` | Pass attribute filters to the RPC |
| `app/data/spot-writes.ts` | `updateSpot` gains the attribute columns |
| `app/lib/view-preference.server.ts` | The remembered-view cookie |
| `app/components/explore/FilterBar.tsx` | Attribute filter controls |
| `app/components/explore/ResultsSheet.tsx` | The mobile draggable sheet |
| `app/components/explore/ExploreLayout.tsx` | Gallery map tab, mobile sheet wiring |
| `app/components/spot/AttributeFields.tsx` | The shared attribute inputs for submit and edit |
| `app/routes/home.tsx` | Wire filters and the cookie |
| `app/routes/submit.tsx`, `app/routes/spots.$slug.edit.tsx` | Collect the attributes |

`attributes.ts` is deliberately separate from `attribute-filters.ts`: the first is the vocabulary the forms and the database agree on, the second is how a URL expresses a query over it. They change for different reasons — a new accessibility value touches only the first.

---

## Task 1: The attribute vocabulary

**Files:**
- Create: `app/domain/spots/attributes.ts`, `app/domain/spots/attributes.test.ts`
- Create: `supabase/migrations/20260811000011_attribute_vocabulary.sql`
- Test: `tests/db/attribute-vocabulary.test.ts`

- [ ] **Step 1: Write the failing domain test**

Create `app/domain/spots/attributes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ACCESSIBILITY_OPTIONS,
  TERRAIN_OPTIONS,
  COST_TYPE_OPTIONS,
  labelForAccessibility,
  isAccessibilityValue,
} from "./attributes";

describe("vocabularies", () => {
  it("offers the accessibility values the seed already uses", () => {
    const values = ACCESSIBILITY_OPTIONS.map((o) => o.value);
    for (const seeded of ["wheelchair", "stroller", "restrooms", "shade"]) {
      expect(values).toContain(seeded);
    }
  });

  it("offers the terrain values the seed already uses", () => {
    const values = TERRAIN_OPTIONS.map((o) => o.value);
    for (const seeded of ["paved", "grass", "gravel", "steep", "stairs"]) {
      expect(values).toContain(seeded);
    }
  });

  it("covers every cost_type in the database enum", () => {
    expect(COST_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      "free",
      "park_pass",
      "permit_required",
      "hourly_rate",
      "negotiated",
    ]);
  });

  // Values are stored, labels are shown. A value that reads like a label is how
  // a vocabulary starts drifting into free text.
  it("keeps values machine-shaped and labels human-shaped", () => {
    for (const option of [...ACCESSIBILITY_OPTIONS, ...TERRAIN_OPTIONS, ...COST_TYPE_OPTIONS]) {
      expect(option.value).toMatch(/^[a-z][a-z_]*$/);
      expect(option.label[0]).toMatch(/[A-Z]/);
    }
  });

  it("has no duplicate values", () => {
    const values = ACCESSIBILITY_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("labels a known value and falls back to the raw value for an unknown one", () => {
    expect(labelForAccessibility("wheelchair")).toBe("Wheelchair accessible");
    // Rows written before the vocabulary existed must still render.
    expect(labelForAccessibility("mystery")).toBe("mystery");
  });

  it("recognises which strings are in the vocabulary", () => {
    expect(isAccessibilityValue("stroller")).toBe(true);
    expect(isAccessibilityValue("Stroller")).toBe(false);
    expect(isAccessibilityValue("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:unit -- attributes
```

Expected: FAIL — `Failed to resolve import "./attributes"`.

- [ ] **Step 3: Write the vocabulary**

Create `app/domain/spots/attributes.ts`:

```ts
/**
 * The controlled vocabularies for the array-valued spot attributes.
 *
 * These columns are `text[]` with no vocabulary of their own, so before this
 * existed nothing stopped one contributor writing "wheelchair" and the next
 * writing "Wheelchair accessible" — at which point a filter button matching an
 * exact string silently misses half the map.
 *
 * The values are what gets stored and what the database check constraint
 * enforces; the labels are what people read. Adding an option means adding it
 * here and widening the constraint in a migration — deliberately two steps, so
 * the form and the database cannot drift apart unnoticed.
 */
export interface AttributeOption {
  value: string;
  label: string;
}

export const ACCESSIBILITY_OPTIONS: readonly AttributeOption[] = Object.freeze([
  { value: "wheelchair", label: "Wheelchair accessible" },
  { value: "stroller", label: "Stroller friendly" },
  { value: "restrooms", label: "Restrooms nearby" },
  { value: "seating", label: "Somewhere to sit" },
  { value: "shade", label: "Shade" },
  { value: "paved_path", label: "Paved path" },
]);

export const TERRAIN_OPTIONS: readonly AttributeOption[] = Object.freeze([
  { value: "paved", label: "Paved" },
  { value: "grass", label: "Grass" },
  { value: "gravel", label: "Gravel" },
  { value: "sand", label: "Sand" },
  { value: "water", label: "Water" },
  { value: "wooded", label: "Wooded" },
  { value: "steep", label: "Steep" },
  { value: "stairs", label: "Stairs" },
]);

/** Mirrors the `public.cost_type` enum, in the order the enum declares. */
export const COST_TYPE_OPTIONS: readonly AttributeOption[] = Object.freeze([
  { value: "free", label: "Free" },
  { value: "park_pass", label: "Park pass" },
  { value: "permit_required", label: "Permit required" },
  { value: "hourly_rate", label: "Hourly rate" },
  { value: "negotiated", label: "Negotiated" },
]);

const labelFrom = (options: readonly AttributeOption[], value: string): string =>
  options.find((o) => o.value === value)?.label ?? value;

/**
 * Falls back to the raw value rather than hiding it. Rows written before this
 * vocabulary existed are still real data, and showing "mystery" is honest where
 * showing nothing would quietly lose it.
 */
export const labelForAccessibility = (value: string): string =>
  labelFrom(ACCESSIBILITY_OPTIONS, value);

export const labelForTerrain = (value: string): string => labelFrom(TERRAIN_OPTIONS, value);

export const isAccessibilityValue = (value: string): boolean =>
  ACCESSIBILITY_OPTIONS.some((o) => o.value === value);

export const isTerrainValue = (value: string): boolean =>
  TERRAIN_OPTIONS.some((o) => o.value === value);
```

- [ ] **Step 4: Run the domain test**

```bash
npm run test:unit -- attributes
```

Expected: 7 passing.

- [ ] **Step 5: Write the failing database test**

Create `tests/db/attribute-vocabulary.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { ACCESSIBILITY_OPTIONS, TERRAIN_OPTIONS } from "../../app/domain/spots/attributes";

let author: TestUser;
const spotIds: string[] = [];

beforeAll(async () => {
  author = await createTestUser("Vocabulary Author");
});

afterAll(async () => {
  const { error } = await serviceClient().from("spots").delete().in("id", spotIds);
  if (error) throw error;
  await deleteTestUser(author.id);
});

/**
 * Records every id the database hands back, not only the ones a test expected.
 *
 * The rejection tests below insert deliberately invalid rows, so if a
 * constraint is ever missing — which is exactly the state a mutation test puts
 * the database in — those inserts *succeed*. Collecting ids only on the happy
 * path leaves them behind, and the next attempt to add the constraint fails
 * with "is violated by some row" against rows nobody can find.
 */
const insert = async (fields: Record<string, unknown>) => {
  const result = await serviceClient()
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Vocabulary Spot",
      slug: `vocab-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.68 42.95)",
      created_by: author.id,
      status: "published",
      ...fields,
    })
    .select("id")
    .single();

  if (result.data?.id) spotIds.push(result.data.id);
  return result;
};

describe("attribute vocabulary constraints", () => {
  it("accepts every value the domain layer offers", async () => {
    const { error } = await insert({
      accessibility: ACCESSIBILITY_OPTIONS.map((o) => o.value),
      terrain: TERRAIN_OPTIONS.map((o) => o.value),
    });
    expect(error).toBeNull();
  });

  it("rejects an accessibility value outside the vocabulary", async () => {
    const { error } = await insert({ accessibility: ["wheelchair", "teleporter"] });
    expect(error?.code).toBe("23514");
  });

  it("rejects a terrain value outside the vocabulary", async () => {
    const { error } = await insert({ terrain: ["lava"] });
    expect(error?.code).toBe("23514");
  });

  // Case matters: this is the drift the constraint exists to stop.
  it("rejects a value that differs only in case", async () => {
    const { error } = await insert({ accessibility: ["Wheelchair"] });
    expect(error?.code).toBe("23514");
  });

  // Null is "nobody said", which is the normal state for an optional attribute
  // (spec §4.7) and must stay writable.
  it("still accepts null and empty arrays", async () => {
    const nulls = await insert({ accessibility: null, terrain: null });
    expect(nulls.error).toBeNull();

    const empties = await insert({ accessibility: [], terrain: [] });
    expect(empties.error).toBeNull();
  });

  it("leaves the seeded spots valid", async () => {
    const { count, error } = await serviceClient()
      .from("spots")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npm run test:db -- attribute-vocabulary
```

Expected: the three rejection tests fail, because no constraint exists yet and every value is currently accepted. The acceptance tests pass already. A failure in "accepts every value the domain layer offers" instead means the fixture is wrong.

- [ ] **Step 7: Write the constraint migration**

Create `supabase/migrations/20260811000011_attribute_vocabulary.sql`:

```sql
-- accessibility and terrain are text[] with no vocabulary, so nothing stopped
-- one contributor writing 'wheelchair' and the next writing 'Wheelchair
-- accessible'. A filter button matching an exact string then silently misses
-- half the map — and silently is the operative word, because both rows look
-- perfectly reasonable in the table.
--
-- `<@` is "is contained by", not `&&` ("overlaps"). The two are one character
-- apart and both look plausible, but `&&` is wrong in both directions: it
-- accepts any array holding at least one valid value, and it *rejects* the
-- empty array, because `'{}' && anything` is false. Measured against this
-- database, `&&` cannot even be installed — two seeded spots record
-- `accessibility = '{}'`, and the ALTER fails on them.
--
-- That distinction is the point. `'{}'` is "none of these apply" and null is
-- "nobody said"; both are legitimate answers for an optional attribute
-- (spec §4.7) and both stay writable here. A null array yields null, which
-- passes a check constraint, and an empty array is contained by every array.
--
-- Kept in step with ACCESSIBILITY_OPTIONS and TERRAIN_OPTIONS in
-- app/domain/spots/attributes.ts. Adding an option is deliberately two steps,
-- one here and one there, so the form and the database cannot drift apart
-- without someone noticing.
alter table public.spots add constraint spots_accessibility_vocabulary
  check (accessibility <@ array[
    'wheelchair', 'stroller', 'restrooms', 'seating', 'shade', 'paved_path'
  ]::text[]);

alter table public.spots add constraint spots_terrain_vocabulary
  check (terrain <@ array[
    'paved', 'grass', 'gravel', 'sand', 'water', 'wooded', 'steep', 'stairs'
  ]::text[]);
```

- [ ] **Step 8: Apply and verify**

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" && npx supabase db reset && npm run seed
```

The reset is the real test of the seed's compatibility: if any seeded value is outside the vocabulary, `npm run seed` fails loudly here rather than in production. Then:

```bash
npm run test:db -- attribute-vocabulary
```

Expected: 6 passing.

- [ ] **Step 9: Mutation-test the constraints**

| Mutation | Test that must go red |
| --- | --- |
| Drop `spots_accessibility_vocabulary` | "rejects an accessibility value outside the vocabulary" and "rejects a value that differs only in case" |
| Drop `spots_terrain_vocabulary` | "rejects a terrain value outside the vocabulary" |
| Add `'teleporter'` to the accessibility array | "rejects an accessibility value outside the vocabulary" |
| Change `<@` to `&&` | **cannot be installed** — see below |

The last row turned out to be a stronger result than expected. `&&` is not merely a weaker constraint: `'{}' && anything` is false, so it rejects the empty array — "none of these apply", which is a legitimate answer distinct from "nobody said". Two seeded spots record `accessibility = '{}'`, so the `ALTER` fails against existing rows and the mutation cannot be installed at all. Record that rather than reporting a mutation that "passed".

**The rejection tests insert deliberately invalid rows, so the fixture has to collect every id the database returns, not only the ones a test expected.** When a mutation drops the constraint those inserts *succeed*, and ids collected only on the happy path leave rows behind that then block restoring the constraint — "is violated by some row", against rows nothing in the test knows about. The `insert` helper pushes any id it gets back, for exactly this reason.

- [ ] **Step 10: Commit**

```bash
git add app/domain/spots/attributes.ts app/domain/spots/attributes.test.ts supabase/migrations/20260811000011_attribute_vocabulary.sql tests/db/attribute-vocabulary.test.ts
git commit -m "$(cat <<'EOF'
feat: pin the accessibility and terrain vocabularies

These columns are text[] with no agreed values, so nothing stopped one
contributor writing 'wheelchair' and the next writing 'Wheelchair accessible'.
A filter button matching an exact string then misses half the map, and both
rows look perfectly reasonable in the table — there is no error to notice.

The vocabulary lives in the domain layer, where the form reads it, and is
mirrored by a check constraint, so a limit the application enforces is not the
only limit. Null stays writable: "nobody said" is the normal state for an
optional attribute (spec §4.7).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Let contributors set the attributes

**Files:**
- Create: `app/components/spot/AttributeFields.tsx`, `app/components/spot/AttributeFields.test.tsx`
- Modify: `app/data/spot-writes.ts`, `app/routes/spots.$slug.edit.tsx`
- Test: `tests/db/spot-writes.test.ts` (extend)

Editing comes before submission because `updateSpot` already has the field-by-field shape to extend, and it gives the filters real data on existing spots immediately.

- [ ] **Step 1: Write the failing component test**

Create `app/components/spot/AttributeFields.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { checkedValuesFrom, parseOptionalInt, parseOptionalBool } from "./AttributeFields";

const form = (entries: [string, string][]): FormData => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
};

describe("checkedValuesFrom", () => {
  it("collects every checked box for a field", () => {
    const data = form([
      ["accessibility", "wheelchair"],
      ["accessibility", "restrooms"],
      ["terrain", "grass"],
    ]);
    expect(checkedValuesFrom(data, "accessibility")).toEqual(["wheelchair", "restrooms"]);
  });

  // Unchecking everything must mean "none of these", not "leave it alone" —
  // otherwise an attribute can be added but never removed.
  it("returns an empty array when nothing is checked", () => {
    expect(checkedValuesFrom(form([["terrain", "grass"]]), "accessibility")).toEqual([]);
  });

  // The vocabulary is the authority; a hand-crafted POST does not get to widen it.
  it("drops values outside the vocabulary", () => {
    const data = form([
      ["accessibility", "wheelchair"],
      ["accessibility", "teleporter"],
    ]);
    expect(checkedValuesFrom(data, "accessibility")).toEqual(["wheelchair"]);
  });

  it("validates terrain against its own vocabulary, not accessibility's", () => {
    const data = form([
      ["terrain", "grass"],
      ["terrain", "wheelchair"],
    ]);
    expect(checkedValuesFrom(data, "terrain")).toEqual(["grass"]);
  });
});

describe("parseOptionalInt", () => {
  it("reads a number", () => {
    expect(parseOptionalInt(form([["walkMinutes", "12"]]), "walkMinutes")).toBe(12);
  });

  // An empty field means "clear this", which is a null write, not a zero.
  it("reads an empty field as null, not zero", () => {
    expect(parseOptionalInt(form([["walkMinutes", ""]]), "walkMinutes")).toBeNull();
  });

  it("reads a missing field as null", () => {
    expect(parseOptionalInt(form([]), "walkMinutes")).toBeNull();
  });

  it("rejects nonsense rather than storing NaN", () => {
    expect(parseOptionalInt(form([["walkMinutes", "soon"]]), "walkMinutes")).toBeNull();
  });

  it("rejects a negative walk time", () => {
    expect(parseOptionalInt(form([["walkMinutes", "-3"]]), "walkMinutes")).toBeNull();
  });

  // Zero is a real answer — you park at the spot — and must survive.
  it("keeps a zero", () => {
    expect(parseOptionalInt(form([["walkMinutes", "0"]]), "walkMinutes")).toBe(0);
  });
});

describe("parseOptionalBool", () => {
  it("reads yes and no", () => {
    expect(parseOptionalBool(form([["dogFriendly", "yes"]]), "dogFriendly")).toBe(true);
    expect(parseOptionalBool(form([["dogFriendly", "no"]]), "dogFriendly")).toBe(false);
  });

  // The reason this is a select and not a checkbox: an unchecked box collapses
  // to false, so anyone who ignored the control would publish "Dog friendly:
  // No" — asserting something they never said.
  it("reads an unanswered field as null, not false", () => {
    expect(parseOptionalBool(form([["dogFriendly", ""]]), "dogFriendly")).toBeNull();
    expect(parseOptionalBool(form([]), "dogFriendly")).toBeNull();
  });

  it("treats anything unrecognised as unanswered", () => {
    expect(parseOptionalBool(form([["dogFriendly", "maybe"]]), "dogFriendly")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:unit -- AttributeFields
```

Expected: FAIL — `Failed to resolve import "./AttributeFields"`.

- [ ] **Step 3: Write the component**

Create `app/components/spot/AttributeFields.tsx`:

```tsx
import {
  ACCESSIBILITY_OPTIONS,
  TERRAIN_OPTIONS,
  COST_TYPE_OPTIONS,
  isAccessibilityValue,
  isTerrainValue,
} from "~/domain/spots/attributes";

const VALIDATORS: Record<string, (value: string) => boolean> = {
  accessibility: isAccessibilityValue,
  terrain: isTerrainValue,
};

/**
 * The checked boxes for one field, filtered to the vocabulary.
 *
 * The filter is not defensive noise: the form only renders valid boxes, but the
 * action is a public endpoint and the database constraint would reject the
 * whole write with a 23514 the user cannot act on. Dropping unknown values
 * turns a hand-crafted POST into a no-op instead of an error.
 */
export function checkedValuesFrom(form: FormData, field: string): string[] {
  const isValid = VALIDATORS[field] ?? (() => true);
  return form
    .getAll(field)
    .map(String)
    .filter(isValid);
}

/**
 * A tri-state read for an optional boolean.
 *
 * Deliberately not a checkbox. An unchecked box cannot say "I don't know" — it
 * collapses to false — so every contributor who simply ignored the control
 * would publish "Dog friendly: No" on the spot page, asserting something they
 * never said. Every other optional attribute treats null as "nobody said"
 * (spec §4.7), and the detail page omits a null rather than rendering it.
 */
export function parseOptionalBool(form: FormData, field: string): boolean | null {
  const raw = form.get(field);
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return null;
}

/**
 * An empty or missing field is null — "clear this" — not zero. Reading it as
 * zero would turn "I don't know the walk time" into "it is right there".
 */
export function parseOptionalInt(form: FormData, field: string): number | null {
  const raw = form.get(field);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export interface AttributeValues {
  costType: string | null;
  walkMinutes: number | null;
  accessibility: string[] | null;
  terrain: string[] | null;
  dogFriendly: boolean | null;
}

/** Shared by the submission form and the edit form, so the two cannot diverge. */
export function AttributeFields({ current }: { current: AttributeValues }) {
  const accessibility = current.accessibility ?? [];
  const terrain = current.terrain ?? [];

  return (
    <fieldset className="attribute-fields">
      <legend>Practical detail</legend>
      <p className="attribute-fields__hint">
        All optional — but these are what someone filters on, so anything you fill in makes the
        spot findable.
      </p>

      <label>
        Cost
        <select name="costType" defaultValue={current.costType ?? ""}>
          <option value="">Not sure</option>
          {COST_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Walk from parking (minutes)
        <input type="number" name="walkMinutes" min={0} defaultValue={current.walkMinutes ?? ""} />
      </label>

      <fieldset>
        <legend>Getting around</legend>
        {ACCESSIBILITY_OPTIONS.map((o) => (
          <label key={o.value}>
            <input
              type="checkbox"
              name="accessibility"
              value={o.value}
              defaultChecked={accessibility.includes(o.value)}
            />
            {o.label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Underfoot</legend>
        {TERRAIN_OPTIONS.map((o) => (
          <label key={o.value}>
            <input
              type="checkbox"
              name="terrain"
              value={o.value}
              defaultChecked={terrain.includes(o.value)}
            />
            {o.label}
          </label>
        ))}
      </fieldset>

      <label>
        Dogs
        <select
          name="dogFriendly"
          defaultValue={current.dogFriendly === null ? "" : current.dogFriendly ? "yes" : "no"}
        >
          <option value="">Not sure</option>
          <option value="yes">Welcome</option>
          <option value="no">Not allowed</option>
        </select>
      </label>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run the component test**

```bash
npm run test:unit -- AttributeFields
```

Expected: 8 passing.

- [ ] **Step 5: Extend `updateSpot`**

In `app/data/spot-writes.ts`, widen the `fields` parameter and the update object:

```ts
export async function updateSpot(
  supabase: SupabaseClient,
  spotId: string,
  fields: {
    name?: string;
    description?: string | null;
    locality?: string | null;
    region?: string | null;
    walkMinutes?: number | null;
    parkingNotes?: string | null;
    costType?: string | null;
    accessibility?: string[] | null;
    terrain?: string[] | null;
    dogFriendly?: boolean | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("spots")
    .update({
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.description !== undefined ? { description: fields.description } : {}),
      ...(fields.locality !== undefined ? { locality: fields.locality } : {}),
      ...(fields.region !== undefined ? { region: fields.region } : {}),
      ...(fields.walkMinutes !== undefined ? { walk_minutes: fields.walkMinutes } : {}),
      ...(fields.parkingNotes !== undefined ? { parking_notes: fields.parkingNotes } : {}),
      ...(fields.costType !== undefined ? { cost_type: fields.costType } : {}),
      ...(fields.accessibility !== undefined ? { accessibility: fields.accessibility } : {}),
      ...(fields.terrain !== undefined ? { terrain: fields.terrain } : {}),
      ...(fields.dogFriendly !== undefined ? { dog_friendly: fields.dogFriendly } : {}),
    })
    .eq("id", spotId);
  if (error) throw error;
}
```

The `!== undefined` guard is what separates "not on this form" from "cleared to null", and it is why every attribute has to be sent explicitly by the edit action rather than only when non-empty.

- [ ] **Step 6: Add the database test**

Append to `tests/db/spot-writes.test.ts`, inside the existing `describe("updateSpot", …)` if there is one, otherwise as a new block. Use the existing fixture's spot and author:

```ts
describe("updateSpot attributes", () => {
  it("writes every attribute column", async () => {
    await updateSpot(author.client, spotId, {
      costType: "permit_required",
      walkMinutes: 8,
      accessibility: ["wheelchair", "restrooms"],
      terrain: ["paved", "grass"],
      dogFriendly: true,
    });

    const { data, error } = await serviceClient()
      .from("spots")
      .select("cost_type, walk_minutes, accessibility, terrain, dog_friendly")
      .eq("id", spotId)
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({
      cost_type: "permit_required",
      walk_minutes: 8,
      accessibility: ["wheelchair", "restrooms"],
      terrain: ["paved", "grass"],
      dog_friendly: true,
    });
  });

  // Clearing has to be possible, or an attribute set by mistake is permanent.
  it("clears an attribute back to null", async () => {
    await updateSpot(author.client, spotId, { costType: null, accessibility: [], dogFriendly: null });

    const { data } = await serviceClient()
      .from("spots")
      .select("cost_type, accessibility, dog_friendly")
      .eq("id", spotId)
      .single();
    expect(data).toEqual({ cost_type: null, accessibility: [], dog_friendly: null });
  });

  it("refuses a value outside the vocabulary, so the constraint is not bypassed", async () => {
    await expect(
      updateSpot(author.client, spotId, { accessibility: ["teleporter"] }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  // The column grants in migration 5 are what allow this at all; score, status
  // and the counters are deliberately absent from them.
  it("cannot be used to reach a column that is not granted", async () => {
    const { error } = await author.client.from("spots").update({ score: 99 }).eq("id", spotId);
    expect(error?.code).toBe("42501");
  });
});
```

- [ ] **Step 7: Run it**

```bash
npm run test:db -- spot-writes
```

Expected: the existing tests plus 4 new ones passing.

- [ ] **Step 8: Wire the edit route**

In `app/routes/spots.$slug.edit.tsx`, import the component and its parsers:

```tsx
import {
  AttributeFields,
  checkedValuesFrom,
  parseOptionalInt,
} from "~/components/spot/AttributeFields";
```

Render `<AttributeFields current={{ costType: spot.costType, walkMinutes: spot.walkMinutes, accessibility: spot.accessibility, terrain: spot.terrain, dogFriendly: spot.dogFriendly }} />` inside the existing form, and in the action pass every attribute explicitly:

```tsx
  await updateSpot(supabase, spot.id, {
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? "") || null,
    locality: String(form.get("locality") ?? "") || null,
    region: String(form.get("region") ?? "") || null,
    parkingNotes: String(form.get("parkingNotes") ?? "") || null,
    costType: String(form.get("costType") ?? "") || null,
    walkMinutes: parseOptionalInt(form, "walkMinutes"),
    accessibility: checkedValuesFrom(form, "accessibility"),
    terrain: checkedValuesFrom(form, "terrain"),
    // An unchecked checkbox sends nothing at all, which is why this reads
    // presence rather than a value — and why it can express false rather than
    // collapsing to null.
    dogFriendly: form.has("dogFriendly"),
  });
```

Keep whatever fields the existing action already sends; this adds to them.

- [ ] **Step 9: Verify in the browser**

Start the preview server, sign in, open a seeded spot's edit page, set a cost and two accessibility values, save, and confirm the detail page shows them. Then clear them and confirm they disappear. Do not skip the clearing half — it is the half that `!== undefined` exists for.

- [ ] **Step 10: Commit**

```bash
git add app/components/spot/AttributeFields.tsx app/components/spot/AttributeFields.test.tsx app/data/spot-writes.ts app/routes/spots.\$slug.edit.tsx tests/db/spot-writes.test.ts
git commit -m "$(cat <<'EOF'
feat: let contributors set the practical attributes

Before this, cost_type, accessibility, terrain and dog_friendly had no write
path at all — the only rows carrying them were the six the seed script
inserts. Filtering on them would have matched seeded spots and nothing else,
and looked broken the moment someone added their own spot and could not find it.

Unchecking every box means "none of these", not "leave it alone", so an
attribute set by mistake can be removed. That is why the action sends every
attribute explicitly and updateSpot distinguishes undefined from null.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Attributes on the submission form

**Files:**
- Modify: `app/routes/submit.tsx`, `app/domain/spots/submission.ts`
- Test: `app/domain/spots/submission.test.ts` (extend), `tests/db/rpcs.test.ts` (extend)
- Modify: `supabase/migrations/20260811000012_attribute_filters.sql` — **no**; `create_spot` is in migration 8 and gains parameters here, so this task adds `supabase/migrations/20260811000013_create_spot_attributes.sql`

- [ ] **Step 1: Read the current `create_spot` signature**

```bash
grep -n "create or replace function public.create_spot" -A 30 supabase/migrations/20260810000008_contribution.sql
```

You need its exact argument list, because changing it means dropping the old signature first — `create or replace` with a different argument list creates an **overload**, and PostgREST then cannot choose between them. Record the exact list before writing anything.

- [ ] **Step 2: Write the failing domain test**

Append to `app/domain/spots/submission.test.ts`:

```ts
describe("submission attributes", () => {
  it("accepts a submission with no attributes at all", () => {
    expect(validateSubmission(valid()).errors).toEqual([]);
  });

  it("rejects an accessibility value outside the vocabulary", () => {
    const { errors } = validateSubmission({ ...valid(), accessibility: ["teleporter"] });
    expect(errors.some((e) => e.field === "accessibility")).toBe(true);
  });

  it("rejects a negative walk time", () => {
    const { errors } = validateSubmission({ ...valid(), walkMinutes: -1 });
    expect(errors.some((e) => e.field === "walkMinutes")).toBe(true);
  });

  it("accepts a zero walk time, which means you park at the spot", () => {
    expect(validateSubmission({ ...valid(), walkMinutes: 0 }).errors).toEqual([]);
  });
});
```

`valid()` is the existing helper in that file that builds a minimal passing submission; extend `SubmissionInput` with the optional attribute fields so these compile.

- [ ] **Step 3: Run it, watch it fail, then extend `SubmissionInput` and `validateSubmission`**

Add to `SubmissionInput` in `app/domain/spots/submission.ts`:

```ts
  costType?: string | null;
  walkMinutes?: number | null;
  accessibility?: string[];
  terrain?: string[];
  dogFriendly?: boolean | null;
```

and to `validateSubmission`, before the `return`:

```ts
  // The database constraint is the authority; this exists so the user is told
  // which value is wrong instead of seeing a 23514 naming the whole array.
  for (const value of input.accessibility ?? []) {
    if (!isAccessibilityValue(value)) {
      errors.push({ field: "accessibility", message: `"${value}" is not an option.` });
    }
  }
  for (const value of input.terrain ?? []) {
    if (!isTerrainValue(value)) {
      errors.push({ field: "terrain", message: `"${value}" is not an option.` });
    }
  }
  if (input.walkMinutes !== undefined && input.walkMinutes !== null && input.walkMinutes < 0) {
    errors.push({ field: "walkMinutes", message: "Walk time cannot be negative." });
  }
```

with `import { isAccessibilityValue, isTerrainValue } from "./attributes";` at the top.

- [ ] **Step 4: Extend `create_spot`**

Create `supabase/migrations/20260811000013_create_spot_attributes.sql`. Drop the old signature by its exact argument list from step 1, then recreate it with the attribute parameters appended and re-grant it:

```sql
-- create_spot gains the practical attributes, so a spot can be findable from
-- the moment it is submitted rather than only after someone edits it.
--
-- DROP first, not CREATE OR REPLACE. Postgres keys functions by their argument
-- list, so a replace with different parameters creates a second overload and
-- leaves PostgREST unable to choose between them — with the old one still
-- winning for existing callers. The drop takes the grants with it, so they are
-- rewritten below.
drop function if exists public.create_spot(
  text, public.spot_kind, double precision, double precision, text, text, text, text,
  integer[], jsonb
);

create or replace function public.create_spot(
  p_name text,
  p_kind public.spot_kind,
  p_lng double precision,
  p_lat double precision,
  p_slug text,
  p_description text,
  p_locality text,
  p_region text,
  p_shoot_type_ids integer[],
  p_photos jsonb,
  p_cost_type text default null,
  p_walk_minutes integer default null,
  p_accessibility text[] default null,
  p_terrain text[] default null,
  p_dog_friendly boolean default null
)
returns uuid
language plpgsql
security invoker
-- `''`, not `public, extensions`, matching migration 8. Every reference below
-- is schema-qualified for that reason, including extensions.st_point.
set search_path = ''
as $$
declare
  v_spot_id uuid;
  v_photo jsonb;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to submit a spot';
  end if;
  if coalesce(array_length(p_shoot_type_ids, 1), 0) = 0 then
    raise exception 'a spot needs at least one shoot type';
  end if;
  if jsonb_array_length(coalesce(p_photos, '[]'::jsonb)) = 0 then
    raise exception 'a spot needs at least one photo';
  end if;

  insert into public.spots (
    kind, name, slug, description, location, created_by, locality, region,
    cost_type, walk_minutes, accessibility, terrain, dog_friendly
  )
  values (
    p_kind, p_name, p_slug, nullif(p_description, ''),
    extensions.st_point(p_lng, p_lat)::extensions.geography,
    auth.uid(), nullif(p_locality, ''), nullif(p_region, ''),
    -- nullif on the enum cast, so an empty string from a form that left the
    -- select on "Not sure" stores null rather than failing the cast.
    nullif(p_cost_type, '')::public.cost_type,
    p_walk_minutes,
    -- An empty array is "none of these", which is a real answer and different
    -- from null; only a genuinely absent argument becomes null.
    p_accessibility,
    p_terrain,
    p_dog_friendly
  )
  returning id into v_spot_id;

  insert into public.spot_shoot_types (spot_id, shoot_type_id)
  select v_spot_id, unnest(p_shoot_type_ids);

  for v_photo in select * from jsonb_array_elements(p_photos)
  loop
    insert into public.photos (
      spot_id, profile_id, kind, storage_path, caption,
      rights_attested, credit_name, credit_url
    )
    values (
      v_spot_id,
      auth.uid(),
      (v_photo ->> 'kind')::public.photo_kind,
      v_photo ->> 'storage_path',
      nullif(v_photo ->> 'caption', ''),
      coalesce((v_photo ->> 'rights_attested')::boolean, false),
      nullif(v_photo ->> 'credit_name', ''),
      nullif(v_photo ->> 'credit_url', '')
    );
  end loop;

  return v_spot_id;
end;
$$;

revoke execute on function public.create_spot(
  text, public.spot_kind, double precision, double precision, text, text, text, text,
  integer[], jsonb, text, integer, text[], text[], boolean
) from public;

grant execute on function public.create_spot(
  text, public.spot_kind, double precision, double precision, text, text, text, text,
  integer[], jsonb, text, integer, text[], text[], boolean
) to authenticated;
```

The body above is migration 8's, with five columns added to the `INSERT` and nothing else changed. **Diff it against `20260810000008_contribution.sql` before applying** rather than trusting this transcription — the shoot-type insert and the photo loop have to stay in the same transaction, and losing either reintroduces the photo-less spot that spec §10 exists to prevent.

Then verify no overload survives:

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker exec supabase_db_photospots psql -U postgres -d postgres -c \
  "select oid::regprocedure from pg_proc where proname = 'create_spot';"
```

Expected: exactly one row. Two rows means the drop's argument list did not match the original and an overload is live.

- [ ] **Step 5: Extend the RPC test**

**Correction to this plan:** there is no `create_spot` block in `tests/db/rpcs.test.ts`. `createSpot`
is exercised through `tests/db/spot-writes.test.ts`, which already has a `submission()` fixture —
put the tests there and reuse it, rather than building a second fixture beside the first.

Append to `tests/db/spot-writes.test.ts`:

```ts
  it("stores the attributes it was given", async () => {
    const { data, error } = await author.client.rpc("create_spot", {
      ...baseArgs(),
      p_slug: `attrs-${crypto.randomUUID().slice(0, 8)}`,
      p_cost_type: "park_pass",
      p_walk_minutes: 4,
      p_accessibility: ["stroller"],
      p_terrain: ["grass"],
      p_dog_friendly: true,
    });
    expect(error).toBeNull();

    const { data: row } = await serviceClient()
      .from("spots")
      .select("cost_type, walk_minutes, accessibility, terrain, dog_friendly")
      .eq("id", data)
      .single();
    expect(row).toEqual({
      cost_type: "park_pass",
      walk_minutes: 4,
      accessibility: ["stroller"],
      terrain: ["grass"],
      dog_friendly: true,
    });
  });

  it("still works with no attributes, since they are all optional", async () => {
    const { error } = await author.client.rpc("create_spot", {
      ...baseArgs(),
      p_slug: `no-attrs-${crypto.randomUUID().slice(0, 8)}`,
    });
    expect(error).toBeNull();
  });
```

`baseArgs()` is whatever the existing tests use to build a valid call; extract it as a helper if it is currently inline.

- [ ] **Step 6: Pass the attributes through `createSpot` and the form**

In `app/data/spot-writes.ts`, add the five parameters to the `supabase.rpc("create_spot", …)` call, mapping `input.costType ?? null` and so on. In `app/routes/submit.tsx`, render `<AttributeFields current={{ costType: null, walkMinutes: null, accessibility: [], terrain: [], dogFriendly: null }} />` inside the existing `<details>` block and read the values in the action with `checkedValuesFrom` and `parseOptionalInt`.

- [ ] **Step 7: Run everything, then verify by submitting a real spot**

```bash
npm test && npm run typecheck
```

Then submit a spot through the browser with a cost, a walk time and two accessibility values, and confirm the detail page shows them. A spot submitted without any attributes must still save — that is the "all optional" rule from spec §4.7.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260811000013_create_spot_attributes.sql app/domain/spots/submission.ts app/domain/spots/submission.test.ts app/data/spot-writes.ts app/routes/submit.tsx tests/db/rpcs.test.ts
git commit -m "$(cat <<'EOF'
feat: collect the practical attributes at submission

A spot is findable from the moment it is submitted rather than only after
someone remembers to edit it, which matters most for the spots nobody edits.

create_spot was dropped and recreated rather than replaced. Postgres keys
functions by their argument list, so CREATE OR REPLACE with new parameters
creates a second overload and leaves PostgREST unable to choose — with the old
one still serving existing callers. The drop takes the grants with it, so they
are rewritten, and a pg_proc check confirms exactly one signature survives.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The attribute filter type

**Files:**
- Create: `app/domain/filters/attribute-filters.ts`, `app/domain/filters/attribute-filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/domain/filters/attribute-filters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseAttributeFilters,
  attributeFiltersToParams,
  hasAnyAttributeFilter,
  NO_ATTRIBUTE_FILTERS,
  type AttributeFilters,
} from "./attribute-filters";

const parse = (qs: string) => parseAttributeFilters(new URLSearchParams(qs));

describe("parseAttributeFilters", () => {
  it("is empty for an empty URL", () => {
    expect(parse("")).toEqual(NO_ATTRIBUTE_FILTERS);
  });

  it("reads a comma-separated cost list", () => {
    expect(parse("cost=free,park_pass").costTypes).toEqual(["free", "park_pass"]);
  });

  it("reads a maximum walk time", () => {
    expect(parse("walk=10").maxWalkMinutes).toBe(10);
  });

  it("reads accessibility requirements", () => {
    expect(parse("access=wheelchair,restrooms").accessibility).toEqual([
      "wheelchair",
      "restrooms",
    ]);
  });

  it("reads the dogs flag", () => {
    expect(parse("dogs=1").dogFriendlyOnly).toBe(true);
    expect(parse("").dogFriendlyOnly).toBe(false);
  });

  // Search params arrive from other people's links and from hand editing, so
  // every field falls back rather than throwing — a bad URL shows an unfiltered
  // map, not an error page.
  it("drops values outside the vocabulary instead of querying for them", () => {
    expect(parse("access=wheelchair,teleporter").accessibility).toEqual(["wheelchair"]);
    expect(parse("cost=free,gold_bars").costTypes).toEqual(["free"]);
  });

  it("ignores a walk time that is not a non-negative integer", () => {
    expect(parse("walk=soon").maxWalkMinutes).toBeNull();
    expect(parse("walk=-5").maxWalkMinutes).toBeNull();
    expect(parse("walk=1.5").maxWalkMinutes).toBeNull();
  });

  it("ignores empty entries rather than filtering on the empty string", () => {
    expect(parse("access=,,wheelchair,").accessibility).toEqual(["wheelchair"]);
    expect(parse("access=").accessibility).toEqual([]);
  });
});

describe("attributeFiltersToParams", () => {
  const filters = (over: Partial<AttributeFilters> = {}): AttributeFilters => ({
    ...NO_ATTRIBUTE_FILTERS,
    ...over,
  });

  it("writes nothing when nothing is filtered", () => {
    expect(attributeFiltersToParams(filters()).toString()).toBe("");
  });

  it("round-trips", () => {
    const f = filters({
      costTypes: ["free"],
      maxWalkMinutes: 12,
      accessibility: ["stroller", "shade"],
      dogFriendlyOnly: true,
    });
    expect(parseAttributeFilters(attributeFiltersToParams(f))).toEqual(f);
  });

  it("omits the dogs flag when it is off, so a share link stays short", () => {
    expect(attributeFiltersToParams(filters({ dogFriendlyOnly: false })).has("dogs")).toBe(false);
  });
});

describe("hasAnyAttributeFilter", () => {
  it("is false for the empty set", () => {
    expect(hasAnyAttributeFilter(NO_ATTRIBUTE_FILTERS)).toBe(false);
  });

  // Each field separately: an `||` chain that forgets one reads as working
  // until someone filters by only that field.
  it("is true for any single filter", () => {
    expect(hasAnyAttributeFilter({ ...NO_ATTRIBUTE_FILTERS, costTypes: ["free"] })).toBe(true);
    expect(hasAnyAttributeFilter({ ...NO_ATTRIBUTE_FILTERS, maxWalkMinutes: 5 })).toBe(true);
    expect(hasAnyAttributeFilter({ ...NO_ATTRIBUTE_FILTERS, accessibility: ["shade"] })).toBe(true);
    expect(hasAnyAttributeFilter({ ...NO_ATTRIBUTE_FILTERS, dogFriendlyOnly: true })).toBe(true);
  });

  // Zero is a real filter — "you can park at the spot" — and would be dropped
  // by a truthiness check.
  it("treats a zero-minute walk as a filter", () => {
    expect(hasAnyAttributeFilter({ ...NO_ATTRIBUTE_FILTERS, maxWalkMinutes: 0 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:unit -- attribute-filters
```

Expected: FAIL — `Failed to resolve import "./attribute-filters"`.

- [ ] **Step 3: Write the implementation**

Create `app/domain/filters/attribute-filters.ts`:

```ts
import {
  COST_TYPE_OPTIONS,
  isAccessibilityValue,
} from "../spots/attributes";

export interface AttributeFilters {
  /** Any-of. Empty means no cost filter. */
  costTypes: string[];
  /** Inclusive upper bound. Null means no walk filter. */
  maxWalkMinutes: number | null;
  /** All-of: these are requirements, not preferences. */
  accessibility: string[];
  dogFriendlyOnly: boolean;
}

export const NO_ATTRIBUTE_FILTERS: AttributeFilters = Object.freeze({
  costTypes: [],
  maxWalkMinutes: null,
  accessibility: [],
  dogFriendlyOnly: false,
});

const isCostType = (value: string) => COST_TYPE_OPTIONS.some((o) => o.value === value);

/** Splits on commas, drops blanks, and keeps only values the vocabulary knows. */
const list = (params: URLSearchParams, key: string, isValid: (v: string) => boolean): string[] => {
  const raw = params.get(key);
  if (raw === null) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "" && isValid(v));
};

/**
 * Search params arrive from other people's links and from hand editing, so a
 * bad value is dropped rather than thrown on — a broken URL should show an
 * unfiltered map, not an error page. Dropping also matters for correctness:
 * passing an unknown string through to the query would filter on something no
 * row can match, which looks identical to "no results" and is not.
 */
export function parseAttributeFilters(params: URLSearchParams): AttributeFilters {
  const walkRaw = params.get("walk");
  const walk = walkRaw === null || walkRaw.trim() === "" ? NaN : Number(walkRaw);

  return {
    costTypes: list(params, "cost", isCostType),
    maxWalkMinutes: Number.isInteger(walk) && walk >= 0 ? walk : null,
    accessibility: list(params, "access", isAccessibilityValue),
    dogFriendlyOnly: params.get("dogs") === "1",
  };
}

export function attributeFiltersToParams(filters: AttributeFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.costTypes.length > 0) params.set("cost", filters.costTypes.join(","));
  if (filters.maxWalkMinutes !== null) params.set("walk", String(filters.maxWalkMinutes));
  if (filters.accessibility.length > 0) params.set("access", filters.accessibility.join(","));
  if (filters.dogFriendlyOnly) params.set("dogs", "1");
  return params;
}

/**
 * Checks `maxWalkMinutes !== null` rather than its truthiness: zero is a real
 * filter meaning "you can park at the spot", and a truthiness check would treat
 * it as no filter at all.
 */
export function hasAnyAttributeFilter(filters: AttributeFilters): boolean {
  return (
    filters.costTypes.length > 0 ||
    filters.maxWalkMinutes !== null ||
    filters.accessibility.length > 0 ||
    filters.dogFriendlyOnly
  );
}
```

- [ ] **Step 4: Run the test**

```bash
npm run test:unit -- attribute-filters
```

Expected: 15 passing.

- [ ] **Step 5: Mutation-test**

| Mutation | Test that must go red |
| --- | --- |
| `filters.maxWalkMinutes !== null` → `filters.maxWalkMinutes` in `hasAnyAttributeFilter` | "treats a zero-minute walk as a filter" |
| Drop the `isValid` filter in `list` | "drops values outside the vocabulary instead of querying for them" |
| Drop the `v !== ""` filter in `list` | "ignores empty entries rather than filtering on the empty string" |
| `Number.isInteger(walk) && walk >= 0` → `!Number.isNaN(walk)` | "ignores a walk time that is not a non-negative integer" |
| Remove one clause from `hasAnyAttributeFilter`'s `||` chain | "is true for any single filter" |

- [ ] **Step 6: Commit**

```bash
git add app/domain/filters/attribute-filters.ts app/domain/filters/attribute-filters.test.ts
git commit -m "$(cat <<'EOF'
feat: parse attribute filters out of the URL

Unknown values are dropped rather than passed through. That is not only
defensive: filtering on a string no row can contain looks exactly like "no
results", so a typo in a shared link would read as an empty map rather than as
a broken URL.

hasAnyAttributeFilter compares maxWalkMinutes against null rather than testing
truthiness, because zero is a real filter — you park at the spot.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Filtering in the viewport query

**Files:**
- Create: `supabase/migrations/20260811000012_attribute_filters.sql`
- Modify: `app/domain/filters/explore-filters.ts`, `app/domain/filters/explore-filters.test.ts`, `app/data/spots.ts`
- Test: `tests/db/attribute-filtering.test.ts`

- [ ] **Step 1: Write the failing database test**

Create `tests/db/attribute-filtering.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";

let author: TestUser;
const ids: Record<string, string> = {};

// A box around the fixtures, well away from the seeded Grand Rapids spots so
// this file's assertions cannot be perturbed by the seed.
const BOX = { west: -95.05, south: 40.0, east: -94.95, north: 40.1 };

const makeSpot = async (name: string, fields: Record<string, unknown>) => {
  const { data, error } = await serviceClient()
    .from("spots")
    .insert({
      kind: "outdoor",
      name,
      slug: `filter-${name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-95.0 40.05)",
      created_by: author.id,
      status: "published",
      ...fields,
    })
    .select("id")
    .single();
  if (error) throw error;
  ids[name] = data.id;
};

beforeAll(async () => {
  author = await createTestUser("Filter Author");
  await makeSpot("Free", {
    cost_type: "free",
    walk_minutes: 2,
    accessibility: ["wheelchair", "restrooms"],
    dog_friendly: true,
  });
  await makeSpot("Permit", {
    cost_type: "permit_required",
    walk_minutes: 20,
    accessibility: ["restrooms"],
    dog_friendly: false,
  });
  await makeSpot("Unknown", {});
});

afterAll(async () => {
  const { error } = await serviceClient()
    .from("spots")
    .delete()
    .in("id", Object.values(ids));
  if (error) throw error;
  await deleteTestUser(author.id);
});

const query = async (args: Record<string, unknown> = {}): Promise<string[]> => {
  const { data, error } = await anonClient().rpc("spots_in_viewport", {
    p_west: BOX.west,
    p_south: BOX.south,
    p_east: BOX.east,
    p_north: BOX.north,
    ...args,
  });
  expect(error).toBeNull();
  return ((data ?? []) as { name: string }[]).map((r) => r.name).sort();
};

describe("spots_in_viewport attribute filters", () => {
  it("returns everything in the box when nothing is filtered", async () => {
    expect(await query()).toEqual(["Free", "Permit", "Unknown"]);
  });

  it("filters by cost, matching any of the given types", async () => {
    expect(await query({ p_cost_types: ["free"] })).toEqual(["Free"]);
    expect(await query({ p_cost_types: ["free", "permit_required"] })).toEqual(["Free", "Permit"]);
  });

  it("filters by an upper bound on the walk", async () => {
    expect(await query({ p_max_walk_minutes: 5 })).toEqual(["Free"]);
    expect(await query({ p_max_walk_minutes: 20 })).toEqual(["Free", "Permit"]);
  });

  // Accessibility selections are requirements, so every one must be present.
  // With `&&` instead of `@>`, Permit would match on restrooms alone.
  it("requires every accessibility value, not just one of them", async () => {
    expect(await query({ p_accessibility: ["restrooms"] })).toEqual(["Free", "Permit"]);
    expect(await query({ p_accessibility: ["wheelchair", "restrooms"] })).toEqual(["Free"]);
  });

  it("filters to dog-friendly spots, excluding the explicit no", async () => {
    expect(await query({ p_dog_friendly: true })).toEqual(["Free"]);
  });

  // The whole point of the null semantics. A filter promising a short walk
  // must not return a spot whose walk nobody recorded.
  it("excludes spots where the attribute is unknown", async () => {
    expect(await query({ p_max_walk_minutes: 60 })).not.toContain("Unknown");
    expect(await query({ p_cost_types: ["free"] })).not.toContain("Unknown");
    expect(await query({ p_accessibility: ["restrooms"] })).not.toContain("Unknown");
    expect(await query({ p_dog_friendly: true })).not.toContain("Unknown");
  });

  it("combines filters as an AND", async () => {
    expect(await query({ p_cost_types: ["free"], p_max_walk_minutes: 1 })).toEqual([]);
    expect(await query({ p_cost_types: ["free"], p_max_walk_minutes: 5 })).toEqual(["Free"]);
  });

  // An empty array is "no filter", not "match nothing" — the UI sends one the
  // moment a user unchecks their last box.
  it("treats an empty filter array as no filter", async () => {
    expect(await query({ p_cost_types: [] })).toEqual(["Free", "Permit", "Unknown"]);
    expect(await query({ p_accessibility: [] })).toEqual(["Free", "Permit", "Unknown"]);
  });

  it("is still callable by a logged-out visitor", async () => {
    const { error } = await anonClient().rpc("spots_in_viewport", {
      p_west: BOX.west,
      p_south: BOX.south,
      p_east: BOX.east,
      p_north: BOX.north,
      p_cost_types: ["free"],
    });
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:db -- attribute-filtering
```

Expected: the unfiltered test passes; every filtered one fails with `PGRST202`, because the parameters do not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811000012_attribute_filters.sql`:

```sql
-- Attribute filtering happens here rather than in the client because the query
-- caps at 500 rows. A filter applied after the cap would silently drop spots
-- that matched but fell outside the first 500 — the map would appear to lose
-- results as it got busier, which is the worst possible time.
--
-- DROP first: Postgres keys functions by their argument list, so CREATE OR
-- REPLACE with new parameters creates a second overload rather than replacing,
-- and PostgREST is then unable to choose between them. The drop takes the
-- grants with it, so they are rewritten below.
--
-- Null semantics, deliberately: every predicate excludes rows where the
-- attribute is unknown. A filter promising a short walk must not return a spot
-- whose walk time nobody recorded. The cost is that filtering bites hardest on
-- a thin map, which is why the UI reports how many spots were hidden for
-- lacking the data rather than leaving the user to guess (spec §14).
drop function if exists public.spots_in_viewport(
  double precision, double precision, double precision, double precision, integer, text, integer
);

create or replace function public.spots_in_viewport(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_shoot_type_id integer default null,
  p_sort text default 'score',
  p_limit integer default 200,
  p_cost_types text[] default null,
  p_max_walk_minutes integer default null,
  p_accessibility text[] default null,
  p_dog_friendly boolean default null
)
returns table (
  id uuid,
  name text,
  slug text,
  kind public.spot_kind,
  lat double precision,
  lng double precision,
  locality text,
  region text,
  score numeric,
  hot_score numeric,
  comment_count integer,
  scouting_photo_count integer,
  session_photo_count integer,
  cover_photo_path text,
  cover_credit_name text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.id, s.name, s.slug, s.kind,
    st_y(s.location::geometry) as lat,
    st_x(s.location::geometry) as lng,
    s.locality, s.region, s.score, s.hot_score,
    s.comment_count, s.scouting_photo_count, s.session_photo_count,
    cover.storage_path, cover.credit_name
  from public.spots s
  left join lateral (
    select p.storage_path, p.credit_name
    from public.photos p
    where p.spot_id = s.id and p.status = 'published'
    order by (p.kind = 'session') desc, p.created_at asc
    limit 1
  ) cover on true
  where s.status = 'published'
    and st_intersects(
          s.location,
          st_makeenvelope(p_west, p_south, p_east, p_north, 4326)::geography
        )
    and (
      p_shoot_type_id is null
      or exists (
        select 1 from public.spot_shoot_types st
        where st.spot_id = s.id and st.shoot_type_id = p_shoot_type_id
      )
    )
    -- cardinality = 0 is "no filter", not "match nothing": the UI sends an
    -- empty array the moment a user unchecks their last box.
    and (
      p_cost_types is null or cardinality(p_cost_types) = 0
      or s.cost_type::text = any(p_cost_types)
    )
    and (
      p_max_walk_minutes is null
      or (s.walk_minutes is not null and s.walk_minutes <= p_max_walk_minutes)
    )
    -- `@>` (contains), not `&&` (overlaps): these are requirements, so a spot
    -- with only one of two selected values must not match.
    and (
      p_accessibility is null or cardinality(p_accessibility) = 0
      or s.accessibility @> p_accessibility
    )
    and (not coalesce(p_dog_friendly, false) or s.dog_friendly is true)
  order by
    case when p_sort = 'hot' then s.hot_score else s.score end desc,
    s.id
  limit least(greatest(p_limit, 1), 500)
$$;

revoke execute on function public.spots_in_viewport(
  double precision, double precision, double precision, double precision, integer, text, integer,
  text[], integer, text[], boolean
) from public;

grant execute on function public.spots_in_viewport(
  double precision, double precision, double precision, double precision, integer, text, integer,
  text[], integer, text[], boolean
) to anon, authenticated, service_role;
```

- [ ] **Step 4: Apply, then confirm there is exactly one overload**

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" && npx supabase db reset && npm run seed
docker exec supabase_db_photospots psql -U postgres -d postgres -c \
  "select oid::regprocedure from pg_proc where proname = 'spots_in_viewport';"
```

Expected: exactly one row, with eleven parameters. Two rows means the `drop` signature did not match and both versions are live — at which point PostgREST picks one and the filters appear to do nothing.

```bash
npm run test:db -- attribute-filtering
```

Expected: 9 passing.

- [ ] **Step 5: Decide about indexes by measuring, not by assuming**

Spec §4.7 says these columns are indexable "which is the entire purpose of these fields". That is an argument for the column shape, not proof that an index earns its keep today: the query is already gated by a highly selective GIST viewport intersection, and at six seeded rows Postgres will sequentially scan whatever you build.

Measure at a realistic size instead of guessing. Insert ~5000 synthetic spots spread across the Grand Rapids box with randomised attributes, then:

```sql
explain (analyze, buffers)
select * from public.spots_in_viewport(-85.75, 42.91, -85.59, 43.03, null, 'score', 200,
  array['free']::text[], 10, array['stroller']::text[], null);
```

Record the plan. **Add an index only if the planner actually uses it**, and write down what you measured either way — including "the viewport GIST index does all the work and the attribute predicates are cheap filters on an already-small row set", if that is what you find. An unused index is not free: it slows every write to `spots`, which now happens on every vote through the score refresh.

Delete the synthetic rows afterwards and confirm the count is back where it started.

- [ ] **Step 6: Thread the filters through the domain and data layers**

In `app/domain/filters/explore-filters.ts`, add `attributes: AttributeFilters` to `ExploreFilters` and `NO_ATTRIBUTE_FILTERS` to `DEFAULT_FILTERS`, then compose the two parsers:

```ts
  return {
    viewport: readViewport(params),
    zoom: /* unchanged */,
    shootTypeId: /* unchanged */,
    sort: /* unchanged */,
    view: /* unchanged */,
    attributes: parseAttributeFilters(params),
  };
```

and in `filtersToSearchParams`, merge the attribute params in and **always** write `view`:

```ts
  // Always written, not only when it differs from the default. Once a cookie
  // remembers the view, omitting `view=split` means clicking "split" produces a
  // URL with no view at all, the loader falls back to the remembered gallery,
  // and the click silently does nothing.
  params.set("view", filters.view);

  for (const [key, value] of attributeFiltersToParams(filters.attributes)) {
    params.set(key, value);
  }
```

Update `explore-filters.test.ts`'s "omits values that match the default" — it currently asserts the empty string for default filters and must now expect `view=split`. Change the assertion deliberately and note why in the test; do not delete the test.

In `app/data/spots.ts`, pass the new arguments:

```ts
  const { data, error } = await supabase.rpc("spots_in_viewport", {
    p_west: viewport.west,
    p_south: viewport.south,
    p_east: viewport.east,
    p_north: viewport.north,
    p_shoot_type_id: shootTypeId,
    p_sort: sort,
    p_limit: limit,
    p_cost_types: filters.attributes.costTypes,
    p_max_walk_minutes: filters.attributes.maxWalkMinutes,
    p_accessibility: filters.attributes.accessibility,
    p_dog_friendly: filters.attributes.dogFriendlyOnly ? true : null,
  });
```

Note `dogFriendlyOnly ? true : null` rather than passing the boolean straight through: `false` would otherwise read as "show me spots that are not dog friendly", which is not a filter anyone asked for.

- [ ] **Step 7: Run everything**

```bash
npm test && npm run typecheck
```

- [ ] **Step 8: Mutation-test the SQL**

| Mutation | Test that must go red |
| --- | --- |
| `s.accessibility @> p_accessibility` → `s.accessibility && p_accessibility` | "requires every accessibility value, not just one of them" |
| Drop `s.walk_minutes is not null and` | "excludes spots where the attribute is unknown" |
| `cardinality(p_cost_types) = 0` → remove that clause | "treats an empty filter array as no filter" |
| `not coalesce(p_dog_friendly, false) or s.dog_friendly is true` → `s.dog_friendly is not false` | "excludes spots where the attribute is unknown" |
| `p_max_walk_minutes` comparison `<=` → `<` | "filters by an upper bound on the walk" |

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260811000012_attribute_filters.sql app/domain/filters/ app/data/spots.ts tests/db/attribute-filtering.test.ts
git commit -m "$(cat <<'EOF'
feat: filter the viewport query by the practical attributes

The predicates live in the RPC because the query caps at 500 rows, and a filter
applied after the cap would drop matching spots as the map got busier — the
results would quietly get worse exactly when there was more to show.

Unknowns are excluded on purpose: a filter promising a short walk must not
return a spot whose walk time nobody recorded. Accessibility uses `@>` rather
than `&&` because those selections are requirements — with overlaps, asking for
wheelchair access and restrooms would match a spot with only restrooms.

`view` is now always written to the URL. Omitting it when it matched the
default was about to become a bug with no error: with a cookie remembering the
view, clicking "split" produced a URL with no view, the loader fell back to the
remembered one, and the click did nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The filter controls

**Files:**
- Create: `app/components/explore/FilterBar.tsx`, `app/components/explore/FilterBar.test.tsx`
- Modify: `app/routes/home.tsx`, `app/app.css`

- [ ] **Step 1: Write the failing test**

Create `app/components/explore/FilterBar.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { toggleValue, hiddenByFiltersMessage, activeFilterCount } from "./FilterBar";

describe("toggleValue", () => {
  it("adds a value that is not there", () => {
    expect(toggleValue(["free"], "park_pass")).toEqual(["free", "park_pass"]);
  });

  it("removes a value that is", () => {
    expect(toggleValue(["free", "park_pass"], "free")).toEqual(["park_pass"]);
  });

  it("does not mutate the array it was given", () => {
    const before = ["free"];
    toggleValue(before, "park_pass");
    expect(before).toEqual(["free"]);
  });
});

describe("activeFilterCount", () => {
  it("counts each selected value, so the badge matches what is on", () => {
    expect(
      activeFilterCount({
        costTypes: ["free", "park_pass"],
        maxWalkMinutes: 10,
        accessibility: ["shade"],
        dogFriendlyOnly: true,
      }),
    ).toBe(5);
  });

  it("is zero when nothing is filtered", () => {
    expect(
      activeFilterCount({
        costTypes: [],
        maxWalkMinutes: null,
        accessibility: [],
        dogFriendlyOnly: false,
      }),
    ).toBe(0);
  });

  it("counts a zero-minute walk", () => {
    expect(
      activeFilterCount({
        costTypes: [],
        maxWalkMinutes: 0,
        accessibility: [],
        dogFriendlyOnly: false,
      }),
    ).toBe(1);
  });
});

describe("hiddenByFiltersMessage", () => {
  // Cold start is the dominant risk (spec §14). "No spots match" and "nobody
  // has filled this in yet" look identical to a user and mean opposite things.
  it("says nothing when no spots were hidden", () => {
    expect(hiddenByFiltersMessage(0)).toBeNull();
  });

  it("explains a single hidden spot in the singular", () => {
    expect(hiddenByFiltersMessage(1)).toContain("1 spot");
    expect(hiddenByFiltersMessage(1)).not.toContain("1 spots");
  });

  it("explains several", () => {
    expect(hiddenByFiltersMessage(4)).toContain("4 spots");
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then write the component**

Create `app/components/explore/FilterBar.tsx`:

```tsx
import {
  ACCESSIBILITY_OPTIONS,
  COST_TYPE_OPTIONS,
} from "~/domain/spots/attributes";
import {
  NO_ATTRIBUTE_FILTERS,
  type AttributeFilters,
} from "~/domain/filters/attribute-filters";

export function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** Each selected value counts, so the badge matches the number of pills lit up. */
export function activeFilterCount(filters: AttributeFilters): number {
  return (
    filters.costTypes.length +
    filters.accessibility.length +
    (filters.maxWalkMinutes === null ? 0 : 1) +
    (filters.dogFriendlyOnly ? 1 : 0)
  );
}

/**
 * Spec §14: the map is thin, and "no spots match your filters" reads the same
 * as "nobody has filled this in yet" while meaning something entirely
 * different. Naming the number turns a dead end into a prompt to contribute.
 */
export function hiddenByFiltersMessage(hidden: number): string | null {
  if (hidden <= 0) return null;
  const spots = hidden === 1 ? "1 spot" : `${hidden} spots`;
  const verb = hidden === 1 ? "is" : "are";
  return `${spots} in view ${verb} hidden because nobody has filled in the detail you filtered on.`;
}

/** Any is null rather than a large number, so it reads as "no filter" downstream. */
const WALK_CHOICES: readonly { value: number | null; label: string }[] = [
  { value: null, label: "Any walk" },
  { value: 5, label: "Under 5 min" },
  { value: 10, label: "Under 10 min" },
  { value: 20, label: "Under 20 min" },
];

export function FilterBar({
  filters,
  onChange,
}: {
  filters: AttributeFilters;
  onChange: (next: AttributeFilters) => void;
}) {
  const count = activeFilterCount(filters);

  return (
    <div className="filter-bar">
      <div className="filter-bar__group" role="group" aria-label="Cost">
        {COST_TYPE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={filters.costTypes.includes(o.value)}
            onClick={() => onChange({ ...filters, costTypes: toggleValue(filters.costTypes, o.value) })}
          >
            {o.label}
          </button>
        ))}
      </div>

      <label className="filter-bar__walk">
        Walk from parking
        <select
          value={filters.maxWalkMinutes === null ? "" : String(filters.maxWalkMinutes)}
          onChange={(e) =>
            onChange({
              ...filters,
              maxWalkMinutes: e.currentTarget.value === "" ? null : Number(e.currentTarget.value),
            })
          }
        >
          {WALK_CHOICES.map((c) => (
            <option key={c.label} value={c.value === null ? "" : String(c.value)}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <div className="filter-bar__group" role="group" aria-label="Getting around">
        {ACCESSIBILITY_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={filters.accessibility.includes(o.value)}
            onClick={() =>
              onChange({ ...filters, accessibility: toggleValue(filters.accessibility, o.value) })
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-pressed={filters.dogFriendlyOnly}
        onClick={() => onChange({ ...filters, dogFriendlyOnly: !filters.dogFriendlyOnly })}
      >
        Dogs welcome
      </button>

      {count > 0 && (
        <button type="button" onClick={() => onChange(NO_ATTRIBUTE_FILTERS)}>
          Clear {count} {count === 1 ? "filter" : "filters"}
        </button>
      )}
    </div>
  );
}
```

Every control is uncontrolled-by-URL on purpose: `onChange` hands the whole next filter object up to `home.tsx`, which writes it to the URL, and the value comes back down through the loader. One direction, so a control cannot disagree with the address bar.

- [ ] **Step 3: Supply the hidden count**

The loader knows how many spots are in the viewport unfiltered and how many survive the filters. Rather than a second full query, run the count query only when `hasAnyAttributeFilter(filters.attributes)` is true:

```ts
  const unfilteredCount = hasAnyAttributeFilter(filters.attributes)
    ? (await listSpotsInViewport(supabase, { ...snapped, attributes: NO_ATTRIBUTE_FILTERS }, 500)).length
    : spots.length;
```

Note the `500`: the cap makes this an undercount on a busy viewport, which is acceptable for a hint but must not be presented as an exact figure. Word the message accordingly and say so in a comment.

- [ ] **Step 4: Wire into `home.tsx`, style, and verify in the browser**

Add `<FilterBar …/>` to the controls. Confirm by hand: filtering to *free* + *stroller* narrows the seeded map, the URL carries `cost=free&access=stroller`, reloading that URL reproduces the same view, and clearing restores everything.

- [ ] **Step 5: Commit**

```bash
git add app/components/explore/FilterBar.tsx app/components/explore/FilterBar.test.tsx app/routes/home.tsx app/app.css
git commit -m "$(cat <<'EOF'
feat: add the attribute filter controls

Filters exclude spots where the attribute is unknown, which is correct and also
brutal on a map this young — so the results panel says how many spots were
hidden for lacking the data. "No spots match" and "nobody has filled this in
yet" look identical to a user and mean opposite things, and spec §14 names cold
start as the dominant risk.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Remember the chosen view

**Files:**
- Create: `app/lib/view-preference.server.ts`, `app/lib/view-preference.server.test.ts`
- Modify: `app/routes/home.tsx`

Spec §8: the view is "selected by a `?view=` parameter and remembered per user".

- [ ] **Step 1: Write the failing test**

Create `app/lib/view-preference.server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveView, viewPreferenceCookie } from "./view-preference.server";

describe("resolveView", () => {
  // The URL is what a shared link carries, so it has to win — otherwise
  // opening a friend's gallery link shows your own remembered split view.
  it("prefers the URL over the cookie", () => {
    expect(resolveView("gallery", "map")).toBe("gallery");
  });

  it("falls back to the cookie when the URL says nothing", () => {
    expect(resolveView(null, "map")).toBe("map");
  });

  it("falls back to split when neither says anything", () => {
    expect(resolveView(null, null)).toBe("split");
  });

  it("ignores a nonsense cookie rather than trusting stored input", () => {
    expect(resolveView(null, "hologram")).toBe("split");
  });

  it("ignores a nonsense URL value", () => {
    expect(resolveView("hologram", "map")).toBe("map");
  });
});

describe("viewPreferenceCookie", () => {
  it("round-trips a view through serialise and parse", async () => {
    const header = await viewPreferenceCookie.serialize("gallery");
    expect(await viewPreferenceCookie.parse(header)).toBe("gallery");
  });

  // A preference, not a credential — but it still has no business being sent
  // to third parties or read by scripts.
  it("is httpOnly, sameSite lax, and long-lived", async () => {
    const header = await viewPreferenceCookie.serialize("map");
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Max-Age=\d{7,}/);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then implement**

Create `app/lib/view-preference.server.ts`:

```ts
import { createCookie } from "react-router";
import type { ExploreView } from "~/domain/filters/explore-filters";

const VIEWS: readonly string[] = ["split", "map", "gallery"];

export const viewPreferenceCookie = createCookie("photospots_view", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  // A year. The preference is not sensitive and re-choosing it every session
  // is exactly the friction spec §8's "remembered per user" is avoiding.
  maxAge: 60 * 60 * 24 * 365,
});

/**
 * The URL wins over the cookie, always.
 *
 * A view in the URL is what a shared link carries, and spec §8 makes every view
 * a shareable link on purpose. If the cookie won, opening a friend's gallery
 * link would show your own remembered split view and the link would look broken.
 *
 * The cookie is stored input and is validated exactly like the URL is: a value
 * that is not a known view is ignored rather than trusted.
 */
export function resolveView(fromUrl: string | null, fromCookie: string | null): ExploreView {
  if (fromUrl !== null && VIEWS.includes(fromUrl)) return fromUrl as ExploreView;
  if (fromCookie !== null && VIEWS.includes(fromCookie)) return fromCookie as ExploreView;
  return "split";
}
```

- [ ] **Step 3: Wire the loader**

In `home.tsx`, read the raw `view` param before `parseExploreFilters` normalises it, resolve it against the cookie, and set the cookie when the URL supplied one:

```ts
  const rawView = url.searchParams.get("view");
  const remembered = await viewPreferenceCookie.parse(request.headers.get("Cookie"));
  const view = resolveView(rawView, typeof remembered === "string" ? remembered : null);
  const filters = { ...parseExploreFilters(url.searchParams), view };

  if (rawView !== null && rawView === view) {
    headers.append("Set-Cookie", await viewPreferenceCookie.serialize(view));
  }
```

`headers` is the object `createSupabaseServerClient` already returned — append to it rather than building a second one, or the Supabase session cookies are dropped and the user is silently signed out on the next request.

- [ ] **Step 4: Verify by hand**

Choose gallery, close the tab, reopen `/` with no query string, and confirm gallery renders **server-side** — view source and check the markup, rather than trusting the rendered page, since a client-side correction would look identical while producing a flash of the wrong layout.

Then open `/?view=split` and confirm split wins, and that clicking between views still works — that is the bug the always-write-`view` change in task 5 exists to prevent, so confirm it directly.

- [ ] **Step 5: Commit**

```bash
git add app/lib/view-preference.server.ts app/lib/view-preference.server.test.ts app/routes/home.tsx
git commit -m "$(cat <<'EOF'
feat: remember the chosen explore view

Spec §8 asks for the view to be remembered per user. The URL still wins over
the cookie: every view is a shareable link by design, and if the cookie won,
opening a friend's gallery link would show your own remembered split view.

Resolved during the loader so the server renders the right arrangement, rather
than correcting it on the client and flashing the wrong layout first. The
cookie is stored input and is validated exactly like the URL is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: The gallery map tab and the mobile results sheet

**Files:**
- Create: `app/domain/explore/results-sheet.ts`, `app/domain/explore/results-sheet.test.ts`
- Create: `app/components/explore/ResultsSheet.tsx`
- Modify: `app/components/explore/ExploreLayout.tsx`, `app/components/explore/ExploreLayout.test.tsx`, `app/app.css`

Spec §8: gallery is "a photo grid with the map behind a tab", and on mobile all three views "collapse to a full-screen map with a draggable results sheet".

- [ ] **Step 1: Write the failing sheet test**

Create `app/domain/explore/results-sheet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextSnap, SNAP_HEIGHTS, type SheetSnap } from "./results-sheet";

describe("nextSnap", () => {
  it("stays put when the drag goes nowhere", () => {
    expect(nextSnap("half", 0, 0)).toBe("half");
  });

  it("opens further on a small upward drag", () => {
    expect(nextSnap("peek", -120, 0)).toBe("half");
  });

  it("closes on a small downward drag", () => {
    expect(nextSnap("half", 120, 0)).toBe("peek");
  });

  // A flick is an intent, not a measurement. Without this, a fast short swipe
  // springs back and the sheet feels stuck to the thumb. It moves one step,
  // like a drag does — jumping straight to full would overshoot the stop most
  // people actually want.
  it("lets a fast flick win over a short distance", () => {
    expect(nextSnap("peek", -20, -2.5)).toBe("half");
    expect(nextSnap("full", 20, 2.5)).toBe("half");
  });

  // A drag has to fully cross a step. Rounding instead of truncating would
  // turn a 60px wobble into a committed move.
  it("returns to where it started when the drag is under one step", () => {
    expect(nextSnap("half", -60, 0)).toBe("half");
    expect(nextSnap("half", 60, 0)).toBe("half");
  });

  it("cannot go past the ends", () => {
    expect(nextSnap("full", -400, -3)).toBe("full");
    expect(nextSnap("peek", 400, 3)).toBe("peek");
  });

  it("crosses two stops on a long drag", () => {
    expect(nextSnap("peek", -400, 0)).toBe("full");
  });

  it("has a height for every snap point", () => {
    for (const snap of ["peek", "half", "full"] as SheetSnap[]) {
      expect(SNAP_HEIGHTS[snap]).toMatch(/^\d+(vh|%)$/);
    }
  });
});
```

- [ ] **Step 2: Implement, run, and mutation-test**

Create `app/domain/explore/results-sheet.ts`:

```ts
export type SheetSnap = "peek" | "half" | "full";

/** Ordered closed → open, so a step is an index change. */
const ORDER: readonly SheetSnap[] = ["peek", "half", "full"];

export const SNAP_HEIGHTS: Record<SheetSnap, string> = Object.freeze({
  peek: "18vh",
  half: "50vh",
  full: "88vh",
});

/** Below this, a drag is a wobble rather than an intent. */
const STEP_PIXELS = 100;
/** px/ms. A flick past this wins regardless of how far it travelled. */
const FLICK_VELOCITY = 1.2;

const clampIndex = (i: number) => Math.min(ORDER.length - 1, Math.max(0, i));

/**
 * Where a drag lands.
 *
 * `deltaY` and `velocityY` follow screen coordinates: negative is upward, which
 * opens the sheet. Velocity is checked before distance because a flick is an
 * intent, not a measurement — without it a fast short swipe springs back and
 * the sheet feels stuck to the thumb.
 */
export function nextSnap(current: SheetSnap, deltaY: number, velocityY: number): SheetSnap {
  const index = ORDER.indexOf(current);

  if (velocityY <= -FLICK_VELOCITY) return ORDER[clampIndex(index + 1)];
  if (velocityY >= FLICK_VELOCITY) return ORDER[clampIndex(index - 1)];

  // Truncated, not rounded: a drag has to fully cross a step to count, so
  // releasing mid-way returns to where it started rather than jumping ahead.
  const steps = Math.trunc(-deltaY / STEP_PIXELS);
  return ORDER[clampIndex(index + steps)];
}
```

Run `npm run test:unit -- results-sheet`; expected 8 passing. Then mutate:

| Mutation | Test that must go red |
| --- | --- |
| Delete both `velocityY` branches | "lets a fast flick win over a short distance" |
| `clampIndex` → `(i) => i` | "cannot go past the ends" |
| `Math.trunc(-deltaY / STEP_PIXELS)` → `Math.sign(-deltaY)` | "crosses two stops on a long drag" |
| `Math.trunc` → `Math.round` | "returns to where it started when the drag is under one step" |

- [ ] **Step 3: Add the gallery map tab**

In `ExploreLayout`, gallery currently omits the map entirely. Give it a tab pair — *Photos* and *Map* — with `aria-pressed` on the active one, rendering the grid or the map. Extend `ExploreLayout.test.tsx`'s existing `layoutClass` coverage with the tab state, keeping to exported pure helpers since the unit project has no DOM.

- [ ] **Step 4: Add the mobile sheet**

Below 768px, all three views render the map full-screen with `ResultsSheet` over it. The view pills are hidden below that width — spec §8 makes the view choice desktop-only.

Create `app/components/explore/ResultsSheet.tsx`:

```tsx
import { useRef, useState, type ReactNode, type PointerEvent } from "react";
import { nextSnap, SNAP_HEIGHTS, type SheetSnap } from "~/domain/explore/results-sheet";

/**
 * A draggable sheet over the full-screen map (spec §8, mobile).
 *
 * Pointer events rather than touch events: they cover mouse, touch and pen from
 * one code path, and they make the sheet draggable with a mouse, which is the
 * only way it can be exercised in the desktop preview.
 *
 * All the rules live in `nextSnap`. This component only measures.
 */
export function ResultsSheet({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const drag = useRef<{ y: number; t: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Capture, so a fast drag that leaves the handle still delivers its
    // pointerup here rather than stranding the sheet mid-gesture.
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, t: e.timeStamp };
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start) return;

    const deltaY = e.clientY - start.y;
    const elapsed = e.timeStamp - start.t;
    // Guard the divide: a tap can register zero elapsed milliseconds, and
    // Infinity would read as a flick in whichever direction the noise went.
    const velocityY = elapsed > 0 ? deltaY / elapsed : 0;

    setSnap(nextSnap(snap, deltaY, velocityY));
  };

  return (
    <div className="results-sheet" style={{ height: SNAP_HEIGHTS[snap] }} data-snap={snap}>
      <div
        className="results-sheet__handle"
        role="slider"
        aria-label="Results"
        aria-valuetext={snap}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />
      <div className="results-sheet__body">{children}</div>
    </div>
  );
}
```

In `app.css`, `touch-action: none` goes on `.results-sheet__handle` **only**. On `.results-sheet__body` it stops the results scrolling, which is the entire point of dragging the sheet open:

```css
@media (max-width: 767px) {
  .results-sheet {
    position: fixed; left: 0; right: 0; bottom: 0;
    display: flex; flex-direction: column;
    border-radius: 12px 12px 0 0;
    background: canvas;
    box-shadow: 0 -2px 16px rgb(0 0 0 / 0.25);
    transition: height 180ms ease-out;
  }
  .results-sheet__handle {
    touch-action: none;
    cursor: grab;
    padding: 0.6rem 0;
    flex: 0 0 auto;
  }
  .results-sheet__handle::before {
    content: ""; display: block; width: 2.5rem; height: 4px; margin: 0 auto;
    border-radius: 999px; background: currentColor; opacity: 0.35;
  }
  .results-sheet__body { overflow-y: auto; flex: 1 1 auto; }
  .explore__views { display: none; }
}
```

`height` is transitioned rather than `transform` because the body's scroll height has to match the visible height — transforming would leave the list scrollable behind the screen edge.

- [ ] **Step 5: Verify at both sizes**

Resize the preview to mobile (375×812) and confirm: the map fills the screen, the sheet drags between the three snap points, a flick works, the results scroll inside the sheet at full height, and the view pills are gone. Then desktop, and confirm all three views are unchanged from before this task. Take a screenshot of each.

- [ ] **Step 6: Commit**

```bash
git add app/domain/explore/ app/components/explore/ app/app.css
git commit -m "$(cat <<'EOF'
feat: add the gallery map tab and the mobile results sheet

Completes the three arrangements spec §8 describes. The snap logic is a pure
function over a delta and a velocity, so the part with actual rules is tested
without a browser: a fast flick has to beat a short distance, or the sheet
springs back and feels stuck.

touch-action: none goes on the drag handle only. On the sheet body it stops the
results scrolling, which is the whole point of dragging it open.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Verify end to end, then sync the docs

**Files:**
- Modify: `docs/STATUS.md`, `README.md`, this plan
- Possibly modify: `docs/ENGINEERING-NOTES.md`

- [ ] **Step 1: Full suite, typecheck, build**

```bash
npm test && npm run typecheck && npm run build
```

Record the test count.

- [ ] **Step 2: Replay every migration from empty**

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" && npx supabase db reset && npm run seed && npm run test:db
```

This is the check that the vocabulary constraints and the two dropped-and-recreated functions survive a clean replay. A migration that only works against an already-migrated database is a migration that will fail on the hosted project.

- [ ] **Step 3: Confirm no function has a stray overload**

```bash
docker exec supabase_db_photospots psql -U postgres -d postgres -c \
  "select proname, count(*) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' group by 1 having count(*) > 1;"
```

Expected: no rows. Any function listed twice is an overload PostgREST may resolve either way.

- [ ] **Step 4: Drive the whole flow in the browser**

Sign in, edit a seeded spot to add a cost and two accessibility values, then from the map: filter to those values and confirm the spot is found; add a filter nothing matches and confirm the hidden-spots message appears rather than a bare empty state; copy the URL, open it in a fresh tab, and confirm the same filtered view renders. Submit a new spot with attributes and confirm it is immediately findable by them.

- [ ] **Step 5: Update `docs/STATUS.md`**

Move milestone 5 to ✅ and mark 6 as Next. Update the test count, the migration count and the `app/` inventory. Add to "Known gaps": whatever the index measurement in task 5 concluded, and the fact that the hidden-spots count is capped at 500 and so undercounts on a busy viewport. Remove the note about attribute filters being unbuilt.

- [ ] **Step 6: Update `README.md`** in the same voice as the existing entries.

- [ ] **Step 7: Sync this plan** — tick every checkbox, and add a "What diverged" table naming each place the implementation differed from the plan and why, as plan 4 does. Where the divergence came from a defect in this plan's own text, say so.

- [ ] **Step 8: Add any new trap to `docs/ENGINEERING-NOTES.md`** — only if this plan hit a real one. The overload trap in tasks 3 and 5 is the likeliest candidate, and only if it actually bit. Do not add anything merely anticipated; every entry in that file is a bug that shipped or nearly shipped, and padding it with hypotheticals is how it stops being read.

- [ ] **Step 9: Commit**

```bash
git add docs/ README.md
git commit -m "$(cat <<'EOF'
docs: record the filters and views milestone

Plan 5 ticked off against what was actually built, with the divergences named.
STATUS moves to milestone 6.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

Checked against spec §13 milestone 5 ("Filters and remaining views — shoot-type and attribute filters, URL state, map and gallery views"):

| Requirement | Where |
| --- | --- |
| Shoot-type filter | Already built (plan 2); untouched here |
| Attribute filters | Tasks 1, 4, 5, 6 — and tasks 2 and 3, without which there is nothing to filter |
| URL state | Task 5 (`view` always written), task 4 (attribute params) |
| Map view | Already built; task 8 adds the mobile arrangement |
| Gallery view | Already built; task 8 adds the map tab spec §8 describes |
| View remembered per user | Task 7 |

Deliberately **not** in this plan, and why:

- **Server-side clustering at low zoom.** Spec §10 asks for it and the 500-row cap makes it eventually necessary, but at six spots it is unmeasurable. It needs a real corpus to design against, and the cold-start work in spec §14 comes first.
- **`terrain`, `max_group_size`, `best_light`, `best_seasons` as filters.** The columns and the vocabulary are built, so adding one is a domain constant, one RPC predicate and one control. Waiting for evidence that anyone narrows by them, per spec §4.7.
- **Filtering by studio vs outdoor.** `kind` is already a column and would be a one-line predicate, but spec §8 treats studios as a surface of their own (§9.3, milestone 6) rather than a filter chip.
