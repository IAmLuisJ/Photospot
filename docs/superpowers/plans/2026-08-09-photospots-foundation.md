# Photospots Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Photospots project skeleton — React Router v7 app, Supabase database with the full schema and enforced row-level security, working authentication, and the pure domain modules for scoring and geography.

**Architecture:** Four layers, per spec §5. Routes are thin (loaders call queries, actions call commands). The `app/domain/` layer is pure functions with no I/O — that is where scoring weights and geographic math live, and it is unit-tested without a database. The `app/data/` layer wraps Supabase and never leaks Supabase types upward. Postgres triggers maintain dumb counters; weighted scores are computed in TypeScript.

**Tech Stack:** React Router v7 (framework mode) · TypeScript · Vitest · Supabase (Postgres 15 + PostGIS, Auth, Storage, RLS) · Supabase CLI for local development

**Plan sequence:** This is plan 1 of 6. Plans 2–6 cover read-only explore, contribution, signals, filters and views, and trust (spec §13).

**Spec:** `docs/superpowers/specs/2026-08-09-photospots-design.md`

**Commit convention:** Every commit message in this plan should end with the trailer:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## File Structure

Created by this plan:

| File | Responsibility |
| --- | --- |
| `app/root.tsx` | HTML document shell |
| `app/routes.ts` | Route table |
| `app/routes/home.tsx` | Placeholder explore route (fleshed out in plan 2) |
| `app/routes/auth.login.tsx` | Sign-in page: Google button + magic link form |
| `app/routes/auth.callback.tsx` | OAuth / magic link code exchange |
| `app/routes/auth.logout.tsx` | Sign-out action |
| `app/domain/scoring/weights.ts` | Score weight configuration |
| `app/domain/scoring/score.ts` | `computeScore` — counters to weighted score |
| `app/domain/scoring/hot.ts` | `computeHotScore` — time-decayed activity |
| `app/domain/geo/bounds.ts` | Viewport bounds, grid snapping |
| `app/domain/geo/distance.ts` | Haversine distance, duplicate proximity |
| `app/lib/supabase.server.ts` | Per-request Supabase server client with cookie session |
| `app/lib/env.server.ts` | Validated environment variables |
| `app/data/profiles.ts` | Profile queries |
| `supabase/migrations/*.sql` | Schema, triggers, RLS |
| `scripts/backfill-scores.ts` | Recompute all spot scores after a weight change |
| `tests/db/helpers.ts` | Test clients (service role, anon, authenticated user) |

Domain modules are split by concern rather than lumped into one `utils` file, because each is independently testable and they change for different reasons.

---

## Task 1: Project scaffold and test infrastructure

**Files:**
- Create: whole project skeleton via generator
- Create: `vitest.config.ts`
- Create: `app/domain/scoring/weights.ts`
- Test: `app/domain/scoring/weights.test.ts`

- [ ] **Step 1: Scaffold the React Router app**

Run in the repository root:

```bash
npx create-react-router@latest . --template remix-run/react-router-templates/default --no-git-init --install
```

If the generator refuses because the directory is not empty, scaffold into a temp directory and move the files in:

```bash
npx create-react-router@latest /tmp/ps-scaffold --template remix-run/react-router-templates/default --no-git-init --no-install && cp -R /tmp/ps-scaffold/. . && rm -rf /tmp/ps-scaffold && npm install
```

- [ ] **Step 2: Verify the dev server boots**

Run: `npm run dev`
Expected: server starts and prints a `http://localhost:5173` URL. Stop it with Ctrl-C.

- [ ] **Step 3: Install test and runtime dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr zod
npm install -D vitest @vitest/coverage-v8 supabase tsx
```

- [ ] **Step 4: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Deliberately no passWithNoTests here. On the root config it applies to
    // the whole run, so a broken glob would exit 0 with nothing executed.
    // `tests/db/` doesn't exist until task 6, and Vitest ignores the flag when
    // set per-project, so the `test:db` script passes it on the command line
    // instead — per-invocation, and it can't leak into `npm test`.
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "unit",
          environment: "node",
          include: ["app/**/*.test.{ts,tsx}"],
          globals: false,
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          globals: false,
          // These tests all hit one shared Postgres instance (e.g. task 15's
          // backfill rewrites spots.score across every row) so they must not
          // run as concurrent files.
          fileParallelism: false,
        },
      },
    ],
  },
});
```

Three things here are deliberate and were added during Task 1's code review:

- **`resolve: { tsconfigPaths: true }` on each project.** Vitest loads `vitest.config.ts`
  *instead of* `vite.config.ts`, so the `~/*` alias from `tsconfig.json` does not resolve in tests
  unless this config asks for it. Without it, `tsc` and `npm run build` stay green while `npm test`
  fails at import — and tasks 12–14 import `~/lib/supabase.server`.
- **Separate `unit` and `db` projects.** Otherwise `npm test` requires a running Supabase stack from
  task 6 onward, which defeats the purpose of a pure `app/domain/` layer.
- **`.tsx` in the unit glob.** Plan 2 adds React components; `*.test.ts` alone would silently
  *not collect* a `.tsx` test rather than fail.

Also add `coverage/` to `.gitignore` in this task — `test:coverage` writes it, and step 9 commits
with `git add -A`.

Add to `package.json` `"scripts"`:

```json
"test": "vitest run",
"test:unit": "vitest run --project unit",
"test:db": "vitest run --project db --passWithNoTests",
"test:coverage": "vitest run --coverage",
"test:watch": "vitest"
```

Add to `package.json` alongside `"scripts"`:

```json
"engines": { "node": ">=20" }
```

- [ ] **Step 5: Write the failing test**

Create `app/domain/scoring/weights.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_WEIGHTS } from "./weights";

describe("DEFAULT_WEIGHTS", () => {
  it("matches the weights agreed in the spec", () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      shootTypeUpvote: 1.0,
      shootAgainYes: 2.0,
      shootAgainNo: -1.5,
      comment: 0.5,
      scoutingPhoto: 1.0,
      sessionPhoto: 1.5,
    });
  });

  it("never rewards a shoot-again no more than a yes", () => {
    expect(DEFAULT_WEIGHTS.shootAgainNo).toBeLessThan(DEFAULT_WEIGHTS.shootAgainYes);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run app/domain/scoring/weights.test.ts`
Expected: FAIL — `Failed to resolve import "./weights"`

- [ ] **Step 7: Write the minimal implementation**

Create `app/domain/scoring/weights.ts`:

```ts
/**
 * Weights are configuration, not truth. Changing them requires running
 * scripts/backfill-scores.ts to recompute every stored spot score.
 */
export interface ScoreWeights {
  readonly shootTypeUpvote: number;
  readonly shootAgainYes: number;
  readonly shootAgainNo: number;
  readonly comment: number;
  readonly scoutingPhoto: number;
  readonly sessionPhoto: number;
}

// Frozen because `export const` freezes the binding, not the object. This
// object is the default argument of both computeScore (task 2) and
// backfillScores (task 15), and task 15 writes the result to the database —
// one stray mutation would silently re-weight every score after it.
export const DEFAULT_WEIGHTS: ScoreWeights = Object.freeze({
  shootTypeUpvote: 1.0,
  shootAgainYes: 2.0,
  shootAgainNo: -1.5,
  comment: 0.5,
  scoutingPhoto: 1.0,
  sessionPhoto: 1.5,
});
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run app/domain/scoring/weights.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold React Router app with Vitest and score weights"
```

---

## Task 2: Score computation

**Files:**
- Create: `app/domain/scoring/score.ts`
- Test: `app/domain/scoring/score.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/domain/scoring/score.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeScore, ZERO_COUNTERS, type SpotCounters } from "./score";
import { DEFAULT_WEIGHTS } from "./weights";

const counters = (overrides: Partial<SpotCounters> = {}): SpotCounters => ({
  ...ZERO_COUNTERS,
  ...overrides,
});

describe("computeScore", () => {
  it("is zero for a spot with no activity", () => {
    expect(computeScore(ZERO_COUNTERS)).toBe(0);
  });

  it("sums each signal type by its weight", () => {
    const result = computeScore(
      counters({
        shootTypeUpvoteCount: 3,
        shootAgainYesCount: 2,
        commentCount: 4,
        scoutingPhotoCount: 2,
        sessionPhotoCount: 1,
      }),
    );
    // 3(1.0) + 2(2.0) + 4(0.5) + 2(1.0) + 1(1.5) = 12.5
    expect(result).toBe(12.5);
  });

  it("subtracts shoot-again no votes", () => {
    const result = computeScore(counters({ shootAgainYesCount: 2, shootAgainNoCount: 2 }));
    // 2(2.0) + 2(-1.5) = 1
    expect(result).toBe(1);
  });

  it("can go negative when a spot is widely rejected", () => {
    expect(computeScore(counters({ shootAgainNoCount: 4 }))).toBe(-6);
  });

  it("accepts alternative weights so ranking can be tuned without a migration", () => {
    const result = computeScore(counters({ shootTypeUpvoteCount: 3 }), {
      ...DEFAULT_WEIGHTS,
      shootTypeUpvote: 10,
    });
    expect(result).toBe(30);
  });

  it("rounds to three decimals to keep stored values stable", () => {
    // 0.1236 rounds UP to 0.124. A truncating implementation would give 0.123,
    // so this value distinguishes rounding from truncation; 0.1234567 would not.
    const result = computeScore(counters({ commentCount: 1 }), {
      ...DEFAULT_WEIGHTS,
      comment: 0.1236,
    });
    expect(result).toBe(0.124);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/domain/scoring/score.test.ts`
Expected: FAIL — `Failed to resolve import "./score"`

- [ ] **Step 3: Write the minimal implementation**

Create `app/domain/scoring/score.ts`:

```ts
import { DEFAULT_WEIGHTS, type ScoreWeights } from "./weights";

/** Mirrors the trigger-maintained counter columns on `spots`. */
export interface SpotCounters {
  readonly shootTypeUpvoteCount: number;
  readonly shootAgainYesCount: number;
  readonly shootAgainNoCount: number;
  readonly commentCount: number;
  readonly scoutingPhotoCount: number;
  readonly sessionPhotoCount: number;
}

// Frozen because `{ ...ZERO_COUNTERS, ...overrides }` is the idiom for building
// a counter set, so a mutation here would propagate into every set built after it.
export const ZERO_COUNTERS: SpotCounters = Object.freeze({
  shootTypeUpvoteCount: 0,
  shootAgainYesCount: 0,
  shootAgainNoCount: 0,
  commentCount: 0,
  scoutingPhotoCount: 0,
  sessionPhotoCount: 0,
});

export function computeScore(
  counters: SpotCounters,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  const total =
    counters.shootTypeUpvoteCount * weights.shootTypeUpvote +
    counters.shootAgainYesCount * weights.shootAgainYes +
    counters.shootAgainNoCount * weights.shootAgainNo +
    counters.commentCount * weights.comment +
    counters.scoutingPhotoCount * weights.scoutingPhoto +
    counters.sessionPhotoCount * weights.sessionPhoto;

  return Math.round(total * 1000) / 1000;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/domain/scoring/score.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add app/domain/scoring/score.ts app/domain/scoring/score.test.ts
git commit -m "feat: compute weighted spot score from counters"
```

---

## Task 3: Hot score with time decay

**Files:**
- Create: `app/domain/scoring/hot.ts`
- Test: `app/domain/scoring/hot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/domain/scoring/hot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeHotScore,
  HOT_HALF_LIFE_DAYS,
  HOT_WINDOW_DAYS,
  type ActivityEvent,
} from "./hot";

const NOW = new Date("2026-08-09T12:00:00Z");

const daysAgo = (days: number): Date =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const event = (weight: number, days: number): ActivityEvent => ({
  weight,
  occurredAt: daysAgo(days),
});

describe("computeHotScore", () => {
  it("is zero with no activity", () => {
    expect(computeHotScore([], NOW)).toBe(0);
  });

  it("counts activity from right now at full weight", () => {
    expect(computeHotScore([event(4, 0)], NOW)).toBe(4);
  });

  it("halves an event's contribution after one half-life", () => {
    expect(computeHotScore([event(4, HOT_HALF_LIFE_DAYS)], NOW)).toBe(2);
  });

  it("quarters an event's contribution after two half-lives", () => {
    expect(computeHotScore([event(4, HOT_HALF_LIFE_DAYS * 2)], NOW)).toBe(1);
  });

  it("ignores events older than the trailing window", () => {
    expect(computeHotScore([event(100, HOT_WINDOW_DAYS + 1)], NOW)).toBe(0);
  });

  it("lets recent activity outrank a larger but older pile", () => {
    const fresh = computeHotScore([event(3, 0)], NOW);
    const stale = computeHotScore([event(8, HOT_HALF_LIFE_DAYS * 3)], NOW);
    expect(fresh).toBeGreaterThan(stale);
  });

  it("sums multiple events", () => {
    const result = computeHotScore(
      [event(2, 0), event(2, HOT_HALF_LIFE_DAYS)],
      NOW,
    );
    expect(result).toBe(3);
  });

  // Without this, step decay passes: every other test samples an exact multiple
  // of the half-life, where a staircase and a smooth curve agree. Verified by
  // mutation — floor/ceil/round variants of the exponent all survive the rest
  // of this suite and are caught only here.
  it("decays continuously between half-lives, not in steps", () => {
    // Half a half-life: 4 * 0.5^0.5 = 2.828..., not 4 (step) and not 3 (linear).
    expect(computeHotScore([event(4, HOT_HALF_LIFE_DAYS / 2)], NOW)).toBe(2.828);
  });

  it("treats future timestamps as now rather than amplifying them", () => {
    const future: ActivityEvent = { weight: 5, occurredAt: daysAgo(-10) };
    expect(computeHotScore([future], NOW)).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/domain/scoring/hot.test.ts`
Expected: FAIL — `Failed to resolve import "./hot"`

- [ ] **Step 3: Write the minimal implementation**

Create `app/domain/scoring/hot.ts`:

```ts
/** Spec §7: hot decays on a 14-day half-life over a trailing 90-day window. */
export const HOT_HALF_LIFE_DAYS = 14;

/**
 * The window bounds the event scan; decay alone would not.
 *
 * At 90 days an event still contributes 0.5^(90/14) ≈ 1.2% of its weight, so
 * this cutoff is not about arithmetic — it is about I/O. Unlike computeScore,
 * which reads six precomputed counters, this function needs the individual
 * events, gathered by scanning signals/comments/photos by created_at. The
 * window is what keeps that query bounded and indexable as the site ages, and
 * the same cutoff has to hold here so the function agrees with the query that
 * feeds it. Don't remove it on the grounds that decay makes it redundant.
 */
export const HOT_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ActivityEvent {
  /** Same weights as the lifetime score — see DEFAULT_WEIGHTS. */
  weight: number;
  occurredAt: Date;
}

export function computeHotScore(
  events: readonly ActivityEvent[],
  now: Date,
  halfLifeDays: number = HOT_HALF_LIFE_DAYS,
  windowDays: number = HOT_WINDOW_DAYS,
): number {
  let total = 0;

  for (const { weight, occurredAt } of events) {
    // Clock skew must not let an event count for more than its face value.
    const ageDays = Math.max(0, (now.getTime() - occurredAt.getTime()) / MS_PER_DAY);
    if (ageDays > windowDays) continue;
    total += weight * Math.pow(0.5, ageDays / halfLifeDays);
  }

  return Math.round(total * 1000) / 1000;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/domain/scoring/hot.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add app/domain/scoring/hot.ts app/domain/scoring/hot.test.ts
git commit -m "feat: compute time-decayed hot score"
```

---

## Task 4: Geographic distance and duplicate detection

**Files:**
- Create: `app/domain/geo/distance.ts`
- Test: `app/domain/geo/distance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/domain/geo/distance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  isWithinRadius,
  DUPLICATE_RADIUS_METERS,
  type LatLng,
} from "./distance";

// Two real Grand Rapids landmarks, roughly 5 km apart.
const MILLENNIUM_PARK: LatLng = { lat: 42.9214, lng: -85.7267 };
const JOHN_BALL_PARK: LatLng = { lat: 42.9631, lng: -85.7011 };

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters(MILLENNIUM_PARK, MILLENNIUM_PARK)).toBe(0);
  });

  it("is symmetric", () => {
    const a = haversineMeters(MILLENNIUM_PARK, JOHN_BALL_PARK);
    const b = haversineMeters(JOHN_BALL_PARK, MILLENNIUM_PARK);
    expect(a).toBeCloseTo(b, 6);
  });

  it("measures one degree of latitude as about 111 km", () => {
    const result = haversineMeters({ lat: 42, lng: -85 }, { lat: 43, lng: -85 });
    expect(result).toBeGreaterThan(110_000);
    expect(result).toBeLessThan(112_000);
  });

  it("measures a known short distance within tolerance", () => {
    const result = haversineMeters(MILLENNIUM_PARK, JOHN_BALL_PARK);
    expect(result).toBeGreaterThan(4_000);
    expect(result).toBeLessThan(6_000);
  });
});

describe("isWithinRadius", () => {
  const base: LatLng = { lat: 42.9214, lng: -85.7267 };
  // ~100 m north of base: 0.0009 degrees of latitude.
  const near: LatLng = { lat: 42.9223, lng: -85.7267 };

  it("flags two pins within the radius", () => {
    expect(isWithinRadius(base, near)).toBe(true);
  });

  it("does not flag pins beyond the radius", () => {
    expect(isWithinRadius(base, JOHN_BALL_PARK)).toBe(false);
  });

  it("uses a 200 metre default radius", () => {
    expect(DUPLICATE_RADIUS_METERS).toBe(200);
  });

  it("honours an overridden radius", () => {
    expect(isWithinRadius(base, near, 50)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/domain/geo/distance.test.ts`
Expected: FAIL — `Failed to resolve import "./distance"`

- [ ] **Step 3: Write the minimal implementation**

Create `app/domain/geo/distance.ts`:

```ts
export interface LatLng {
  lat: number;
  lng: number;
}

/** Spec §9.1. Configurable; this is the MVP default. */
export const DUPLICATE_RADIUS_METERS = 200;

const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance. Used for client-side duplicate hinting; the
 * authoritative check is PostGIS ST_DWithin on the server.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Proximity only. Deliberately NOT called isPotentialDuplicate: spec §9.1
 * defines a duplicate as proximity AND matching kind, and this function has no
 * kind to compare — an outdoor pin beside a studio is close but not a
 * duplicate. The kind-aware check is the `spots_within_meters` RPC, which
 * takes p_kind. Inclusive at the boundary, matching ST_DWithin.
 */
export function isWithinRadius(
  a: LatLng,
  b: LatLng,
  radiusMeters: number = DUPLICATE_RADIUS_METERS,
): boolean {
  return haversineMeters(a, b) <= radiusMeters;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/domain/geo/distance.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add app/domain/geo/distance.ts app/domain/geo/distance.test.ts
git commit -m "feat: add haversine distance and duplicate proximity check"
```

---

## Task 5: Viewport bounds and grid snapping

Spec §10: small pans must reuse the same query, so bounds are snapped to a coarse grid before they become a database call.

**Files:**
- Create: `app/domain/geo/bounds.ts`
- Test: `app/domain/geo/bounds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/domain/geo/bounds.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  gridStepForZoom,
  snapBoundsToGrid,
  boundsContain,
  type Bounds,
} from "./bounds";

const GR_VIEW: Bounds = {
  west: -85.7267,
  south: 42.9214,
  east: -85.6021,
  north: 42.9891,
};

describe("gridStepForZoom", () => {
  it("shrinks the grid as zoom increases", () => {
    expect(gridStepForZoom(14)).toBeLessThan(gridStepForZoom(10));
  });

  it("is always positive", () => {
    for (const zoom of [0, 5, 10, 18, 22]) {
      expect(gridStepForZoom(zoom)).toBeGreaterThan(0);
    }
  });
});

describe("snapBoundsToGrid", () => {
  it("expands outward so the snapped box always covers the request", () => {
    const snapped = snapBoundsToGrid(GR_VIEW, 12);
    expect(snapped.west).toBeLessThanOrEqual(GR_VIEW.west);
    expect(snapped.south).toBeLessThanOrEqual(GR_VIEW.south);
    expect(snapped.east).toBeGreaterThanOrEqual(GR_VIEW.east);
    expect(snapped.north).toBeGreaterThanOrEqual(GR_VIEW.north);
  });

  it("is idempotent — snapping a snapped box changes nothing", () => {
    const once = snapBoundsToGrid(GR_VIEW, 12);
    const twice = snapBoundsToGrid(once, 12);
    expect(twice).toEqual(once);
  });

  it("gives the same box for a small pan, so the query can be reused", () => {
    const step = gridStepForZoom(12);
    // step/100, not step/20: GR_VIEW's west edge happens to sit ~96.5% into its
    // zoom-12 cell and its north edge ~3.7% below the next boundary, so a 5%
    // nudge crosses two grid lines at once. That is a property of these
    // coordinates, not of snapBoundsToGrid, which is idempotent everywhere.
    const nudge = step / 100;
    const nudged: Bounds = {
      west: GR_VIEW.west + nudge,
      south: GR_VIEW.south + nudge,
      east: GR_VIEW.east + nudge,
      north: GR_VIEW.north + nudge,
    };
    expect(snapBoundsToGrid(nudged, 12)).toEqual(snapBoundsToGrid(GR_VIEW, 12));
  });

  it("gives a different box for a large pan", () => {
    const step = gridStepForZoom(12);
    const moved: Bounds = {
      west: GR_VIEW.west + step * 3,
      south: GR_VIEW.south + step * 3,
      east: GR_VIEW.east + step * 3,
      north: GR_VIEW.north + step * 3,
    };
    expect(snapBoundsToGrid(moved, 12)).not.toEqual(snapBoundsToGrid(GR_VIEW, 12));
  });

  // At every INTEGER zoom, 90 / step is exactly 2^(z+1), so ±90 are always grid
  // lines and the clamp never fires — this case would pass with clampLat
  // deleted. It is kept because it documents the invariant; the test below is
  // the one that actually exercises the clamp.
  it("clamps latitude to the valid range", () => {
    const polar: Bounds = { west: -10, south: -89.9, east: 10, north: 89.9 };
    const snapped = snapBoundsToGrid(polar, 3);
    expect(snapped.south).toBeGreaterThanOrEqual(-90);
    expect(snapped.north).toBeLessThanOrEqual(90);
  });

  // Map libraries send fractional zoom during pinch and smooth zoom, and `zoom`
  // is typed `number`, so this is reachable. At z=0.5 the raw ceil lands at
  // 95.46 — an invalid latitude PostGIS would reject — so the clamp is
  // load-bearing here even though it is inert at every integer zoom.
  it("clamps at fractional zoom, where the grid does not align to the poles", () => {
    const polar: Bounds = { west: -10, south: -89.9, east: 10, north: 89.9 };
    const snapped = snapBoundsToGrid(polar, 0.5);
    expect(snapped.north).toBe(90);
    expect(snapped.south).toBe(-90);
  });
});

describe("boundsContain", () => {
  it("accepts a point inside", () => {
    expect(boundsContain(GR_VIEW, { lat: 42.95, lng: -85.65 })).toBe(true);
  });

  it("rejects a point outside", () => {
    expect(boundsContain(GR_VIEW, { lat: 41.0, lng: -85.65 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/domain/geo/bounds.test.ts`
Expected: FAIL — `Failed to resolve import "./bounds"`

- [ ] **Step 3: Write the minimal implementation**

Create `app/domain/geo/bounds.ts`:

```ts
import type { LatLng } from "./distance";

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Grid cell size in degrees for a zoom level, about an eighth of the
 * visible span. Coarse enough that nudging the map reuses a query,
 * fine enough that the over-fetch stays small.
 *
 * Antimeridian crossing is not handled: the product is US-only (spec §2).
 */
export function gridStepForZoom(zoom: number): number {
  return 360 / Math.pow(2, zoom) / 8;
}

const clampLat = (value: number): number => Math.min(90, Math.max(-90, value));

/** Always expands outward, so the snapped box is a superset of the request. */
export function snapBoundsToGrid(bounds: Bounds, zoom: number): Bounds {
  const step = gridStepForZoom(zoom);
  return {
    west: Math.floor(bounds.west / step) * step,
    south: clampLat(Math.floor(bounds.south / step) * step),
    east: Math.ceil(bounds.east / step) * step,
    north: clampLat(Math.ceil(bounds.north / step) * step),
  };
}

export function boundsContain(bounds: Bounds, point: LatLng): boolean {
  return (
    point.lng >= bounds.west &&
    point.lng <= bounds.east &&
    point.lat >= bounds.south &&
    point.lat <= bounds.north
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/domain/geo/bounds.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Run the whole domain suite**

Run: `npx vitest run app/domain`
Expected: PASS — 5 files, 35 tests, completing in under a second with no database

- [ ] **Step 6: Commit**

```bash
git add app/domain/geo/bounds.ts app/domain/geo/bounds.test.ts
git commit -m "feat: add viewport bounds with grid snapping"
```

---

## Task 6: Supabase local development

**Files:**
- Create: `supabase/config.toml` (generated)
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Initialize Supabase**

```bash
npx supabase init
```

Expected: creates `supabase/config.toml` and `supabase/migrations/`.

- [ ] **Step 2: Start the local stack**

```bash
npx supabase start
```

Expected: prints `API URL`, `anon key`, and `service_role key`. First run downloads Docker images and takes several minutes. Docker must be running.

- [ ] **Step 3: Create `.env.example`**

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=replace-with-anon-key-from-supabase-status
SUPABASE_SERVICE_ROLE_KEY=replace-with-service-role-key-from-supabase-status
```

- [ ] **Step 4: Create the real `.env`**

```bash
npx supabase status -o env > /tmp/sb.env && cat /tmp/sb.env
```

Copy `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY` into a `.env` file using the variable names from `.env.example`. `.env` is already gitignored.

- [ ] **Step 5: Verify `.env` is ignored**

Run: `git check-ignore -v .env`
Expected: prints the matching `.gitignore` line. If it prints nothing, stop and add `.env` to `.gitignore`.

- [ ] **Step 6: Commit**

```bash
git add supabase/config.toml .env.example .gitignore
git commit -m "chore: initialize local Supabase stack"
```

---

## Task 7: Profiles and shoot types schema

**Files:**
- Create: `supabase/migrations/20260809000001_profiles_and_shoot_types.sql`
- Test: `tests/db/helpers.ts`, `tests/db/schema-profiles.test.ts`

- [ ] **Step 1: Write the test helper**

Create `tests/db/helpers.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    "Database tests need SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Run `npx supabase start` and populate .env.",
  );
}

/** Bypasses RLS. Use for setup and teardown only, never to assert access rules. */
export const serviceClient = (): SupabaseClient =>
  createClient(url, serviceKey, { auth: { persistSession: false } });

/** Logged-out visitor. */
export const anonClient = (): SupabaseClient =>
  createClient(url, anonKey, { auth: { persistSession: false } });

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

let counter = 0;

/** Creates a confirmed user and returns a client authenticated as them. */
export async function createTestUser(displayName = "Test User"): Promise<TestUser> {
  const admin = serviceClient();
  const email = `test-${Date.now()}-${counter++}@example.com`;
  const password = "test-password-12345";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw error;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { id: data.user.id, email, client };
}

export async function deleteTestUser(id: string): Promise<void> {
  await serviceClient().auth.admin.deleteUser(id);
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/db/schema-profiles.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { serviceClient, createTestUser, deleteTestUser } from "./helpers";

const created: string[] = [];

afterAll(async () => {
  for (const id of created) await deleteTestUser(id);
});

describe("shoot_types", () => {
  it("is seeded with the nine agreed categories", async () => {
    const { data, error } = await serviceClient().from("shoot_types").select("slug");
    expect(error).toBeNull();
    expect(data?.map((r) => r.slug).sort()).toEqual(
      [
        "branding",
        "engagement",
        "family",
        "headshot",
        "maternity",
        "newborn",
        "pets",
        "senior-portrait",
        "wedding",
      ].sort(),
    );
  });
});

describe("profiles", () => {
  it("is created automatically when a user signs up", async () => {
    const user = await createTestUser("Ada Lovelace");
    created.push(user.id);

    const { data, error } = await serviceClient()
      .from("profiles")
      .select("id, display_name, role")
      .eq("id", user.id)
      .single();

    expect(error).toBeNull();
    expect(data?.display_name).toBe("Ada Lovelace");
    expect(data?.role).toBe("user");
  });

  it("is deleted when the auth user is deleted", async () => {
    const user = await createTestUser();
    await deleteTestUser(user.id);

    const { data } = await serviceClient()
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    expect(data).toBeNull();
  });

  it("rejects a role outside the allowed set", async () => {
    const user = await createTestUser();
    created.push(user.id);

    const { error } = await serviceClient()
      .from("profiles")
      .update({ role: "superuser" })
      .eq("id", user.id);

    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/db/schema-profiles.test.ts`
Expected: FAIL — relation `shoot_types` does not exist

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260809000001_profiles_and_shoot_types.sql`:

```sql
create extension if not exists postgis;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  avatar_url text,
  bio text,
  website_url text,
  instagram text,
  created_at timestamptz not null default now()
);

create table public.shoot_types (
  id serial primary key,
  slug text not null unique,
  label text not null,
  sort_order integer not null default 0
);

insert into public.shoot_types (slug, label, sort_order) values
  ('family',          'Family',          10),
  ('engagement',      'Engagement',      20),
  ('senior-portrait', 'Senior Portrait', 30),
  ('maternity',       'Maternity',       40),
  ('newborn',         'Newborn',         50),
  ('headshot',        'Headshot',        60),
  ('wedding',         'Wedding',         70),
  ('branding',        'Branding',        80),
  ('pets',            'Pets',            90);

-- A profile row must exist for every auth user; the app never creates one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 5: Apply the migration**

```bash
npx supabase db reset
```

Expected: replays all migrations and reports success.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/db/schema-profiles.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/db
git commit -m "feat: add profiles and shoot_types schema"
```

---

## Task 8: Spots schema

**Files:**
- Create: `supabase/migrations/20260809000002_spots.sql`
- Test: `tests/db/schema-spots.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/schema-spots.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, createTestUser, deleteTestUser } from "./helpers";

let userId: string;

beforeAll(async () => {
  userId = (await createTestUser("Spot Author")).id;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("created_by", userId);
  await deleteTestUser(userId);
});

const newSpot = (overrides: Record<string, unknown> = {}) => ({
  kind: "outdoor",
  name: "Millennium Park Meadow",
  slug: `millennium-meadow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  location: "POINT(-85.7267 42.9214)",
  created_by: userId,
  ...overrides,
});

describe("spots", () => {
  it("accepts a spot with only the required fields", async () => {
    const { data, error } = await serviceClient()
      .from("spots")
      .insert(newSpot())
      .select("id, status, score, hot_score, comment_count")
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe("published");
    expect(Number(data?.score)).toBe(0);
    expect(Number(data?.hot_score)).toBe(0);
    expect(data?.comment_count).toBe(0);
  });

  it("leaves every optional attribute null", async () => {
    const { data } = await serviceClient()
      .from("spots")
      .insert(newSpot())
      .select("cost_type, walk_minutes, terrain, accessibility, dog_friendly")
      .single();

    expect(data?.cost_type).toBeNull();
    expect(data?.walk_minutes).toBeNull();
    expect(data?.terrain).toBeNull();
    expect(data?.accessibility).toBeNull();
    expect(data?.dog_friendly).toBeNull();
  });

  it("rejects an unknown kind", async () => {
    const { error } = await serviceClient().from("spots").insert(newSpot({ kind: "underwater" }));
    expect(error).not.toBeNull();
  });

  it("rejects an unknown cost_type", async () => {
    const { error } = await serviceClient()
      .from("spots")
      .insert(newSpot({ cost_type: "bitcoin" }));
    expect(error).not.toBeNull();
  });

  it("rejects a duplicate slug", async () => {
    const slug = `dupe-${Date.now()}`;
    await serviceClient().from("spots").insert(newSpot({ slug }));
    const { error } = await serviceClient().from("spots").insert(newSpot({ slug }));
    expect(error).not.toBeNull();
  });

  it("finds spots within a radius using PostGIS", async () => {
    await serviceClient().from("spots").insert(newSpot({ name: "Radius Target" }));

    // 250 m radius around a point ~100 m from the spot.
    const { data, error } = await serviceClient().rpc("spots_within_meters", {
      p_lng: -85.7267,
      p_lat: 42.9223,
      p_meters: 250,
      p_kind: "outdoor",
    });

    expect(error).toBeNull();
    expect((data as unknown[])?.length).toBeGreaterThan(0);
  });

  it("excludes spots outside the radius", async () => {
    const { data, error } = await serviceClient().rpc("spots_within_meters", {
      p_lng: -100.0,
      p_lat: 40.0,
      p_meters: 250,
      p_kind: "outdoor",
    });

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // Spec §9.1: the duplicate check matches on proximity AND kind. Without the
  // kind filter, dropping an outdoor pin beside a studio would offer the studio
  // as a duplicate candidate.
  it("does not offer a studio as a duplicate for an outdoor pin", async () => {
    await serviceClient()
      .from("spots")
      .insert(newSpot({ name: "Nearby Studio", kind: "studio" }));

    const { data, error } = await serviceClient().rpc("spots_within_meters", {
      p_lng: -85.7267,
      p_lat: 42.9223,
      p_meters: 250,
      p_kind: "outdoor",
    });

    expect(error).toBeNull();
    expect((data as { name: string }[]).map((s) => s.name)).not.toContain("Nearby Studio");
  });

  it("finds a studio when searching for studios", async () => {
    const { data, error } = await serviceClient().rpc("spots_within_meters", {
      p_lng: -85.7267,
      p_lat: 42.9223,
      p_meters: 250,
      p_kind: "studio",
    });

    expect(error).toBeNull();
    expect((data as { name: string }[]).map((s) => s.name)).toContain("Nearby Studio");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/schema-spots.test.ts`
Expected: FAIL — relation `spots` does not exist

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260809000002_spots.sql`:

```sql
create type public.spot_kind   as enum ('outdoor', 'studio');
create type public.spot_status as enum ('published', 'hidden', 'removed');
create type public.cost_type   as enum (
  'free', 'park_pass', 'permit_required', 'hourly_rate', 'negotiated'
);

create table public.spots (
  id uuid primary key default gen_random_uuid(),
  kind public.spot_kind not null,
  name text not null,
  slug text not null unique,
  description text,
  location geography(Point, 4326) not null,
  locality text,
  region text,
  created_by uuid not null references public.profiles (id),
  owner_profile_id uuid references public.profiles (id),
  status public.spot_status not null default 'published',

  -- Derived. Never edited by hand: see scripts/backfill-scores.ts.
  score numeric not null default 0,
  hot_score numeric not null default 0,

  -- Trigger-maintained counters. Weighting happens in TypeScript.
  shoot_type_upvote_count integer not null default 0,
  shoot_again_yes_count   integer not null default 0,
  shoot_again_no_count    integer not null default 0,
  comment_count           integer not null default 0,
  scouting_photo_count    integer not null default 0,
  session_photo_count     integer not null default 0,

  -- Optional attributes (spec §4.7). Nullable by design.
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
  dog_friendly boolean,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index spots_location_idx  on public.spots using gist (location);
create index spots_score_idx     on public.spots (score desc);
create index spots_hot_score_idx on public.spots (hot_score desc);
create index spots_status_idx    on public.spots (status);
create index spots_kind_idx      on public.spots (kind);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger spots_touch_updated_at
  before update on public.spots
  for each row execute function public.touch_updated_at();

-- Proximity lookup backing the duplicate check in the submission flow.
-- Spec §9.1 defines a duplicate as proximity AND matching kind: an outdoor pin
-- dropped beside a studio is not a duplicate of it, so p_kind is required
-- rather than optional.
create or replace function public.spots_within_meters(
  p_lng double precision,
  p_lat double precision,
  p_meters double precision,
  p_kind public.spot_kind
)
returns setof public.spots
language sql
stable
as $$
  select *
  from public.spots
  where status = 'published'
    and kind = p_kind
    and st_dwithin(location, st_point(p_lng, p_lat)::geography, p_meters)
  order by st_distance(location, st_point(p_lng, p_lat)::geography)
$$;
```

- [ ] **Step 4: Apply the migration**

```bash
npx supabase db reset
```

Expected: success.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/db/schema-spots.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/db/schema-spots.test.ts
git commit -m "feat: add spots schema with PostGIS proximity lookup"
```

---

## Task 9: Signals, photos, comments, links, studios, reports

This is where the `NULLS NOT DISTINCT` constraint from spec §6 lands. Getting it wrong silently allows repeat voting.

**Files:**
- Create: `supabase/migrations/20260809000003_contributions.sql`
- Test: `tests/db/schema-signals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/schema-signals.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, createTestUser, deleteTestUser } from "./helpers";

let userId: string;
let spotId: string;
let familyTypeId: number;
let weddingTypeId: number;

beforeAll(async () => {
  userId = (await createTestUser("Voter")).id;
  const db = serviceClient();

  const { data: spot } = await db
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Signal Test Spot",
      slug: `signal-test-${Date.now()}`,
      location: "POINT(-85.7267 42.9214)",
      created_by: userId,
    })
    .select("id")
    .single();
  spotId = spot!.id;

  const { data: types } = await db.from("shoot_types").select("id, slug");
  familyTypeId = types!.find((t) => t.slug === "family")!.id;
  weddingTypeId = types!.find((t) => t.slug === "wedding")!.id;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  await deleteTestUser(userId);
});

describe("signals", () => {
  it("accepts a shoot-type upvote", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "shoot_type_upvote",
      shoot_type_id: familyTypeId,
      value: 1,
    });
    expect(error).toBeNull();
  });

  it("rejects a second upvote for the same shoot type", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "shoot_type_upvote",
      shoot_type_id: familyTypeId,
      value: 1,
    });
    expect(error?.code).toBe("23505");
  });

  it("allows the same user to upvote a different shoot type", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "shoot_type_upvote",
      shoot_type_id: weddingTypeId,
      value: 1,
    });
    expect(error).toBeNull();
  });

  it("accepts a shoot-again vote with no shoot type", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "shoot_again",
      value: 1,
    });
    expect(error).toBeNull();
  });

  // The bug this schema exists to prevent: with a plain UNIQUE constraint,
  // NULL shoot_type_id values are distinct and this insert would succeed.
  it("rejects a second shoot-again vote from the same user", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "shoot_again",
      value: 0,
    });
    expect(error?.code).toBe("23505");
  });

  it("rejects a shoot-type upvote with no shoot type", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "shoot_type_upvote",
      value: 1,
    });
    expect(error).not.toBeNull();
  });

  it("rejects a shoot-again vote that carries a shoot type", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "shoot_again",
      shoot_type_id: familyTypeId,
      value: 1,
    });
    expect(error).not.toBeNull();
  });

  it("rejects a downvote — there are none", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "shoot_type_upvote",
      shoot_type_id: familyTypeId,
      value: -1,
    });
    expect(error).not.toBeNull();
  });
});

describe("photos", () => {
  it("accepts a scouting photo without a rights attestation", async () => {
    const { error } = await serviceClient().from("photos").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "scouting",
      storage_path: `${spotId}/scout-1.jpg`,
    });
    expect(error).toBeNull();
  });

  it("rejects a session photo without a rights attestation", async () => {
    const { error } = await serviceClient().from("photos").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "session",
      storage_path: `${spotId}/session-1.jpg`,
      rights_attested: false,
    });
    expect(error).not.toBeNull();
  });

  it("accepts a session photo with the attestation", async () => {
    const { error } = await serviceClient().from("photos").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "session",
      storage_path: `${spotId}/session-2.jpg`,
      rights_attested: true,
      credit_name: "Ada Lovelace",
      credit_url: "https://example.com",
    });
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/schema-signals.test.ts`
Expected: FAIL — relation `signals` does not exist

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260809000003_contributions.sql`:

```sql
create type public.signal_kind  as enum ('shoot_type_upvote', 'shoot_again');
create type public.photo_kind   as enum ('scouting', 'session');
create type public.photo_status as enum ('published', 'removed');
create type public.report_status as enum ('open', 'resolved', 'dismissed');
create type public.report_target as enum ('spot', 'photo', 'comment');

create table public.spot_shoot_types (
  spot_id uuid not null references public.spots (id) on delete cascade,
  shoot_type_id integer not null references public.shoot_types (id),
  primary key (spot_id, shoot_type_id)
);

create index spot_shoot_types_by_type on public.spot_shoot_types (shoot_type_id, spot_id);

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind public.signal_kind not null,
  shoot_type_id integer references public.shoot_types (id),
  value smallint not null,
  created_at timestamptz not null default now(),

  -- Upvotes are always +1 and always carry a shoot type.
  -- Shoot-again is yes(1)/no(0) and never carries one.
  constraint signals_shape check (
    (kind = 'shoot_type_upvote' and shoot_type_id is not null and value = 1)
    or
    (kind = 'shoot_again' and shoot_type_id is null and value in (0, 1))
  ),

  -- NULLS NOT DISTINCT is required, not stylistic. Postgres treats NULLs as
  -- distinct in unique constraints by default, which would let a user cast
  -- unlimited shoot_again votes since their shoot_type_id is null.
  constraint signals_one_per_user
    unique nulls not distinct (spot_id, profile_id, kind, shoot_type_id)
);

create index signals_spot_idx on public.signals (spot_id);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  kind public.photo_kind not null,
  storage_path text not null unique,
  caption text,
  shoot_type_id integer references public.shoot_types (id),
  rights_attested boolean not null default false,
  credit_name text,
  credit_url text,
  width integer,
  height integer,
  blurhash text,
  status public.photo_status not null default 'published',
  created_at timestamptz not null default now(),

  -- Spec §4.3: session photos show identifiable people and cannot be
  -- posted without an explicit rights attestation.
  constraint photos_session_requires_rights
    check (kind <> 'session' or rights_attested)
);

create index photos_spot_idx on public.photos (spot_id, kind);

create table public.spot_gallery_links (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  url text not null,
  title text not null,
  shoot_type_id integer references public.shoot_types (id),
  created_at timestamptz not null default now()
);

create index spot_gallery_links_spot_idx on public.spot_gallery_links (spot_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  body text not null check (length(trim(body)) > 0),
  status public.photo_status not null default 'published',
  created_at timestamptz not null default now()
);

create index comments_spot_idx on public.comments (spot_id, created_at desc);

create table public.studio_details (
  spot_id uuid primary key references public.spots (id) on delete cascade,
  hourly_rate_cents integer check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  booking_url text,
  contact_email text,
  claimed_by uuid references public.profiles (id),
  claimed_at timestamptz
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_type public.report_target not null,
  target_id uuid not null,
  profile_id uuid not null references public.profiles (id),
  reason text not null,
  note text,
  status public.report_status not null default 'open',
  resolved_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index reports_open_idx on public.reports (status, created_at desc);
```

- [ ] **Step 4: Apply the migration**

```bash
npx supabase db reset
```

Expected: success.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/db/schema-signals.test.ts`
Expected: PASS — 11 tests. The "rejects a second shoot-again vote" case is the one that proves `NULLS NOT DISTINCT` took effect.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/db/schema-signals.test.ts
git commit -m "feat: add contribution tables with one-vote-per-user enforcement"
```

---

## Task 10: Counter triggers

**Files:**
- Create: `supabase/migrations/20260809000004_counters.sql`
- Test: `tests/db/counters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/counters.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, createTestUser, deleteTestUser } from "./helpers";

let userId: string;
let spotId: string;
let familyTypeId: number;

const counters = async () => {
  const { data } = await serviceClient()
    .from("spots")
    .select(
      "shoot_type_upvote_count, shoot_again_yes_count, shoot_again_no_count, comment_count, scouting_photo_count, session_photo_count",
    )
    .eq("id", spotId)
    .single();
  return data!;
};

beforeAll(async () => {
  userId = (await createTestUser("Counter")).id;
  const db = serviceClient();

  const { data: spot } = await db
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Counter Test Spot",
      slug: `counter-test-${Date.now()}`,
      location: "POINT(-85.7267 42.9214)",
      created_by: userId,
    })
    .select("id")
    .single();
  spotId = spot!.id;

  const { data: types } = await db.from("shoot_types").select("id, slug").eq("slug", "family");
  familyTypeId = types![0].id;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  await deleteTestUser(userId);
});

describe("counter triggers", () => {
  it("starts at zero", async () => {
    const c = await counters();
    expect(c.shoot_type_upvote_count).toBe(0);
    expect(c.comment_count).toBe(0);
  });

  it("increments on an upvote", async () => {
    await serviceClient().from("signals").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "shoot_type_upvote",
      shoot_type_id: familyTypeId,
      value: 1,
    });
    expect((await counters()).shoot_type_upvote_count).toBe(1);
  });

  it("separates shoot-again yes from no", async () => {
    await serviceClient()
      .from("signals")
      .insert({ spot_id: spotId, profile_id: userId, kind: "shoot_again", value: 1 });
    const c = await counters();
    expect(c.shoot_again_yes_count).toBe(1);
    expect(c.shoot_again_no_count).toBe(0);
  });

  it("increments on a comment", async () => {
    await serviceClient()
      .from("comments")
      .insert({ spot_id: spotId, profile_id: userId, body: "Great light at 7pm." });
    expect((await counters()).comment_count).toBe(1);
  });

  it("counts scouting and session photos separately", async () => {
    const db = serviceClient();
    await db.from("photos").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "scouting",
      storage_path: `${spotId}/c-scout.jpg`,
    });
    await db.from("photos").insert({
      spot_id: spotId,
      profile_id: userId,
      kind: "session",
      storage_path: `${spotId}/c-session.jpg`,
      rights_attested: true,
    });
    const c = await counters();
    expect(c.scouting_photo_count).toBe(1);
    expect(c.session_photo_count).toBe(1);
  });

  it("decrements when a signal is removed", async () => {
    await serviceClient()
      .from("signals")
      .delete()
      .eq("spot_id", spotId)
      .eq("kind", "shoot_type_upvote");
    expect((await counters()).shoot_type_upvote_count).toBe(0);
  });

  it("stops counting a removed comment", async () => {
    await serviceClient().from("comments").update({ status: "removed" }).eq("spot_id", spotId);
    expect((await counters()).comment_count).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/counters.test.ts`
Expected: FAIL — counters stay at 0 after inserts

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260809000004_counters.sql`:

```sql
-- Full recount rather than incremental deltas: at this scale the cost is
-- irrelevant and it cannot drift out of sync the way +1/-1 arithmetic can.
-- SECURITY DEFINER so it still works once task 11 revokes UPDATE on the
-- counter columns from application roles. A plain function would run with
-- the caller's rights and be blocked by those grants.
create or replace function public.recount_spot(p_spot_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.spots s set
    shoot_type_upvote_count = (
      select count(*) from public.signals
      where spot_id = p_spot_id and kind = 'shoot_type_upvote'
    ),
    shoot_again_yes_count = (
      select count(*) from public.signals
      where spot_id = p_spot_id and kind = 'shoot_again' and value = 1
    ),
    shoot_again_no_count = (
      select count(*) from public.signals
      where spot_id = p_spot_id and kind = 'shoot_again' and value = 0
    ),
    comment_count = (
      select count(*) from public.comments
      where spot_id = p_spot_id and status = 'published'
    ),
    scouting_photo_count = (
      select count(*) from public.photos
      where spot_id = p_spot_id and kind = 'scouting' and status = 'published'
    ),
    session_photo_count = (
      select count(*) from public.photos
      where spot_id = p_spot_id and kind = 'session' and status = 'published'
    )
  where s.id = p_spot_id;
$$;

create or replace function public.trg_recount_spot()
returns trigger
language plpgsql
as $$
begin
  perform public.recount_spot(coalesce(new.spot_id, old.spot_id));
  return null;
end;
$$;

create trigger signals_recount
  after insert or update or delete on public.signals
  for each row execute function public.trg_recount_spot();

create trigger comments_recount
  after insert or update or delete on public.comments
  for each row execute function public.trg_recount_spot();

create trigger photos_recount
  after insert or update or delete on public.photos
  for each row execute function public.trg_recount_spot();
```

- [ ] **Step 4: Apply the migration**

```bash
npx supabase db reset
```

Expected: success.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/db/counters.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/db/counters.test.ts
git commit -m "feat: maintain spot counters with recount triggers"
```

---

## Task 11: Row-level security

Spec §11: authorization lives in the database, and these policies get their own tests because "the policy looks right" is not assurance.

**Files:**
- Create: `supabase/migrations/20260809000005_rls.sql`
- Test: `tests/db/rls.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/rls.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  serviceClient,
  anonClient,
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./helpers";

let author: TestUser;
let stranger: TestUser;
let admin: TestUser;
let spotId: string;

beforeAll(async () => {
  author = await createTestUser("Author");
  stranger = await createTestUser("Stranger");
  admin = await createTestUser("Admin");

  const db = serviceClient();
  await db.from("profiles").update({ role: "admin" }).eq("id", admin.id);

  const { data } = await db
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "RLS Test Spot",
      slug: `rls-test-${Date.now()}`,
      location: "POINT(-85.7267 42.9214)",
      created_by: author.id,
    })
    .select("id")
    .single();
  spotId = data!.id;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  for (const u of [author, stranger, admin]) await deleteTestUser(u.id);
});

describe("spot visibility", () => {
  it("lets a logged-out visitor read published spots", async () => {
    const { data, error } = await anonClient()
      .from("spots")
      .select("id")
      .eq("id", spotId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(spotId);
  });

  it("hides removed spots from the public", async () => {
    await serviceClient().from("spots").update({ status: "removed" }).eq("id", spotId);
    const { data } = await anonClient().from("spots").select("id").eq("id", spotId).maybeSingle();
    expect(data).toBeNull();
    await serviceClient().from("spots").update({ status: "published" }).eq("id", spotId);
  });
});

describe("spot writes", () => {
  it("refuses a spot insert from a logged-out visitor", async () => {
    const { error } = await anonClient().from("spots").insert({
      kind: "outdoor",
      name: "Anon Spot",
      slug: `anon-${Date.now()}`,
      location: "POINT(-85.7 42.9)",
      created_by: author.id,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a spot insert attributed to someone else", async () => {
    const { error } = await stranger.client.from("spots").insert({
      kind: "outdoor",
      name: "Forged Spot",
      slug: `forged-${Date.now()}`,
      location: "POINT(-85.7 42.9)",
      created_by: author.id,
    });
    expect(error).not.toBeNull();
  });

  it("lets the submitter edit their own spot", async () => {
    const { error } = await author.client
      .from("spots")
      .update({ description: "Updated by the author." })
      .eq("id", spotId);
    expect(error).toBeNull();
  });

  it("does not let a stranger edit someone else's spot", async () => {
    const { data } = await stranger.client
      .from("spots")
      .update({ description: "Hijacked." })
      .eq("id", spotId)
      .select("id");
    expect(data ?? []).toEqual([]);

    const { data: check } = await serviceClient()
      .from("spots")
      .select("description")
      .eq("id", spotId)
      .single();
    expect(check?.description).not.toBe("Hijacked.");
  });

  it("lets an admin edit any spot", async () => {
    const { data, error } = await admin.client
      .from("spots")
      .update({ description: "Moderated." })
      .eq("id", spotId)
      .select("id");
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });
});

describe("votes", () => {
  it("refuses a vote from a logged-out visitor", async () => {
    const { error } = await anonClient().from("signals").insert({
      spot_id: spotId,
      profile_id: author.id,
      kind: "shoot_again",
      value: 1,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a vote cast in someone else's name", async () => {
    const { error } = await stranger.client.from("signals").insert({
      spot_id: spotId,
      profile_id: author.id,
      kind: "shoot_again",
      value: 1,
    });
    expect(error).not.toBeNull();
  });

  it("accepts a vote cast in the voter's own name", async () => {
    const { error } = await stranger.client.from("signals").insert({
      spot_id: spotId,
      profile_id: stranger.id,
      kind: "shoot_again",
      value: 1,
    });
    expect(error).toBeNull();
  });
});

describe("derived columns", () => {
  it("does not let a user write their own score", async () => {
    await author.client.from("spots").update({ score: 9999 }).eq("id", spotId);
    const { data } = await serviceClient().from("spots").select("score").eq("id", spotId).single();
    expect(Number(data?.score)).not.toBe(9999);
  });
});

describe("reports", () => {
  it("is not readable by a non-admin", async () => {
    await serviceClient().from("reports").insert({
      target_type: "spot",
      target_id: spotId,
      profile_id: stranger.id,
      reason: "spam",
    });
    const { data } = await stranger.client.from("reports").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("is readable by an admin", async () => {
    const { data, error } = await admin.client.from("reports").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/rls.test.ts`
Expected: FAIL — with RLS not yet enabled, anonymous writes succeed

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260809000005_rls.sql`:

```sql
alter table public.profiles           enable row level security;
alter table public.shoot_types        enable row level security;
alter table public.spots              enable row level security;
alter table public.spot_shoot_types   enable row level security;
alter table public.signals            enable row level security;
alter table public.photos             enable row level security;
alter table public.spot_gallery_links enable row level security;
alter table public.comments           enable row level security;
alter table public.studio_details     enable row level security;
alter table public.reports            enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Reference data and profiles are public reads.
create policy shoot_types_read on public.shoot_types for select using (true);
create policy profiles_read    on public.profiles    for select using (true);
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Spots: anyone reads published; submitter, listing owner, or admin writes.
create policy spots_read on public.spots for select
  using (status = 'published' or created_by = auth.uid() or public.is_admin());

create policy spots_insert on public.spots for insert
  with check (created_by = auth.uid());

create policy spots_update on public.spots for update
  using (created_by = auth.uid() or owner_profile_id = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or owner_profile_id = auth.uid() or public.is_admin());

-- Derived columns are maintained by triggers and by the command layer running
-- with elevated rights. Users may never set them directly.
--
-- This must be a table-level REVOKE followed by column-level GRANTs, not a
-- column-level REVOKE: a table-wide UPDATE grant already covers every column,
-- and revoking individual columns against it does nothing. Supabase grants
-- table-wide UPDATE to anon and authenticated by default, so the broad grant
-- has to come off first.
revoke update on public.spots from anon, authenticated;

grant update (
  name, slug, description, kind, location, locality, region, status,
  owner_profile_id, cost_type, cost_notes, permit_url, hours_notes,
  best_light, best_seasons, walk_minutes, parking_notes, terrain,
  accessibility, max_group_size, dog_friendly, updated_at
) on public.spots to authenticated;

create policy spot_shoot_types_read on public.spot_shoot_types for select using (true);
create policy spot_shoot_types_write on public.spot_shoot_types for all
  using (
    exists (select 1 from public.spots s
            where s.id = spot_id and (s.created_by = auth.uid() or public.is_admin()))
  )
  with check (
    exists (select 1 from public.spots s
            where s.id = spot_id and (s.created_by = auth.uid() or public.is_admin()))
  );

-- Signals: public counts, but you may only cast your own vote.
create policy signals_read on public.signals for select using (true);
create policy signals_insert on public.signals for insert
  with check (profile_id = auth.uid());
create policy signals_delete on public.signals for delete
  using (profile_id = auth.uid());

create policy photos_read on public.photos for select
  using (status = 'published' or profile_id = auth.uid() or public.is_admin());
create policy photos_insert on public.photos for insert
  with check (profile_id = auth.uid());
create policy photos_update on public.photos for update
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

create policy gallery_links_read on public.spot_gallery_links for select using (true);
create policy gallery_links_insert on public.spot_gallery_links for insert
  with check (profile_id = auth.uid());
create policy gallery_links_delete on public.spot_gallery_links for delete
  using (profile_id = auth.uid() or public.is_admin());

create policy comments_read on public.comments for select
  using (status = 'published' or profile_id = auth.uid() or public.is_admin());
create policy comments_insert on public.comments for insert
  with check (profile_id = auth.uid());
create policy comments_update on public.comments for update
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

create policy studio_details_read on public.studio_details for select using (true);
create policy studio_details_write on public.studio_details for all
  using (claimed_by = auth.uid() or public.is_admin())
  with check (claimed_by = auth.uid() or public.is_admin());

-- Reports: anyone signed in may file one; only admins may read the queue.
create policy reports_insert on public.reports for insert
  with check (profile_id = auth.uid());
create policy reports_admin_read on public.reports for select
  using (public.is_admin());
create policy reports_admin_update on public.reports for update
  using (public.is_admin()) with check (public.is_admin());
```

- [ ] **Step 4: Apply the migration**

```bash
npx supabase db reset
```

Expected: success.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/db/rls.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — all domain and database tests

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/db/rls.test.ts
git commit -m "feat: enforce authorization with row-level security policies"
```

---

## Task 12: Environment config and Supabase server client

**Files:**
- Create: `app/lib/env.server.ts`
- Create: `app/lib/supabase.server.ts`
- Test: `app/lib/env.server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/lib/env.server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readEnv } from "./env.server";

const valid = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon-key",
};

describe("readEnv", () => {
  it("returns the parsed values", () => {
    expect(readEnv(valid)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "anon-key",
    });
  });

  it("names the missing variable so the failure is actionable", () => {
    expect(() => readEnv({ SUPABASE_URL: "http://x" })).toThrow(/SUPABASE_ANON_KEY/);
  });

  it("rejects a malformed URL", () => {
    expect(() => readEnv({ ...valid, SUPABASE_URL: "not-a-url" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/env.server.test.ts`
Expected: FAIL — `Failed to resolve import "./env.server"`

- [ ] **Step 3: Write the implementation**

Create `app/lib/env.server.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
});

export interface Env {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Fails loudly at boot rather than at the first request. */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${missing}`);
  }
  return {
    supabaseUrl: parsed.data.SUPABASE_URL,
    supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/env.server.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Write the Supabase server client**

Create `app/lib/supabase.server.ts`:

```ts
import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "./env.server";

export interface SupabaseContext {
  supabase: SupabaseClient;
  /** Must be spread onto the response so refreshed session cookies persist. */
  headers: Headers;
}

/**
 * One client per request. Supabase refreshes the session during a request,
 * so the returned headers have to reach the response or users are silently
 * logged out when their access token expires.
 */
export function createSupabaseServerClient(request: Request): SupabaseContext {
  const { supabaseUrl, supabaseAnonKey } = readEnv();
  const headers = new Headers();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "").map((cookie) => ({
          name: cookie.name,
          value: cookie.value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          headers.append("Set-Cookie", serializeCookieHeader(name, value, options));
        }
      },
    },
  });

  return { supabase, headers };
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If the script does not exist, add `"typecheck": "react-router typegen && tsc --noEmit"` to `package.json` scripts and rerun.

- [ ] **Step 7: Commit**

```bash
git add app/lib
git commit -m "feat: add validated env config and per-request Supabase client"
```

---

## Task 13: Profile queries

**Files:**
- Create: `app/data/profiles.ts`
- Test: `tests/db/profiles-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/profiles-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getProfile, getCurrentProfile } from "../../app/data/profiles";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser("Grace Hopper");
});

afterAll(async () => {
  await deleteTestUser(user.id);
});

describe("getProfile", () => {
  it("returns a domain profile, not a database row", async () => {
    const profile = await getProfile(serviceClient(), user.id);
    expect(profile).toEqual({
      id: user.id,
      displayName: "Grace Hopper",
      role: "user",
      avatarUrl: null,
      bio: null,
      websiteUrl: null,
      instagram: null,
    });
  });

  it("returns null for an unknown id", async () => {
    const profile = await getProfile(
      serviceClient(),
      "00000000-0000-0000-0000-000000000000",
    );
    expect(profile).toBeNull();
  });
});

describe("getCurrentProfile", () => {
  it("returns the signed-in user's profile", async () => {
    const profile = await getCurrentProfile(user.client);
    expect(profile?.displayName).toBe("Grace Hopper");
  });

  it("returns null for a logged-out visitor", async () => {
    expect(await getCurrentProfile(anonClient())).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/profiles-data.test.ts`
Expected: FAIL — cannot resolve `app/data/profiles`

- [ ] **Step 3: Write the implementation**

Create `app/data/profiles.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  displayName: string;
  role: "user" | "admin";
  avatarUrl: string | null;
  bio: string | null;
  websiteUrl: string | null;
  instagram: string | null;
}

const COLUMNS = "id, display_name, role, avatar_url, bio, website_url, instagram";

interface ProfileRow {
  id: string;
  display_name: string;
  role: "user" | "admin";
  avatar_url: string | null;
  bio: string | null;
  website_url: string | null;
  instagram: string | null;
}

/** Database shape stops here — routes only ever see Profile. */
const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  displayName: row.display_name,
  role: row.role,
  avatarUrl: row.avatar_url,
  bio: row.bio,
  websiteUrl: row.website_url,
  instagram: row.instagram,
});

export async function getProfile(
  supabase: SupabaseClient,
  id: string,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? toProfile(data as ProfileRow) : null;
}

export async function getCurrentProfile(
  supabase: SupabaseClient,
): Promise<Profile | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return getProfile(supabase, data.user.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/db/profiles-data.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add app/data tests/db/profiles-data.test.ts
git commit -m "feat: add profile queries returning domain objects"
```

---

## Task 14: Authentication routes

**Files:**
- Create: `app/routes/auth.login.tsx`
- Create: `app/routes/auth.callback.tsx`
- Create: `app/routes/auth.logout.tsx`
- Modify: `app/routes.ts`
- Modify: `app/routes/home.tsx`

- [ ] **Step 1: Register the routes**

Replace the contents of `app/routes.ts`:

```ts
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/callback", "routes/auth.callback.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
] satisfies RouteConfig;
```

- [ ] **Step 2: Write the sign-in route**

Create `app/routes/auth.login.tsx`:

```tsx
import { Form, redirect, useActionData } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import type { Route } from "./+types/auth.login";

export async function action({ request }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const origin = new URL(request.url).origin;

  if (intent === "google") {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback` },
    });
    if (error) return { error: error.message };
    return redirect(data.url, { headers });
  }

  if (intent === "magic-link") {
    const email = String(form.get("email") ?? "").trim();
    if (!email) return { error: "Enter an email address." };

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) return { error: error.message };
    return { sent: true };
  }

  return { error: "Unknown sign-in method." };
}

export default function Login() {
  const result = useActionData<typeof action>();

  return (
    <main>
      <h1>Sign in to Photospots</h1>
      <p>Browsing is open to everyone. Signing in lets you add spots, vote, and comment.</p>

      <Form method="post">
        <button type="submit" name="intent" value="google">
          Continue with Google
        </button>
      </Form>

      <Form method="post">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
        <button type="submit" name="intent" value="magic-link">
          Email me a sign-in link
        </button>
      </Form>

      {result && "sent" in result && result.sent ? (
        <p role="status">Check your email for a sign-in link.</p>
      ) : null}
      {result && "error" in result && result.error ? (
        <p role="alert">{result.error}</p>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 3: Write the callback route**

Create `app/routes/auth.callback.tsx`:

```tsx
import { redirect } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import type { Route } from "./+types/auth.callback";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const { supabase, headers } = createSupabaseServerClient(request);

  if (!code) {
    return redirect("/auth/login?error=missing-code", { headers });
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirect("/auth/login?error=exchange-failed", { headers });
  }

  // Headers carry the session cookies; dropping them silently loses the login.
  return redirect("/", { headers });
}
```

- [ ] **Step 4: Write the sign-out route**

Create `app/routes/auth.logout.tsx`:

```tsx
import { redirect } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import type { Route } from "./+types/auth.logout";

export async function action({ request }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  await supabase.auth.signOut();
  return redirect("/", { headers });
}

export async function loader() {
  return redirect("/");
}
```

- [ ] **Step 5: Show session state on the home route**

Replace the contents of `app/routes/home.tsx`:

```tsx
import { Form, Link } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { getCurrentProfile } from "~/data/profiles";
import type { Route } from "./+types/home";

export async function loader({ request }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const profile = await getCurrentProfile(supabase);
  return Response.json({ profile }, { headers });
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { profile } = loaderData as { profile: { displayName: string } | null };

  return (
    <main>
      <h1>Photospots</h1>
      {profile ? (
        <>
          <p>Signed in as {profile.displayName}.</p>
          <Form method="post" action="/auth/logout">
            <button type="submit">Sign out</button>
          </Form>
        </>
      ) : (
        <Link to="/auth/login">Sign in</Link>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Enable magic links locally**

Confirm `supabase/config.toml` contains, under `[auth.email]`:

```toml
enable_signup = true
```

Restart the stack if you edit it:

```bash
npx supabase stop && npx supabase start
```

- [ ] **Step 7: Verify the magic link flow by hand**

Run `npm run dev`, open `http://localhost:5173/auth/login`, enter any address, and submit the magic link form.

Open Inbucket at `http://127.0.0.1:54324`, find the message, and follow its link.

Expected: you land on `/` and it reads "Signed in as ...". Then click Sign out and confirm the link returns to "Sign in".

Google OAuth needs real credentials and is verified at deploy time, not locally.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add app/routes app/routes.ts supabase/config.toml
git commit -m "feat: add Google and magic link authentication"
```

---

## Task 15: Score backfill script

Weights are configuration, so re-weighting has to be a routine operation rather than a migration. Spec §7 calls for this early because it runs every time weights are tuned.

**Files:**
- Create: `scripts/backfill-scores.ts`
- Test: `tests/db/backfill.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `tests/db/backfill.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { backfillScores } from "../../scripts/backfill-scores";
import { serviceClient, createTestUser, deleteTestUser } from "./helpers";

let userId: string;
let spotId: string;
let familyTypeId: number;

beforeAll(async () => {
  userId = (await createTestUser("Backfiller")).id;
  const db = serviceClient();

  const { data: spot } = await db
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Backfill Spot",
      slug: `backfill-${Date.now()}`,
      location: "POINT(-85.7267 42.9214)",
      created_by: userId,
    })
    .select("id")
    .single();
  spotId = spot!.id;

  const { data: types } = await db.from("shoot_types").select("id").eq("slug", "family");
  familyTypeId = types![0].id;

  await db.from("signals").insert({
    spot_id: spotId,
    profile_id: userId,
    kind: "shoot_type_upvote",
    shoot_type_id: familyTypeId,
    value: 1,
  });
  await db
    .from("comments")
    .insert({ spot_id: spotId, profile_id: userId, body: "Good parking." });
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  await deleteTestUser(userId);
});

const scoreOf = async (): Promise<number> => {
  const { data } = await serviceClient().from("spots").select("score").eq("id", spotId).single();
  return Number(data!.score);
};

describe("backfillScores", () => {
  it("writes the weighted score from the counters", async () => {
    const updated = await backfillScores(serviceClient());
    expect(updated).toBeGreaterThan(0);
    // 1 upvote (1.0) + 1 comment (0.5)
    expect(await scoreOf()).toBe(1.5);
  });

  it("applies alternative weights when re-weighting", async () => {
    await backfillScores(serviceClient(), {
      shootTypeUpvote: 10,
      shootAgainYes: 2,
      shootAgainNo: -1.5,
      comment: 0,
      scoutingPhoto: 1,
      sessionPhoto: 1.5,
    });
    expect(await scoreOf()).toBe(10);
  });

  it("is idempotent", async () => {
    await backfillScores(serviceClient());
    const first = await scoreOf();
    await backfillScores(serviceClient());
    expect(await scoreOf()).toBe(first);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/backfill.test.ts`
Expected: FAIL — cannot resolve `scripts/backfill-scores`

- [ ] **Step 3: Write the implementation**

Create `scripts/backfill-scores.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeScore, type SpotCounters } from "../app/domain/scoring/score";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "../app/domain/scoring/weights";

const PAGE_SIZE = 500;

interface CounterRow {
  id: string;
  shoot_type_upvote_count: number;
  shoot_again_yes_count: number;
  shoot_again_no_count: number;
  comment_count: number;
  scouting_photo_count: number;
  session_photo_count: number;
}

const toCounters = (row: CounterRow): SpotCounters => ({
  shootTypeUpvoteCount: row.shoot_type_upvote_count,
  shootAgainYesCount: row.shoot_again_yes_count,
  shootAgainNoCount: row.shoot_again_no_count,
  commentCount: row.comment_count,
  scoutingPhotoCount: row.scouting_photo_count,
  sessionPhotoCount: row.session_photo_count,
});

/** Recomputes every stored score. Run after any change to ScoreWeights. */
export async function backfillScores(
  supabase: SupabaseClient,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): Promise<number> {
  let updated = 0;
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("spots")
      .select(
        "id, shoot_type_upvote_count, shoot_again_yes_count, shoot_again_no_count, comment_count, scouting_photo_count, session_photo_count",
      )
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data as CounterRow[]) {
      const score = computeScore(toCounters(row), weights);
      const { error: updateError } = await supabase
        .from("spots")
        .update({ score })
        .eq("id", row.id);
      if (updateError) throw updateError;
      updated += 1;
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return updated;
}

/** CLI entry point. Requires the service role key: this writes derived columns. */
async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const updated = await backfillScores(supabase);
  console.log(`Recomputed ${updated} spot scores.`);
}

if (process.argv[1]?.endsWith("backfill-scores.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Add the npm script**

Add to `package.json` `"scripts"`:

```json
"backfill:scores": "tsx scripts/backfill-scores.ts"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/db/backfill.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 6: Run the script end to end**

Run: `npm run backfill:scores`
Expected: prints `Recomputed N spot scores.`

- [ ] **Step 7: Commit**

```bash
git add scripts tests/db/backfill.test.ts package.json
git commit -m "feat: add score backfill script for weight changes"
```

---

## Task 16: Documentation and green build

**Files:**
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Write the README**

Create `README.md`:

```markdown
# Photospots

A map of photography locations, cultivated by local photographers. See
`docs/superpowers/specs/2026-08-09-photospots-design.md` for the design.

## Requirements

- Node 20+
- Docker (for the local Supabase stack)

## Setup

```bash
npm install
npx supabase start
npx supabase status -o env   # copy values into .env, see .env.example
npm run dev
```

Local mail (magic links) is at http://127.0.0.1:54324.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Everything |
| `npm run test:unit` | Pure domain tests — fast, no Docker needed |
| `npm run test:db` | Database and RLS tests — requires `npx supabase start` |
| `npm run typecheck` | TypeScript |
| `npx supabase db reset` | Replay all migrations |
| `npm run backfill:scores` | Recompute scores after changing weights |

## Layout

- `app/domain/` — pure functions, no I/O. Scoring and geography live here.
- `app/data/` — Supabase queries. Database types do not escape this directory.
- `app/routes/` — thin loaders and actions.
- `supabase/migrations/` — schema, triggers, RLS.
- `tests/db/` — integration and RLS tests against local Supabase.

Scoring weights are configuration in `app/domain/scoring/weights.ts`. Changing
them requires running `npm run backfill:scores`.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all files. Domain tests need no database; `tests/db/` requires `npx supabase start`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build completes with no errors

- [ ] **Step 5: Commit**

```bash
git add README.md package.json
git commit -m "docs: add README with setup and project layout"
```

---

## Done when

- `npm test` passes: 4 domain test files with no database dependency, plus 6 database test files
- `npm run typecheck` and `npm run build` are clean
- Signing in with a magic link works locally end to end, and signing out works
- `npx supabase db reset` replays every migration from empty
- A second `shoot_again` vote from the same user is rejected with error code `23505`

## Not in this plan

Plan 2 (read-only explore) adds the spots query with viewport bounds, the MapLibre component, split
view, and the spot detail page. Plans 3–6 follow spec §13.
