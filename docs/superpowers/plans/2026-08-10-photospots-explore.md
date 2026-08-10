# Photospots Explore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the map on screen — browse real spots in a viewport, filter by shoot type, switch between split/map/gallery views, and open a spot's detail page. Read-only: nothing here creates or edits a spot.

**Architecture:** A `spots_in_viewport` RPC projects `geography` into plain `lat`/`lng` and attaches a cover photo, because PostgREST returns `geography` as hex EWKB that JavaScript cannot use. `app/data/spots.ts` maps those rows into domain objects so database types stop at that boundary. The map component is dumb — it takes spots and emits viewport changes, and knows nothing about fetching. All view state (viewport, filters, chosen view) lives in URL search params, so every screen is a shareable link.

**Tech Stack:** React Router v8 · MapLibre GL · Supabase (PostGIS, Storage) · Vitest

**Plan sequence:** Plan 2 of 6. Plan 1 (foundation) is complete: schema, RLS, auth, and the pure `app/domain/` layer all landed with 133 passing tests.

**Spec:** `docs/superpowers/specs/2026-08-09-photospots-design.md` — §8 (surfaces), §10 (failure handling), §13 (milestone 2).

**Commit convention:** every commit message ends with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## What plan 1 leaves you

Read these before starting; the plan assumes them.

| Available | Where |
| --- | --- |
| `Bounds`, `snapBoundsToGrid`, `gridStepForZoom`, `boundsContain` | `app/domain/geo/bounds.ts` |
| `LatLng`, `haversineMeters`, `isWithinRadius` | `app/domain/geo/distance.ts` |
| `computeScore`, `computeHotScore`, `weightForSignalKind` | `app/domain/scoring/` |
| `createSupabaseServerClient(request) → { supabase, headers }` | `app/lib/supabase.server.ts` |
| `getProfile`, `getCurrentProfile` | `app/data/profiles.ts` |
| Full schema, RLS, `spots_within_meters`, `cast_signal`, `claim_studio` | `supabase/migrations/` |

**Four constraints carried forward from plan 1's reviews. Violating any of them reintroduces a bug that was already fixed once:**

1. **Always write `status = 'published'` explicitly in queries**, even though RLS already enforces it. The RLS predicate is a disjunction (`status='published' OR created_by=auth.uid() OR is_admin()`) which never matches a partial index's predicate, so relying on RLS alone makes partial indexes dead weight.
2. **Database row types never leave `app/data/`.** The domain layer defines its own shapes; mapping functions live in the data layer and point inward.
3. **Every new function needs `revoke execute … from public` before its grants.** Postgres grants EXECUTE to PUBLIC by default, so a `grant … to authenticated` on its own restricts nothing.
4. **Every new table needs an explicit `grant … to service_role`** (tests use it) and `enable row level security`, or it fails with `42501`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260810000007_explore.sql` | `spots_in_viewport` and `spot_by_slug` RPCs; the photo storage bucket and its read policy |
| `app/domain/filters/explore-filters.ts` | URL search params ⇄ a typed `ExploreFilters` object. Pure. |
| `app/data/spots.ts` | Viewport and detail queries; row → domain mapping |
| `app/lib/photo-url.ts` | Storage path → public URL |
| `app/components/map/SpotMap.tsx` | MapLibre wrapper. Takes spots, emits viewport. No fetching. |
| `app/components/explore/SpotCard.tsx` | One result, used by both list and gallery |
| `app/components/explore/ExploreLayout.tsx` | Arranges map and results into split / map / gallery |
| `app/routes/home.tsx` | Explore route — loader, filter controls, view switch |
| `app/routes/spots.$slug.tsx` | Spot detail |
| `scripts/seed-grand-rapids.ts` | Real seed data with photos, so there is something to look at |

`SpotMap` and the layout are separate on purpose: the map is the piece most likely to need fiddling, and keeping it ignorant of data means it can be tested on its props contract alone.

---

## Task 1: Viewport and detail RPCs

PostgREST returns `geography` as hex EWKB (`0101000020E6100000…`), which no JavaScript map can consume. Both queries therefore go through RPCs that project `st_x`/`st_y` into plain doubles.

**Files:**
- Create: `supabase/migrations/20260810000007_explore.sql`
- Test: `tests/db/explore-rpcs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/explore-rpcs.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser } from "./helpers";

let userId: string;
let insideId: string;
let outsideId: string;
let hiddenId: string;
let familyTypeId: number;
let weddingTypeId: number;

// A box around downtown Grand Rapids.
const VIEW = { p_west: -85.75, p_south: 42.90, p_east: -85.60, p_north: 43.00 };

const makeSpot = async (name: string, lng: number, lat: number, status = "published") => {
  const { data, error } = await serviceClient()
    .from("spots")
    .insert({
      kind: "outdoor",
      name,
      slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      location: `POINT(${lng} ${lat})`,
      created_by: userId,
      status,
      locality: "Grand Rapids",
      region: "MI",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
};

beforeAll(async () => {
  userId = (await createTestUser("Explorer")).id;
  const db = serviceClient();

  insideId = await makeSpot("Inside View", -85.68, 42.95);
  outsideId = await makeSpot("Outside View", -100.0, 40.0);
  hiddenId = await makeSpot("Hidden Spot", -85.67, 42.96, "hidden");

  const { data: types } = await db.from("shoot_types").select("id, slug");
  familyTypeId = types!.find((t) => t.slug === "family")!.id;
  weddingTypeId = types!.find((t) => t.slug === "wedding")!.id;

  await db.from("spot_shoot_types").insert({ spot_id: insideId, shoot_type_id: familyTypeId });

  await db.from("photos").insert({
    spot_id: insideId,
    profile_id: userId,
    kind: "scouting",
    storage_path: `${insideId}/scout.jpg`,
  });
  await db.from("photos").insert({
    spot_id: insideId,
    profile_id: userId,
    kind: "session",
    storage_path: `${insideId}/session.jpg`,
    rights_attested: true,
    credit_name: "Ada Lovelace",
  });
});

afterAll(async () => {
  const db = serviceClient();
  for (const id of [insideId, outsideId, hiddenId]) await db.from("spots").delete().eq("id", id);
  await deleteTestUser(userId);
});

const names = (rows: unknown) => (rows as { name: string }[]).map((r) => r.name);

describe("spots_in_viewport", () => {
  it("returns spots inside the box", async () => {
    const { data, error } = await anonClient().rpc("spots_in_viewport", VIEW);
    expect(error).toBeNull();
    expect(names(data)).toContain("Inside View");
  });

  it("excludes spots outside the box", async () => {
    const { data } = await anonClient().rpc("spots_in_viewport", VIEW);
    expect(names(data)).not.toContain("Outside View");
  });

  it("excludes spots that are not published", async () => {
    const { data } = await anonClient().rpc("spots_in_viewport", VIEW);
    expect(names(data)).not.toContain("Hidden Spot");
  });

  // The whole reason this is an RPC: `select location` over PostgREST returns
  // hex EWKB, which no map can use.
  it("projects the location into usable numbers", async () => {
    const { data } = await anonClient().rpc("spots_in_viewport", VIEW);
    const row = (data as { name: string; lat: number; lng: number }[]).find(
      (r) => r.name === "Inside View",
    )!;
    expect(row.lat).toBeCloseTo(42.95, 5);
    expect(row.lng).toBeCloseTo(-85.68, 5);
  });

  it("filters by shoot type", async () => {
    const withFamily = await anonClient().rpc("spots_in_viewport", {
      ...VIEW,
      p_shoot_type_id: familyTypeId,
    });
    const withWedding = await anonClient().rpc("spots_in_viewport", {
      ...VIEW,
      p_shoot_type_id: weddingTypeId,
    });
    expect(names(withFamily.data)).toContain("Inside View");
    expect(names(withWedding.data)).not.toContain("Inside View");
  });

  // A session photo is what persuades a family, so it wins over a scouting shot.
  it("prefers a session photo as the cover", async () => {
    const { data } = await anonClient().rpc("spots_in_viewport", VIEW);
    const row = (data as { name: string; cover_photo_path: string | null }[]).find(
      (r) => r.name === "Inside View",
    )!;
    expect(row.cover_photo_path).toContain("session.jpg");
  });

  it("caps the number of rows returned", async () => {
    const { data } = await anonClient().rpc("spots_in_viewport", { ...VIEW, p_limit: 1 });
    expect((data as unknown[]).length).toBe(1);
  });

  it("sorts by hot when asked", async () => {
    const { error } = await anonClient().rpc("spots_in_viewport", { ...VIEW, p_sort: "hot" });
    expect(error).toBeNull();
  });
});

describe("spot_by_slug", () => {
  it("returns one published spot with a projected location", async () => {
    const { data: spot } = await serviceClient()
      .from("spots")
      .select("slug")
      .eq("id", insideId)
      .single();

    const { data, error } = await anonClient().rpc("spot_by_slug", { p_slug: spot!.slug });
    expect(error).toBeNull();
    const row = (data as { name: string; lat: number }[])[0];
    expect(row.name).toBe("Inside View");
    expect(row.lat).toBeCloseTo(42.95, 5);
  });

  it("returns nothing for a spot that is not published", async () => {
    const { data: spot } = await serviceClient()
      .from("spots")
      .select("slug")
      .eq("id", hiddenId)
      .single();

    const { data } = await anonClient().rpc("spot_by_slug", { p_slug: spot!.slug });
    expect(data).toEqual([]);
  });

  it("returns nothing for an unknown slug", async () => {
    const { data } = await anonClient().rpc("spot_by_slug", { p_slug: "no-such-spot" });
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/explore-rpcs.test.ts`
Expected: FAIL — `Could not find the function public.spots_in_viewport`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810000007_explore.sql`:

```sql
-- Viewport query behind the map.
--
-- An RPC rather than a view because `location` is geography, and PostgREST
-- serialises that as hex EWKB (0101000020E6100000…) which no map library can
-- read. st_x/st_y project it to plain doubles at the boundary.
--
-- `status = 'published'` is written explicitly even though RLS enforces it: the
-- RLS predicate is a disjunction, so it can never match a partial index's
-- predicate, and any `where status='published'` partial index would be unused
-- if the query leaned on RLS alone.
create or replace function public.spots_in_viewport(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_shoot_type_id integer default null,
  p_sort text default 'score',
  p_limit integer default 200
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
    -- A session photo is what persuades a family, so it wins over a scouting
    -- shot; oldest first within a kind so the cover is stable as photos are added.
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
  order by
    case when p_sort = 'hot' then s.hot_score else s.score end desc,
    s.id
  limit least(greatest(p_limit, 1), 500)
$$;

-- Detail page. Returns a set rather than a single row so an unknown or
-- unpublished slug comes back as an empty result instead of an error the route
-- would have to special-case.
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
    s.locality, s.region, s.score, s.hot_score,
    s.shoot_type_upvote_count, s.shoot_again_yes_count, s.shoot_again_no_count,
    s.comment_count, s.scouting_photo_count, s.session_photo_count,
    s.cost_type, s.cost_notes, s.permit_url, s.hours_notes,
    s.best_light, s.best_seasons, s.walk_minutes, s.parking_notes,
    s.terrain, s.accessibility, s.max_group_size, s.dog_friendly
  from public.spots s
  where s.slug = p_slug and s.status = 'published'
$$;

-- Postgres grants EXECUTE to PUBLIC by default, so the grants below restrict
-- nothing unless PUBLIC is revoked first.
revoke execute on function public.spots_in_viewport(double precision, double precision, double precision, double precision, integer, text, integer) from public;
revoke execute on function public.spot_by_slug(text) from public;

-- Browsing is open to logged-out visitors (spec §4.6), so anon gets both.
grant execute on function public.spots_in_viewport(double precision, double precision, double precision, double precision, integer, text, integer) to anon, authenticated, service_role;
grant execute on function public.spot_by_slug(text) to anon, authenticated, service_role;

-- Photos are served from Storage. Public read so a logged-out visitor sees the
-- map; writes come in plan 3 and are not granted here.
insert into storage.buckets (id, name, public)
values ('spot-photos', 'spot-photos', true)
on conflict (id) do nothing;

create policy "spot photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'spot-photos');
```

- [ ] **Step 4: Apply the migration**

```bash
npx supabase db reset
```

Expected: applies all seven migrations with no errors.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/db/explore-rpcs.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/db/explore-rpcs.test.ts
git commit -m "feat: add viewport and detail RPCs with projected coordinates"
```

---

## Task 2: Explore filters as URL state

Spec §8: filter and viewport state live in the URL so every view is a shareable link. This module is the pure translation between `URLSearchParams` and a typed object — no React, no I/O.

**Files:**
- Create: `app/domain/filters/explore-filters.ts`
- Test: `app/domain/filters/explore-filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/domain/filters/explore-filters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseExploreFilters,
  filtersToSearchParams,
  DEFAULT_FILTERS,
  DEFAULT_VIEWPORT,
  type ExploreFilters,
} from "./explore-filters";

const parse = (qs: string) => parseExploreFilters(new URLSearchParams(qs));

describe("parseExploreFilters", () => {
  it("falls back to Grand Rapids and the split view when the URL is empty", () => {
    expect(parse("")).toEqual(DEFAULT_FILTERS);
    expect(DEFAULT_FILTERS.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(DEFAULT_FILTERS.view).toBe("split");
  });

  it("reads the viewport", () => {
    const f = parse("w=-86&s=42&e=-85&n=43&z=11");
    expect(f.viewport).toEqual({ west: -86, south: 42, east: -85, north: 43 });
    expect(f.zoom).toBe(11);
  });

  it("reads the shoot type and sort", () => {
    const f = parse("type=3&sort=hot");
    expect(f.shootTypeId).toBe(3);
    expect(f.sort).toBe("hot");
  });

  it("reads the view", () => {
    expect(parse("view=gallery").view).toBe("gallery");
    expect(parse("view=map").view).toBe("map");
  });

  // A URL is user-editable and arrives from strangers' links, so every field
  // has to survive nonsense without throwing.
  it("ignores an unknown view", () => {
    expect(parse("view=hologram").view).toBe("split");
  });

  it("ignores an unknown sort", () => {
    expect(parse("sort=vibes").sort).toBe("score");
  });

  it("ignores a non-numeric shoot type", () => {
    expect(parse("type=family").shootTypeId).toBeNull();
  });

  it("ignores a partial viewport rather than building a broken box", () => {
    expect(parse("w=-86&s=42").viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it("ignores an out-of-range viewport", () => {
    expect(parse("w=-200&s=42&e=-85&n=43").viewport).toEqual(DEFAULT_VIEWPORT);
    expect(parse("w=-86&s=-95&e=-85&n=43").viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it("ignores an inverted viewport", () => {
    expect(parse("w=-85&s=43&e=-86&n=42").viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it("clamps the zoom", () => {
    expect(parse("z=99").zoom).toBe(22);
    expect(parse("z=-5").zoom).toBe(0);
  });
});

describe("filtersToSearchParams", () => {
  it("round-trips", () => {
    const filters: ExploreFilters = {
      viewport: { west: -86, south: 42, east: -85, north: 43 },
      zoom: 11,
      shootTypeId: 3,
      sort: "hot",
      view: "gallery",
    };
    expect(parseExploreFilters(filtersToSearchParams(filters))).toEqual(filters);
  });

  // Otherwise every pan writes a URL full of defaults and the share link is
  // unreadable.
  it("omits values that match the default", () => {
    const qs = filtersToSearchParams(DEFAULT_FILTERS).toString();
    expect(qs).toBe("");
  });

  it("keeps the viewport when it differs from the default", () => {
    const qs = filtersToSearchParams({
      ...DEFAULT_FILTERS,
      viewport: { west: -86, south: 42, east: -85, north: 43 },
    }).toString();
    expect(qs).toContain("w=-86");
    expect(qs).toContain("n=43");
  });

  it("rounds coordinates so a share link is not 60 characters of float noise", () => {
    const qs = filtersToSearchParams({
      ...DEFAULT_FILTERS,
      viewport: {
        west: -85.72671234567,
        south: 42.92141234567,
        east: -85.60211234567,
        north: 42.98911234567,
      },
    }).toString();
    expect(qs).toContain("w=-85.72671");
    expect(qs).not.toContain("1234567");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/domain/filters/explore-filters.test.ts`
Expected: FAIL — `Cannot find module './explore-filters'`

- [ ] **Step 3: Write the implementation**

Create `app/domain/filters/explore-filters.ts`:

```ts
import type { Bounds } from "../geo/bounds";

export type ExploreView = "split" | "map" | "gallery";
export type ExploreSort = "score" | "hot";

export interface ExploreFilters {
  viewport: Bounds;
  zoom: number;
  shootTypeId: number | null;
  sort: ExploreSort;
  view: ExploreView;
}

/** Downtown Grand Rapids — the launch market (spec §2). */
export const DEFAULT_VIEWPORT: Bounds = Object.freeze({
  west: -85.7267,
  south: 42.9214,
  east: -85.6021,
  north: 42.9891,
});

export const DEFAULT_FILTERS: ExploreFilters = Object.freeze({
  viewport: DEFAULT_VIEWPORT,
  zoom: 12,
  shootTypeId: null,
  sort: "score",
  view: "split",
});

const VIEWS: readonly string[] = ["split", "map", "gallery"];
const SORTS: readonly string[] = ["score", "hot"];

/** Six decimals is about 10 cm — far finer than a hand-dropped pin. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

const num = (params: URLSearchParams, key: string): number | null => {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const readViewport = (params: URLSearchParams): Bounds => {
  const west = num(params, "w");
  const south = num(params, "s");
  const east = num(params, "e");
  const north = num(params, "n");

  // All four or none — a partial box would silently query the wrong region.
  if (west === null || south === null || east === null || north === null) {
    return DEFAULT_VIEWPORT;
  }
  const inRange =
    west >= -180 && east <= 180 && south >= -90 && north <= 90 && west < east && south < north;

  return inRange ? { west, south, east, north } : DEFAULT_VIEWPORT;
};

/**
 * Search params are user-editable and arrive from other people's links, so
 * every field falls back to a default rather than throwing. A bad URL should
 * show Grand Rapids, not an error page.
 */
export function parseExploreFilters(params: URLSearchParams): ExploreFilters {
  const zoomRaw = num(params, "z");
  const typeRaw = num(params, "type");
  const view = params.get("view");
  const sort = params.get("sort");

  return {
    viewport: readViewport(params),
    zoom: zoomRaw === null ? DEFAULT_FILTERS.zoom : Math.min(22, Math.max(0, zoomRaw)),
    shootTypeId: typeRaw !== null && Number.isInteger(typeRaw) ? typeRaw : null,
    sort: sort !== null && SORTS.includes(sort) ? (sort as ExploreSort) : "score",
    view: view !== null && VIEWS.includes(view) ? (view as ExploreView) : "split",
  };
}

/** Only non-default values are written, so a share link stays readable. */
export function filtersToSearchParams(filters: ExploreFilters): URLSearchParams {
  const params = new URLSearchParams();
  const { viewport: v } = filters;

  if (
    v.west !== DEFAULT_VIEWPORT.west ||
    v.south !== DEFAULT_VIEWPORT.south ||
    v.east !== DEFAULT_VIEWPORT.east ||
    v.north !== DEFAULT_VIEWPORT.north
  ) {
    params.set("w", String(round6(v.west)));
    params.set("s", String(round6(v.south)));
    params.set("e", String(round6(v.east)));
    params.set("n", String(round6(v.north)));
  }
  if (filters.zoom !== DEFAULT_FILTERS.zoom) params.set("z", String(filters.zoom));
  if (filters.shootTypeId !== null) params.set("type", String(filters.shootTypeId));
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.view !== DEFAULT_FILTERS.view) params.set("view", filters.view);

  return params;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/domain/filters/explore-filters.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: Commit**

```bash
git add app/domain/filters
git commit -m "feat: parse and serialise explore filters as URL state"
```

---

## Task 3: Spots data layer

**Files:**
- Create: `app/data/spots.ts`
- Test: `tests/db/spots-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/spots-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { listSpotsInViewport, getSpotBySlug } from "../../app/data/spots";
import { serviceClient, anonClient, createTestUser, deleteTestUser } from "./helpers";
import { DEFAULT_VIEWPORT, DEFAULT_FILTERS } from "../../app/domain/filters/explore-filters";

let userId: string;
let spotId: string;
let slug: string;

beforeAll(async () => {
  userId = (await createTestUser("Data Reader")).id;
  slug = `data-spot-${Date.now()}`;
  const { data } = await serviceClient()
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Data Spot",
      slug,
      location: "POINT(-85.68 42.95)",
      created_by: userId,
      locality: "Grand Rapids",
      region: "MI",
      walk_minutes: 12,
      terrain: ["gravel", "grass"],
    })
    .select("id")
    .single();
  spotId = data!.id;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  await deleteTestUser(userId);
});

describe("listSpotsInViewport", () => {
  it("returns domain objects, not database rows", async () => {
    const spots = await listSpotsInViewport(anonClient(), DEFAULT_FILTERS);
    const spot = spots.find((s) => s.slug === slug)!;

    expect(spot).toBeDefined();
    // camelCase domain shape; snake_case column names must not leak through.
    expect(spot.coverPhotoPath).toBeNull();
    expect(spot).not.toHaveProperty("cover_photo_path");
    expect(spot.position).toEqual({ lat: 42.95, lng: -85.68 });
  });

  it("returns numbers for score, not the strings PostgREST sends for numeric", async () => {
    const spots = await listSpotsInViewport(anonClient(), DEFAULT_FILTERS);
    const spot = spots.find((s) => s.slug === slug)!;
    expect(typeof spot.score).toBe("number");
    expect(typeof spot.hotScore).toBe("number");
  });

  it("returns an empty array for an empty region rather than throwing", async () => {
    const spots = await listSpotsInViewport(anonClient(), {
      ...DEFAULT_FILTERS,
      viewport: { west: 10, south: 10, east: 11, north: 11 },
    });
    expect(spots).toEqual([]);
  });
});

describe("getSpotBySlug", () => {
  it("returns the spot with its optional attributes", async () => {
    const spot = await getSpotBySlug(anonClient(), slug);
    expect(spot?.name).toBe("Data Spot");
    expect(spot?.walkMinutes).toBe(12);
    expect(spot?.terrain).toEqual(["gravel", "grass"]);
    expect(spot?.position.lat).toBeCloseTo(42.95, 5);
  });

  it("returns null for an unknown slug", async () => {
    expect(await getSpotBySlug(anonClient(), "no-such-spot")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/spots-data.test.ts`
Expected: FAIL — `Cannot find module '../../app/data/spots'`

- [ ] **Step 3: Write the implementation**

Create `app/data/spots.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LatLng } from "../domain/geo/distance";
import type { ExploreFilters } from "../domain/filters/explore-filters";

export type SpotKind = "outdoor" | "studio";

/** A spot as the map and result list need it. */
export interface SpotSummary {
  id: string;
  name: string;
  slug: string;
  kind: SpotKind;
  position: LatLng;
  locality: string | null;
  region: string | null;
  score: number;
  hotScore: number;
  commentCount: number;
  photoCount: number;
  coverPhotoPath: string | null;
  coverCreditName: string | null;
}

/** Everything the detail page shows. */
export interface SpotDetail extends SpotSummary {
  description: string | null;
  shootTypeUpvoteCount: number;
  shootAgainYesCount: number;
  shootAgainNoCount: number;
  costType: string | null;
  costNotes: string | null;
  permitUrl: string | null;
  hoursNotes: string | null;
  bestLight: string[] | null;
  bestSeasons: string[] | null;
  walkMinutes: number | null;
  parkingNotes: string | null;
  terrain: string[] | null;
  accessibility: string[] | null;
  maxGroupSize: number | null;
  dogFriendly: boolean | null;
}

/**
 * PostgREST sends `numeric` as a string to avoid precision loss in JSON, so
 * every score would otherwise sort and render as text.
 */
const toNumber = (value: unknown): number => Number(value ?? 0);

interface ViewportRow {
  id: string;
  name: string;
  slug: string;
  kind: SpotKind;
  lat: number;
  lng: number;
  locality: string | null;
  region: string | null;
  score: string | number;
  hot_score: string | number;
  comment_count: number;
  scouting_photo_count: number;
  session_photo_count: number;
  cover_photo_path: string | null;
  cover_credit_name: string | null;
}

const toSummary = (row: ViewportRow): SpotSummary => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  kind: row.kind,
  position: { lat: row.lat, lng: row.lng },
  locality: row.locality,
  region: row.region,
  score: toNumber(row.score),
  hotScore: toNumber(row.hot_score),
  commentCount: row.comment_count,
  photoCount: row.scouting_photo_count + row.session_photo_count,
  coverPhotoPath: row.cover_photo_path,
  coverCreditName: row.cover_credit_name,
});

export async function listSpotsInViewport(
  supabase: SupabaseClient,
  filters: ExploreFilters,
  limit = 200,
): Promise<SpotSummary[]> {
  const { viewport, shootTypeId, sort } = filters;
  const { data, error } = await supabase.rpc("spots_in_viewport", {
    p_west: viewport.west,
    p_south: viewport.south,
    p_east: viewport.east,
    p_north: viewport.north,
    p_shoot_type_id: shootTypeId,
    p_sort: sort,
    p_limit: limit,
  });

  if (error) throw error;
  return ((data ?? []) as ViewportRow[]).map(toSummary);
}

interface DetailRow extends ViewportRow {
  description: string | null;
  shoot_type_upvote_count: number;
  shoot_again_yes_count: number;
  shoot_again_no_count: number;
  cost_type: string | null;
  cost_notes: string | null;
  permit_url: string | null;
  hours_notes: string | null;
  best_light: string[] | null;
  best_seasons: string[] | null;
  walk_minutes: number | null;
  parking_notes: string | null;
  terrain: string[] | null;
  accessibility: string[] | null;
  max_group_size: number | null;
  dog_friendly: boolean | null;
}

export async function getSpotBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<SpotDetail | null> {
  const { data, error } = await supabase.rpc("spot_by_slug", { p_slug: slug });
  if (error) throw error;

  const rows = (data ?? []) as DetailRow[];
  if (rows.length === 0) return null;
  const row = rows[0];

  return {
    // spot_by_slug does not project a cover photo; the detail page loads the
    // full photo set separately in plan 3.
    ...toSummary({ ...row, cover_photo_path: null, cover_credit_name: null }),
    description: row.description,
    shootTypeUpvoteCount: row.shoot_type_upvote_count,
    shootAgainYesCount: row.shoot_again_yes_count,
    shootAgainNoCount: row.shoot_again_no_count,
    costType: row.cost_type,
    costNotes: row.cost_notes,
    permitUrl: row.permit_url,
    hoursNotes: row.hours_notes,
    bestLight: row.best_light,
    bestSeasons: row.best_seasons,
    walkMinutes: row.walk_minutes,
    parkingNotes: row.parking_notes,
    terrain: row.terrain,
    accessibility: row.accessibility,
    maxGroupSize: row.max_group_size,
    dogFriendly: row.dog_friendly,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/db/spots-data.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add app/data/spots.ts tests/db/spots-data.test.ts
git commit -m "feat: add spots viewport and detail queries"
```

---

## Task 4: Photo URLs

**Files:**
- Create: `app/lib/photo-url.ts`
- Test: `app/lib/photo-url.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/lib/photo-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { photoUrl, SPOT_PHOTO_BUCKET } from "./photo-url";

const BASE = "http://127.0.0.1:54321";

describe("photoUrl", () => {
  it("builds a public storage URL", () => {
    expect(photoUrl(BASE, "abc/scout.jpg")).toBe(
      `${BASE}/storage/v1/object/public/${SPOT_PHOTO_BUCKET}/abc/scout.jpg`,
    );
  });

  it("returns null for a missing path, so callers render a placeholder", () => {
    expect(photoUrl(BASE, null)).toBeNull();
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(photoUrl(`${BASE}/`, "abc/scout.jpg")).toBe(
      `${BASE}/storage/v1/object/public/${SPOT_PHOTO_BUCKET}/abc/scout.jpg`,
    );
  });

  it("encodes a path with spaces", () => {
    expect(photoUrl(BASE, "abc/my photo.jpg")).toContain("my%20photo.jpg");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/photo-url.test.ts`
Expected: FAIL — `Cannot find module './photo-url'`

- [ ] **Step 3: Write the implementation**

Create `app/lib/photo-url.ts`:

```ts
export const SPOT_PHOTO_BUCKET = "spot-photos";

/**
 * Public URL for a stored photo.
 *
 * Built by hand rather than via `supabase.storage.getPublicUrl` so it can run
 * in a component with no Supabase client — the loader passes the base URL down
 * and the browser never needs one.
 */
export function photoUrl(supabaseUrl: string, storagePath: string | null): string | null {
  if (!storagePath) return null;
  const base = supabaseUrl.replace(/\/+$/, "");
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${SPOT_PHOTO_BUCKET}/${encoded}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/photo-url.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add app/lib/photo-url.ts app/lib/photo-url.test.ts
git commit -m "feat: build public URLs for stored spot photos"
```

---

## Task 5: Seed Grand Rapids

Milestone 2 needs something to look at. This seeds real spots with real photos so the map is not empty.

**Files:**
- Create: `scripts/seed-grand-rapids.ts`
- Modify: `package.json` (add `seed` script)

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-grand-rapids.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SPOT_PHOTO_BUCKET } from "../app/lib/photo-url";

/**
 * Development seed. Real Grand Rapids locations with plausible metadata, so the
 * explore view has something in it before submission exists (plan 3).
 *
 * Photos are generated SVGs rather than downloads: the script must work offline
 * and must not embed anyone's copyrighted work in the repo.
 */
interface SeedSpot {
  name: string;
  lng: number;
  lat: number;
  description: string;
  shootTypes: string[];
  walkMinutes: number;
  terrain: string[];
  accessibility: string[];
  costType: string;
  hue: number;
}

const SPOTS: SeedSpot[] = [
  {
    name: "Millennium Park Meadow",
    lng: -85.7267, lat: 42.9214,
    description: "Wide open meadow with long sightlines. Best an hour before sunset.",
    shootTypes: ["family", "engagement"],
    walkMinutes: 12, terrain: ["gravel", "grass"],
    accessibility: ["restrooms", "stroller"], costType: "free", hue: 96,
  },
  {
    name: "Blue Bridge",
    lng: -85.6784, lat: 42.9636,
    description: "Steel pedestrian bridge over the Grand. Downtown skyline behind.",
    shootTypes: ["engagement", "senior-portrait"],
    walkMinutes: 2, terrain: ["paved"],
    accessibility: ["wheelchair", "stroller"], costType: "free", hue: 205,
  },
  {
    name: "John Ball Park Overlook",
    lng: -85.7011, lat: 42.9631,
    description: "Hilltop view over the west side. Steep path — not for grandparents.",
    shootTypes: ["senior-portrait"],
    walkMinutes: 15, terrain: ["steep", "grass"],
    accessibility: [], costType: "free", hue: 28,
  },
  {
    name: "Riverside Park Birches",
    lng: -85.6553, lat: 43.0123,
    description: "Stand of birches along the river path. Dappled light all afternoon.",
    shootTypes: ["family", "maternity"],
    walkMinutes: 6, terrain: ["paved", "grass"],
    accessibility: ["restrooms", "stroller", "shade"], costType: "free", hue: 140,
  },
  {
    name: "Ah-Nab-Awen Park",
    lng: -85.6742, lat: 42.9689,
    description: "Grass terraces by the river with the museum behind.",
    shootTypes: ["family", "engagement", "wedding"],
    walkMinutes: 3, terrain: ["paved", "grass"],
    accessibility: ["wheelchair", "stroller", "restrooms"], costType: "free", hue: 262,
  },
  {
    name: "Fish Ladder Park",
    lng: -85.6771, lat: 42.9760,
    description: "Concrete sculpture and rushing water. Loud, but the texture is worth it.",
    shootTypes: ["senior-portrait", "branding"],
    walkMinutes: 1, terrain: ["paved", "stairs"],
    accessibility: [], costType: "free", hue: 12,
  },
];

/** A deterministic placeholder image, so seeding needs no network. */
const svg = (label: string, hue: number, tone: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="hsl(${hue} 45% ${tone}%)"/>
    <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 35% ${Math.max(tone - 22, 12)}%)"/>
  </gradient></defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <text x="40" y="560" font-family="system-ui,sans-serif" font-size="34" fill="rgba(255,255,255,.92)">${label}</text>
</svg>`;

async function uploadPhoto(
  supabase: SupabaseClient,
  path: string,
  label: string,
  hue: number,
  tone: number,
): Promise<void> {
  const { error } = await supabase.storage
    .from(SPOT_PHOTO_BUCKET)
    .upload(path, new Blob([svg(label, hue, tone)], { type: "image/svg+xml" }), {
      contentType: "image/svg+xml",
      upsert: true,
    });
  if (error) throw error;
}

export async function seed(supabase: SupabaseClient): Promise<number> {
  const email = "seed@photospots.local";

  // Reuse the seed author across runs so re-seeding does not pile up users.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("display_name", "Photospots Seed")
    .maybeSingle();

  let authorId = existing?.id as string | undefined;
  if (!authorId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { display_name: "Photospots Seed" },
    });
    if (error) throw error;
    authorId = data.user!.id;
  }

  const { data: types, error: typeError } = await supabase.from("shoot_types").select("id, slug");
  if (typeError) throw typeError;
  const typeId = new Map((types ?? []).map((t) => [t.slug as string, t.id as number]));

  let created = 0;
  for (const s of SPOTS) {
    const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const { data: already } = await supabase
      .from("spots")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (already) continue;

    const { data: spot, error } = await supabase
      .from("spots")
      .insert({
        kind: "outdoor",
        name: s.name,
        slug,
        description: s.description,
        location: `POINT(${s.lng} ${s.lat})`,
        created_by: authorId,
        locality: "Grand Rapids",
        region: "MI",
        walk_minutes: s.walkMinutes,
        terrain: s.terrain,
        accessibility: s.accessibility,
        cost_type: s.costType,
      })
      .select("id")
      .single();
    if (error) throw error;

    await supabase.from("spot_shoot_types").insert(
      s.shootTypes
        .filter((slug) => typeId.has(slug))
        .map((slug) => ({ spot_id: spot!.id, shoot_type_id: typeId.get(slug)! })),
    );

    const scoutPath = `${spot!.id}/scouting.svg`;
    const sessionPath = `${spot!.id}/session.svg`;
    await uploadPhoto(supabase, scoutPath, `${s.name} — scouting`, s.hue, 46);
    await uploadPhoto(supabase, sessionPath, `${s.name} — session`, s.hue, 62);

    await supabase.from("photos").insert([
      { spot_id: spot!.id, profile_id: authorId, kind: "scouting", storage_path: scoutPath },
      {
        spot_id: spot!.id,
        profile_id: authorId,
        kind: "session",
        storage_path: sessionPath,
        rights_attested: true,
        credit_name: "Photospots Seed",
      },
    ]);

    created += 1;
  }

  return created;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const created = await seed(supabase);
  console.log(`Seeded ${created} spots.`);
}

if (process.argv[1]?.endsWith("seed-grand-rapids.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Add the npm script**

Add to `package.json` `"scripts"`:

```json
"seed": "tsx --env-file-if-exists=.env scripts/seed-grand-rapids.ts"
```

`--env-file-if-exists` for the same reason as `backfill:scores`: nothing else loads `.env` for a CLI run.

- [ ] **Step 3: Run it**

```bash
npm run seed
```

Expected: `Seeded 6 spots.`

- [ ] **Step 4: Verify it is idempotent**

```bash
npm run seed
```

Expected: `Seeded 0 spots.` — re-running must not duplicate spots or create a second seed user.

- [ ] **Step 5: Verify the RPC now returns them with covers**

```bash
npm run backfill:scores && npm run refresh:hot
```

Then check the viewport query returns six spots, each with a cover photo:

```bash
node --input-type=module -e "
const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/rpc/spots_in_viewport', {
  method: 'POST',
  headers: { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_west: -85.8, p_south: 42.85, p_east: -85.55, p_north: 43.05 }),
});
const rows = await r.json();
console.log(rows.length + ' spots; covers: ' + rows.filter(s => s.cover_photo_path).length);
"
```

Expected: `6 spots; covers: 6`

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-grand-rapids.ts package.json
git commit -m "feat: seed Grand Rapids spots with placeholder photos"
```

---

## Task 6: The map component

**Files:**
- Create: `app/components/map/SpotMap.tsx`
- Test: `app/components/map/SpotMap.test.tsx`
- Modify: `package.json` (add `maplibre-gl`)

- [ ] **Step 1: Install MapLibre**

```bash
npm install maplibre-gl
```

- [ ] **Step 2: Write the failing test**

The map itself needs a real canvas, which jsdom does not provide. What is worth testing is the **props contract** — that the component computes the right marker set and reports viewport changes in the shape the rest of the app expects. Both live in exported pure helpers.

Create `app/components/map/SpotMap.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { markersFor, boundsFromMap, type MapLike } from "./SpotMap";
import type { SpotSummary } from "~/data/spots";

const spot = (over: Partial<SpotSummary> = {}): SpotSummary => ({
  id: "1",
  name: "A Spot",
  slug: "a-spot",
  kind: "outdoor",
  position: { lat: 42.95, lng: -85.68 },
  locality: "Grand Rapids",
  region: "MI",
  score: 3,
  hotScore: 1,
  commentCount: 0,
  photoCount: 2,
  coverPhotoPath: null,
  coverCreditName: null,
  ...over,
});

describe("markersFor", () => {
  it("gives one marker per spot", () => {
    expect(markersFor([spot({ id: "1" }), spot({ id: "2", slug: "b" })])).toHaveLength(2);
  });

  it("carries the slug so a click can navigate", () => {
    expect(markersFor([spot()])[0].slug).toBe("a-spot");
  });

  it("distinguishes studios from outdoor spots", () => {
    const [outdoor] = markersFor([spot({ kind: "outdoor" })]);
    const [studio] = markersFor([spot({ kind: "studio" })]);
    expect(outdoor.className).not.toBe(studio.className);
  });

  it("marks the selected spot so the map and list stay in sync", () => {
    const [m] = markersFor([spot({ slug: "a-spot" })], "a-spot");
    expect(m.selected).toBe(true);
  });

  it("returns nothing for no spots", () => {
    expect(markersFor([])).toEqual([]);
  });
});

describe("boundsFromMap", () => {
  const map: MapLike = {
    getBounds: () => ({ getWest: () => -86, getSouth: () => 42, getEast: () => -85, getNorth: () => 43 }),
    getZoom: () => 11.7,
  };

  it("reads the viewport in the app's Bounds shape", () => {
    expect(boundsFromMap(map).viewport).toEqual({ west: -86, south: 42, east: -85, north: 43 });
  });

  // Map libraries report fractional zoom during pinch. snapBoundsToGrid handles
  // that correctly, but the URL should carry a tidy integer.
  it("rounds the zoom", () => {
    expect(boundsFromMap(map).zoom).toBe(12);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run app/components/map/SpotMap.test.tsx`
Expected: FAIL — `Cannot find module './SpotMap'`

- [ ] **Step 4: Write the component**

Create `app/components/map/SpotMap.tsx`:

```tsx
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Bounds } from "~/domain/geo/bounds";
import type { SpotSummary } from "~/data/spots";

export interface SpotMarker {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  className: string;
  selected: boolean;
}

/** The subset of the MapLibre API this module reads, so it can be tested without a canvas. */
export interface MapLike {
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
  getZoom(): number;
}

export function markersFor(spots: SpotSummary[], selectedSlug?: string): SpotMarker[] {
  return spots.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    lat: s.position.lat,
    lng: s.position.lng,
    className: s.kind === "studio" ? "spot-pin spot-pin--studio" : "spot-pin",
    selected: s.slug === selectedSlug,
  }));
}

export function boundsFromMap(map: MapLike): { viewport: Bounds; zoom: number } {
  const b = map.getBounds();
  return {
    viewport: {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    },
    zoom: Math.round(map.getZoom()),
  };
}

export interface SpotMapProps {
  spots: SpotSummary[];
  viewport: Bounds;
  zoom: number;
  styleUrl: string;
  selectedSlug?: string;
  onViewportChange: (next: { viewport: Bounds; zoom: number }) => void;
  onSelect: (slug: string) => void;
}

/**
 * Knows nothing about fetching. It takes spots and emits viewport changes;
 * the route decides what to do with them. That keeps the fiddliest piece of the
 * app swappable and testable through `markersFor` / `boundsFromMap`.
 */
export function SpotMap({
  spots,
  viewport,
  zoom,
  styleUrl,
  selectedSlug,
  onViewportChange,
  onSelect,
}: SpotMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: styleUrl,
      bounds: [
        [viewport.west, viewport.south],
        [viewport.east, viewport.north],
      ],
      attributionControl: { compact: true },
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // `moveend` rather than `move`: one event per gesture instead of one per
    // frame. Snapping to the grid then means small pans reuse the same query.
    instance.on("moveend", () => onViewportChangeRef.current(boundsFromMap(instance)));

    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
    // Mount once. Later prop changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    for (const m of markers.current) m.remove();
    markers.current = markersFor(spots, selectedSlug).map((marker) => {
      const el = document.createElement("button");
      el.className = marker.className + (marker.selected ? " spot-pin--selected" : "");
      el.type = "button";
      el.setAttribute("aria-label", marker.name);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect(marker.slug);
      });
      return new maplibregl.Marker({ element: el })
        .setLngLat([marker.lng, marker.lat])
        .addTo(instance);
    });
  }, [spots, selectedSlug, onSelect]);

  return <div ref={container} className="spot-map" data-testid="spot-map" />;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run app/components/map/SpotMap.test.tsx`
Expected: PASS — 7 tests

Note the unit project's glob already covers `*.test.tsx` (set in plan 1, Task 1).

- [ ] **Step 6: Commit**

```bash
git add app/components/map package.json package-lock.json
git commit -m "feat: add MapLibre spot map with a testable props contract"
```

---

## Task 7: Result card

**Files:**
- Create: `app/components/explore/SpotCard.tsx`
- Test: `app/components/explore/SpotCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/components/explore/SpotCard.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { cardSummaryLine } from "./SpotCard";
import type { SpotSummary } from "~/data/spots";

const spot = (over: Partial<SpotSummary> = {}): SpotSummary => ({
  id: "1",
  name: "Millennium Park Meadow",
  slug: "millennium-park-meadow",
  kind: "outdoor",
  position: { lat: 42.92, lng: -85.72 },
  locality: "Grand Rapids",
  region: "MI",
  score: 12.5,
  hotScore: 3,
  commentCount: 4,
  photoCount: 2,
  coverPhotoPath: null,
  coverCreditName: null,
  ...over,
});

describe("cardSummaryLine", () => {
  it("shows locality and region", () => {
    expect(cardSummaryLine(spot())).toContain("Grand Rapids, MI");
  });

  it("omits the location when it is unknown, without leaving a stray comma", () => {
    const line = cardSummaryLine(spot({ locality: null, region: null }));
    expect(line).not.toContain(",");
    expect(line.startsWith(" ")).toBe(false);
  });

  it("counts photos and comments", () => {
    const line = cardSummaryLine(spot({ photoCount: 3, commentCount: 1 }));
    expect(line).toContain("3 photos");
    expect(line).toContain("1 comment");
  });

  it("uses singular for one photo", () => {
    expect(cardSummaryLine(spot({ photoCount: 1 }))).toContain("1 photo");
    expect(cardSummaryLine(spot({ photoCount: 1 }))).not.toContain("1 photos");
  });

  it("omits zero counts rather than showing '0 comments'", () => {
    const line = cardSummaryLine(spot({ commentCount: 0, photoCount: 0 }));
    expect(line).not.toContain("0");
  });

  it("marks a studio", () => {
    expect(cardSummaryLine(spot({ kind: "studio" }))).toContain("Studio");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/components/explore/SpotCard.test.tsx`
Expected: FAIL — `Cannot find module './SpotCard'`

- [ ] **Step 3: Write the component**

Create `app/components/explore/SpotCard.tsx`:

```tsx
import { Link } from "react-router";
import type { SpotSummary } from "~/data/spots";
import { photoUrl } from "~/lib/photo-url";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Everything under the name, assembled so empty fields leave no punctuation behind. */
export function cardSummaryLine(spot: SpotSummary): string {
  const parts: string[] = [];
  if (spot.kind === "studio") parts.push("Studio");

  const place = [spot.locality, spot.region].filter(Boolean).join(", ");
  if (place) parts.push(place);

  if (spot.photoCount > 0) parts.push(plural(spot.photoCount, "photo", "photos"));
  if (spot.commentCount > 0) parts.push(plural(spot.commentCount, "comment", "comments"));

  return parts.join(" · ");
}

export interface SpotCardProps {
  spot: SpotSummary;
  supabaseUrl: string;
  selected?: boolean;
  variant?: "row" | "tile";
  onHover?: (slug: string | null) => void;
}

export function SpotCard({
  spot,
  supabaseUrl,
  selected = false,
  variant = "row",
  onHover,
}: SpotCardProps) {
  const cover = photoUrl(supabaseUrl, spot.coverPhotoPath);

  return (
    <Link
      to={`/spots/${spot.slug}`}
      className={`spot-card spot-card--${variant}${selected ? " spot-card--selected" : ""}`}
      onMouseEnter={() => onHover?.(spot.slug)}
      onMouseLeave={() => onHover?.(null)}
      aria-current={selected ? "true" : undefined}
    >
      {cover ? (
        <img className="spot-card__image" src={cover} alt="" loading="lazy" />
      ) : (
        <div className="spot-card__image spot-card__image--empty" aria-hidden="true" />
      )}
      <div className="spot-card__body">
        <h3 className="spot-card__name">{spot.name}</h3>
        <p className="spot-card__summary">{cardSummaryLine(spot)}</p>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/components/explore/SpotCard.test.tsx`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add app/components/explore/SpotCard.tsx app/components/explore/SpotCard.test.tsx
git commit -m "feat: add spot result card"
```

---

## Task 8: Explore layout

Three arrangements of the same two components (spec §8). All three are built because the plan-1 brainstorm settled on shipping all of them, with split as the default.

**Files:**
- Create: `app/components/explore/ExploreLayout.tsx`
- Test: `app/components/explore/ExploreLayout.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/components/explore/ExploreLayout.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { layoutClass, photoDepthFor } from "./ExploreLayout";

describe("layoutClass", () => {
  it("gives each view its own class", () => {
    const classes = [layoutClass("split"), layoutClass("map"), layoutClass("gallery")];
    expect(new Set(classes).size).toBe(3);
  });

  it("names the view in the class so CSS can target it", () => {
    expect(layoutClass("gallery")).toContain("gallery");
  });
});

describe("photoDepthFor", () => {
  // Gallery shows large images; split shows one thumbnail per row. Fetching the
  // same depth for both either starves the gallery or over-fetches the split.
  it("asks for more results in gallery than in split", () => {
    expect(photoDepthFor("gallery")).toBeGreaterThan(photoDepthFor("split"));
  });

  it("asks for the most in map view, where pins are cheap", () => {
    expect(photoDepthFor("map")).toBeGreaterThanOrEqual(photoDepthFor("split"));
  });

  it("never asks for more than the RPC will return", () => {
    for (const view of ["split", "map", "gallery"] as const) {
      expect(photoDepthFor(view)).toBeLessThanOrEqual(500);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/components/explore/ExploreLayout.test.tsx`
Expected: FAIL — `Cannot find module './ExploreLayout'`

- [ ] **Step 3: Write the component**

Create `app/components/explore/ExploreLayout.tsx`:

```tsx
import type { ReactNode } from "react";
import type { ExploreView } from "~/domain/filters/explore-filters";

export function layoutClass(view: ExploreView): string {
  return `explore explore--${view}`;
}

/**
 * How many spots to request for a view.
 *
 * Map view is pins only, so it can afford the most. Gallery renders large
 * images and scrolls, so it wants a healthy page. Split shows a narrow list
 * beside the map and needs the fewest. Capped by the RPC at 500.
 */
export function photoDepthFor(view: ExploreView): number {
  switch (view) {
    case "map":
      return 300;
    case "gallery":
      return 120;
    case "split":
      return 60;
  }
}

export interface ExploreLayoutProps {
  view: ExploreView;
  map: ReactNode;
  results: ReactNode;
  controls: ReactNode;
}

export function ExploreLayout({ view, map, results, controls }: ExploreLayoutProps) {
  return (
    <div className={layoutClass(view)}>
      <div className="explore__controls">{controls}</div>
      {view !== "gallery" && <div className="explore__map">{map}</div>}
      {view !== "map" && <div className="explore__results">{results}</div>}
      {view === "map" && <div className="explore__rail">{results}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/components/explore/ExploreLayout.test.tsx`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add app/components/explore/ExploreLayout.tsx app/components/explore/ExploreLayout.test.tsx
git commit -m "feat: add explore layout with three view arrangements"
```

---

## Task 9: The explore route

**Files:**
- Modify: `app/routes/home.tsx` (replace entirely)
- Modify: `app/lib/env.server.ts` (add the map style URL)
- Modify: `.env.example`
- Test: `app/lib/env.server.test.ts` (extend)

- [ ] **Step 1: Extend the env test**

Replace the contents of `app/lib/env.server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readEnv, DEFAULT_MAP_STYLE_URL } from "./env.server";

const valid = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon-key",
};

describe("readEnv", () => {
  it("returns the parsed values", () => {
    expect(readEnv(valid)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "anon-key",
      mapStyleUrl: DEFAULT_MAP_STYLE_URL,
    });
  });

  it("names the missing variable so the failure is actionable", () => {
    expect(() => readEnv({ SUPABASE_URL: "http://x" })).toThrow(/SUPABASE_ANON_KEY/);
  });

  it("rejects a malformed URL", () => {
    expect(() => readEnv({ ...valid, SUPABASE_URL: "not-a-url" })).toThrow();
  });

  it("accepts a custom map style", () => {
    const env = readEnv({ ...valid, MAP_STYLE_URL: "https://tiles.example/style.json" });
    expect(env.mapStyleUrl).toBe("https://tiles.example/style.json");
  });

  it("rejects a malformed map style URL rather than silently falling back", () => {
    expect(() => readEnv({ ...valid, MAP_STYLE_URL: "nonsense" })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/lib/env.server.test.ts`
Expected: FAIL — `DEFAULT_MAP_STYLE_URL` is not exported

- [ ] **Step 3: Update the env module**

Replace the contents of `app/lib/env.server.ts`:

```ts
import { z } from "zod";

/**
 * MapLibre's free demo tiles. Fine for development; production should set
 * MAP_STYLE_URL to a real provider (spec §5 prefers Protomaps or MapTiler,
 * both of which bill flat rather than per map load).
 */
export const DEFAULT_MAP_STYLE_URL = "https://demotiles.maplibre.org/style.json";

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  MAP_STYLE_URL: z.string().url().optional(),
});

export interface Env {
  supabaseUrl: string;
  supabaseAnonKey: string;
  mapStyleUrl: string;
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
    mapStyleUrl: parsed.data.MAP_STYLE_URL ?? DEFAULT_MAP_STYLE_URL,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run app/lib/env.server.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Document the variable**

Append to `.env.example`:

```bash

# Optional. Defaults to MapLibre's demo tiles, which are for development only.
MAP_STYLE_URL=
```

- [ ] **Step 6: Write the route**

Replace the contents of `app/routes/home.tsx`:

```tsx
import { useCallback, useMemo, useState } from "react";
import { Form, Link, useSearchParams } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { readEnv } from "~/lib/env.server";
import { getCurrentProfile } from "~/data/profiles";
import { listSpotsInViewport, type SpotSummary } from "~/data/spots";
import {
  parseExploreFilters,
  filtersToSearchParams,
  type ExploreFilters,
} from "~/domain/filters/explore-filters";
import { snapBoundsToGrid } from "~/domain/geo/bounds";
import { SpotMap } from "~/components/map/SpotMap";
import { SpotCard } from "~/components/explore/SpotCard";
import { ExploreLayout, photoDepthFor } from "~/components/explore/ExploreLayout";
import type { Route } from "./+types/home";
import "maplibre-gl/dist/maplibre-gl.css";

export function meta() {
  return [
    { title: "Photospots — photography locations, mapped" },
    {
      name: "description",
      content: "A map of photography locations, cultivated by local photographers.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const env = readEnv();
  const url = new URL(request.url);
  const filters = parseExploreFilters(url.searchParams);

  // Snap before querying so small pans produce the identical bounding box and
  // the previous result can be reused (spec §10).
  const snapped = { ...filters, viewport: snapBoundsToGrid(filters.viewport, filters.zoom) };

  const [profile, spots, shootTypes] = await Promise.all([
    getCurrentProfile(supabase),
    listSpotsInViewport(supabase, snapped, photoDepthFor(filters.view)),
    supabase.from("shoot_types").select("id, slug, label").order("sort_order"),
  ]);

  return Response.json(
    {
      profile,
      spots,
      shootTypes: shootTypes.data ?? [],
      filters,
      supabaseUrl: env.supabaseUrl,
      mapStyleUrl: env.mapStyleUrl,
    },
    { headers },
  );
}

interface LoaderData {
  profile: { displayName: string } | null;
  spots: SpotSummary[];
  shootTypes: { id: number; slug: string; label: string }[];
  filters: ExploreFilters;
  supabaseUrl: string;
  mapStyleUrl: string;
}

export default function Explore({ loaderData }: Route.ComponentProps) {
  const { profile, spots, shootTypes, filters, supabaseUrl, mapStyleUrl } =
    loaderData as LoaderData;
  const [, setSearchParams] = useSearchParams();
  const [hovered, setHovered] = useState<string | null>(null);

  const update = useCallback(
    (next: Partial<ExploreFilters>) => {
      // replace: true so panning the map does not fill the back button with
      // every intermediate viewport.
      setSearchParams(filtersToSearchParams({ ...filters, ...next }), { replace: true });
    },
    [filters, setSearchParams],
  );

  const onViewportChange = useCallback(
    (next: { viewport: ExploreFilters["viewport"]; zoom: number }) => update(next),
    [update],
  );

  const onSelect = useCallback((slug: string) => setHovered(slug), []);

  const map = useMemo(
    () => (
      <SpotMap
        spots={spots}
        viewport={filters.viewport}
        zoom={filters.zoom}
        styleUrl={mapStyleUrl}
        selectedSlug={hovered ?? undefined}
        onViewportChange={onViewportChange}
        onSelect={onSelect}
      />
    ),
    [spots, filters.viewport, filters.zoom, mapStyleUrl, hovered, onViewportChange, onSelect],
  );

  const results =
    spots.length === 0 ? (
      <p className="explore__empty">
        No spots in view yet. Try zooming out, or clearing the filter.
      </p>
    ) : (
      <ul className="explore__list">
        {spots.map((spot) => (
          <li key={spot.id}>
            <SpotCard
              spot={spot}
              supabaseUrl={supabaseUrl}
              selected={hovered === spot.slug}
              variant={filters.view === "gallery" ? "tile" : "row"}
              onHover={setHovered}
            />
          </li>
        ))}
      </ul>
    );

  const controls = (
    <>
      <div className="explore__filters" role="group" aria-label="Shoot type">
        <button
          type="button"
          aria-pressed={filters.shootTypeId === null}
          onClick={() => update({ shootTypeId: null })}
        >
          All
        </button>
        {shootTypes.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={filters.shootTypeId === t.id}
            onClick={() => update({ shootTypeId: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="explore__views" role="group" aria-label="View">
        {(["split", "map", "gallery"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={filters.view === v}
            onClick={() => update({ view: v })}
          >
            {v}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={filters.sort === "hot"}
          onClick={() => update({ sort: filters.sort === "hot" ? "score" : "hot" })}
        >
          {filters.sort === "hot" ? "Hot" : "Best"}
        </button>
      </div>

      <div className="explore__account">
        {profile ? (
          <Form method="post" action="/auth/logout">
            <span>{profile.displayName}</span> <button type="submit">Sign out</button>
          </Form>
        ) : (
          <Link to="/auth/login">Sign in</Link>
        )}
      </div>
    </>
  );

  return <ExploreLayout view={filters.view} map={map} results={results} controls={controls} />;
}
```

- [ ] **Step 7: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0

- [ ] **Step 8: Commit**

```bash
git add app/routes/home.tsx app/lib/env.server.ts app/lib/env.server.test.ts .env.example
git commit -m "feat: add explore route with map, filters and view switching"
```

---

## Task 10: Spot detail page

**Files:**
- Create: `app/routes/spots.$slug.tsx`
- Modify: `app/routes.ts`

- [ ] **Step 1: Register the route**

Replace the contents of `app/routes.ts`:

```ts
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("spots/:slug", "routes/spots.$slug.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/callback", "routes/auth.callback.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
] satisfies RouteConfig;
```

- [ ] **Step 2: Write the route**

Create `app/routes/spots.$slug.tsx`:

```tsx
import { Link } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { readEnv } from "~/lib/env.server";
import { getSpotBySlug, type SpotDetail } from "~/data/spots";
import type { Route } from "./+types/spots.$slug";

export function meta({ data }: Route.MetaArgs) {
  const spot = (data as { spot?: SpotDetail } | undefined)?.spot;
  return [{ title: spot ? `${spot.name} — Photospots` : "Spot not found — Photospots" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const env = readEnv();
  const spot = await getSpotBySlug(supabase, params.slug);

  if (!spot) {
    // 404 rather than an empty page, so an unpublished or renamed spot is not
    // reported to search engines as a valid URL.
    throw new Response("Not found", { status: 404, headers });
  }

  return Response.json({ spot, supabaseUrl: env.supabaseUrl }, { headers });
}

/** Renders only the attributes that were filled in — most are nullable by design (spec §4.7). */
function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="spot-detail__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const list = (values: string[] | null) =>
  values && values.length > 0 ? values.join(", ") : null;

export default function SpotDetailPage({ loaderData }: Route.ComponentProps) {
  const { spot } = loaderData as { spot: SpotDetail; supabaseUrl: string };
  const place = [spot.locality, spot.region].filter(Boolean).join(", ");

  return (
    <main className="spot-detail">
      <p>
        <Link to="/">← Back to the map</Link>
      </p>

      <h1>{spot.name}</h1>
      {place && <p className="spot-detail__place">{place}</p>}
      {spot.description && <p className="spot-detail__description">{spot.description}</p>}

      <p className="spot-detail__signals">
        {spot.shootTypeUpvoteCount} upvotes · {spot.shootAgainYesCount} would shoot here again
        {spot.shootAgainNoCount > 0 && <> · {spot.shootAgainNoCount} would not</>}
      </p>

      <dl className="spot-detail__facts">
        <Detail label="Cost" value={spot.costType} />
        <Detail label="Cost notes" value={spot.costNotes} />
        <Detail label="Hours" value={spot.hoursNotes} />
        <Detail
          label="Walk from parking"
          value={spot.walkMinutes === null ? null : `${spot.walkMinutes} min`}
        />
        <Detail label="Parking" value={spot.parkingNotes} />
        <Detail label="Terrain" value={list(spot.terrain)} />
        <Detail label="Accessibility" value={list(spot.accessibility)} />
        <Detail label="Best light" value={list(spot.bestLight)} />
        <Detail label="Best seasons" value={list(spot.bestSeasons)} />
        <Detail
          label="Max group"
          value={spot.maxGroupSize === null ? null : String(spot.maxGroupSize)}
        />
        <Detail
          label="Dog friendly"
          value={spot.dogFriendly === null ? null : spot.dogFriendly ? "Yes" : "No"}
        />
      </dl>

      {spot.permitUrl && (
        <p>
          <a href={spot.permitUrl} rel="noreferrer noopener" target="_blank">
            Permit information
          </a>
        </p>
      )}

      <p className="spot-detail__pending">
        Photos, comments and voting arrive in the next milestone.
      </p>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="spot-detail">
      <h1>Spot not found</h1>
      <p>It may have been removed, or the link may be wrong.</p>
      <p>
        <Link to="/">← Back to the map</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0

- [ ] **Step 4: Commit**

```bash
git add app/routes/spots.\$slug.tsx app/routes.ts
git commit -m "feat: add spot detail page"
```

---

## Task 11: Styles

**Files:**
- Modify: `app/app.css`

- [ ] **Step 1: Append the explore styles**

Append to `app/app.css`:

```css
/* ---- Explore ---- */

.explore {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100dvh;
}
.explore__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid rgb(0 0 0 / 0.12);
}
.explore__filters,
.explore__views {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}
.explore__account {
  margin-left: auto;
}
.explore__controls button {
  padding: 0.25rem 0.7rem;
  border: 1px solid rgb(0 0 0 / 0.2);
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-transform: capitalize;
}
.explore__controls button[aria-pressed="true"] {
  background: #1f2937;
  color: white;
  border-color: #1f2937;
}

.explore--split {
  grid-template-columns: 1fr;
}
.explore--split .explore__map,
.explore--split .explore__results {
  min-height: 0;
}
@media (min-width: 768px) {
  .explore--split {
    grid-template-areas: "controls controls" "map results";
    grid-template-columns: 1.15fr 1fr;
  }
  .explore--split .explore__controls { grid-area: controls; }
  .explore--split .explore__map { grid-area: map; }
  .explore--split .explore__results { grid-area: results; overflow-y: auto; }
}

.explore--map .explore__map { min-height: 0; }
.explore--map .explore__rail {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding: 0.5rem;
  border-top: 1px solid rgb(0 0 0 / 0.12);
}
.explore--map .explore__rail .explore__list {
  display: flex;
  gap: 0.5rem;
}
.explore--map .explore__rail .spot-card { width: 190px; }

.explore--gallery .explore__results { overflow-y: auto; }
.explore--gallery .explore__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 0.75rem;
  padding: 0.75rem;
}

.explore__list { list-style: none; margin: 0; padding: 0; }
.explore__empty { padding: 2rem 1rem; opacity: 0.7; }

.spot-map { width: 100%; height: 100%; min-height: 320px; }

.spot-card {
  display: flex;
  gap: 0.6rem;
  padding: 0.5rem;
  text-decoration: none;
  color: inherit;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
}
.spot-card--tile { flex-direction: column; border: 1px solid rgb(0 0 0 / 0.1); border-radius: 8px; }
.spot-card--selected { background: rgb(31 41 55 / 0.07); }
.spot-card__image {
  width: 84px; height: 62px; object-fit: cover; border-radius: 5px; flex: none;
  background: rgb(0 0 0 / 0.08);
}
.spot-card--tile .spot-card__image { width: 100%; height: 150px; }
.spot-card__name { margin: 0; font-size: 0.95rem; }
.spot-card__summary { margin: 0.15rem 0 0; font-size: 0.8rem; opacity: 0.72; }

.spot-pin {
  width: 18px; height: 18px; border: 2px solid white; border-radius: 50% 50% 50% 2px;
  transform: rotate(-45deg); background: #4a8f5c; cursor: pointer; padding: 0;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
}
.spot-pin--studio { background: #c08a2e; }
.spot-pin--selected { box-shadow: 0 0 0 4px rgb(74 143 92 / 0.35); }

/* ---- Spot detail ---- */

.spot-detail { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
.spot-detail__place { opacity: 0.7; margin-top: -0.5rem; }
.spot-detail__signals { font-size: 0.9rem; opacity: 0.8; }
.spot-detail__facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; }
.spot-detail__facts dt { font-weight: 600; }
.spot-detail__facts dd { margin: 0; }
.spot-detail__fact { display: contents; }
.spot-detail__pending { margin-top: 2rem; opacity: 0.6; font-size: 0.9rem; }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add app/app.css
git commit -m "feat: style the explore views and spot detail"
```

---

## Task 12: Verify it end to end

The plan-1 auth task shipped two silent bugs that only a scripted check caught. Do the same here rather than eyeballing it.

**Files:** none — verification only.

- [ ] **Step 1: Reset, seed, and start**

```bash
npx supabase db reset && npm run seed && npm run backfill:scores
```

Expected: `Seeded 6 spots.` then `Recomputed 6 spot scores.`

Then start the dev server. It runs until killed, so background it rather than blocking the shell,
and wait for the port before curling anything:

```bash
npm run dev &
until curl -s -o /dev/null http://localhost:5173/; do sleep 1; done
```

- [ ] **Step 2: The explore page renders spots server-side**

```bash
curl -s http://localhost:5173/ | grep -c "Millennium Park Meadow"
```

Expected: at least `1`. Zero means the loader returned nothing — check that the seed ran and that the default viewport covers Grand Rapids.

- [ ] **Step 3: Filtering by shoot type changes the results**

```bash
for T in 1 7; do
  echo -n "type=$T -> "
  curl -s "http://localhost:5173/?type=$T" | grep -o 'href="/spots/[^"]*"' | sort -u | wc -l
done
```

Expected: `type=1` (family) returns **3** spots, `type=7` (wedding) returns **1**. Count distinct
`/spots/` links rather than `grep -c "spot-card"` — the latter counts matching *lines*, and each card
emits several `spot-card__*` classes, so it would not equal the number of results.

- [ ] **Step 4: A viewport away from Grand Rapids shows the empty state**

```bash
curl -s "http://localhost:5173/?w=10&s=10&e=11&n=11" | grep -c "No spots in view"
```

Expected: `1`

- [ ] **Step 5: A malformed URL falls back rather than erroring**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5173/?w=abc&view=hologram&sort=vibes&type=nonsense"
```

Expected: `200`

- [ ] **Step 6: The gallery view renders**

```bash
curl -s "http://localhost:5173/?view=gallery" | grep -c "explore--gallery"
```

Expected: `1`

- [ ] **Step 7: Spot detail renders and 404s correctly**

```bash
curl -s http://localhost:5173/spots/millennium-park-meadow | grep -c "Millennium Park Meadow"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/spots/no-such-spot
```

Expected: at least `1`, then `404`.

- [ ] **Step 8: Cover photos resolve**

```bash
node --input-type=module -e "
const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/rpc/spots_in_viewport', {
  method: 'POST',
  headers: { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_west: -85.8, p_south: 42.85, p_east: -85.55, p_north: 43.05 }),
});
const [first] = await r.json();
const url = process.env.SUPABASE_URL + '/storage/v1/object/public/spot-photos/' + first.cover_photo_path;
const img = await fetch(url);
console.log('cover HTTP ' + img.status + ' ' + img.headers.get('content-type'));
"
```

Expected: `cover HTTP 200 image/svg+xml`. Anything else means the bucket is not public or the path is wrong.

- [ ] **Step 9: Stop the dev server and run everything**

```bash
npm test && npm run typecheck && npm run build
```

Expected: all pass.

- [ ] **Step 10: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found in end-to-end explore verification"
```

---

## Task 13: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

- Change the Status table: explore is done; next is contribution (submission, photo upload, voting).
- Add `npm run seed` to the commands table: "Seed Grand Rapids spots with placeholder photos".
- Add `app/components/` to the Layout block.
- Mention `MAP_STYLE_URL` in Setup — optional, defaults to MapLibre's demo tiles which are development-only.

Verify every path, script and URL the README names actually exists before committing. Two false claims slipped through last time.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for the explore milestone"
```

---

## Done when

- `npm test` passes, with the new unit tests running without Docker
- `npm run typecheck` and `npm run build` are clean
- `npx supabase db reset && npm run seed` produces six spots with cover photos
- The explore page server-renders spot names, and filtering by shoot type changes the results
- A viewport with no spots shows the empty state instead of an error
- A URL with nonsense in every parameter returns 200 and falls back to Grand Rapids
- All three views render
- `/spots/millennium-park-meadow` renders; an unknown slug returns 404
- A cover photo URL returns HTTP 200 with an image content type

## Not in this plan

Submission, photo upload, voting, and comments are plan 3 onward. The detail page says so rather than showing empty sections.

**Tile failures are handled by the architecture rather than by code.** Spec §10 requires that a
failed tile source must not take the page down. Because `SpotMap` receives spots as props and the
list, filters and detail pages render from loader data, a style URL that fails to load leaves an
empty map container while everything else still works. Confirm this during Task 12 by pointing
`MAP_STYLE_URL` at a bad URL and checking the page still returns 200 with results listed — if it
throws instead, add an `error` handler on the map instance.

Two things deliberately deferred:

- **Aborting in-flight viewport queries.** Spec §10 wants stale responses discarded on a new pan. React Router's navigation already supersedes loader results for the same route, so this is likely already handled — confirm it under a fast pan before adding machinery.
- **Server-side clustering at low zoom.** The RPC caps at 500 rows, which is enough until the map has more spots than that in one view.
