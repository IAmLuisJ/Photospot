# Photospots Contribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed-in people add spots — drop a pin, get asked "is it one of these?" before filling anything in, then a short form with photos — and edit what they submitted.

**Architecture:** Photos upload to Storage *first*, then a single `create_spot` RPC inserts the spot, its shoot types and its photo rows in one transaction. That ordering comes from spec §10: creating the spot first would let a failed upload leave a photo-less spot, which violates the one-photo rule. Because the spot does not exist at upload time, storage paths are keyed by uploader (`{auth.uid()}/{uuid}.ext`), not by spot. The photo cap is a database trigger rather than an application check, so it cannot be bypassed by calling the API directly.

**Tech Stack:** React Router v8 · Supabase (PostGIS, Storage, RLS) · Canvas API for client-side downscaling · Vitest

**Plan sequence:** Plan 3 of 6. Plans 1–2 are complete: schema, RLS, auth, the pure domain layer, and the read-only explore experience, with 188 passing tests.

**Spec:** `docs/superpowers/specs/2026-08-09-photospots-design.md` — §4.2 (two kinds of photo), §4.3 (photo rights), §9.1 (submission flow), §10 (partial submission).

**Commit convention:** every commit message ends with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## What plans 1–2 leave you

| Available | Where |
| --- | --- |
| `spots_within_meters(lng, lat, meters, kind)` — the duplicate check, granted to `authenticated` | migration 2 |
| `spots_in_viewport`, `spot_by_slug` | migration 7 |
| RLS insert policies on `spots`, `photos`, `spot_shoot_types`, `spot_gallery_links` | migration 5 |
| Column-scoped UPDATE on `spots` — `status` and `owner_profile_id` deliberately excluded | migration 5 |
| `spot-photos` bucket with a **public read** policy and nothing else | migration 7 |
| `listSpotsInViewport`, `getSpotBySlug`, `SpotSummary`, `SpotDetail` | `app/data/spots.ts` |
| `photoUrl`, `SPOT_PHOTO_BUCKET` | `app/lib/photo-url.ts` |
| `isWithinRadius`, `DUPLICATE_RADIUS_METERS` | `app/domain/geo/distance.ts` |

**Two gaps this plan closes, both verified against the running database:**

- **No one can upload.** `storage.objects` has exactly one policy, `for select`. There is no insert policy, so an authenticated upload fails.
- **Nothing enforces the photo cap.** Spec §4.2 caps hosted photos per spot; no trigger, constraint or check exists.

**Constraints carried forward. Each was a real bug once:**

1. `revoke execute … from public` before granting any new function — Postgres grants EXECUTE to PUBLIC by default.
2. Every object in a **bulk insert must carry the same keys** — PostgREST unions the keys and sets missing ones to `null`, bypassing column defaults.
3. Loaders return `data(obj, { headers })` from `react-router`, never `Response.json` — a raw Response is not type-inferable and `meta()` cannot read it.
4. Write `status = 'published'` explicitly in queries even though RLS enforces it.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260810000008_contribution.sql` | Storage write policy, photo cap trigger, `create_spot` RPC |
| `app/domain/spots/slug.ts` | Name → slug, with the collision strategy from spec §9.1 |
| `app/domain/spots/submission.ts` | Submission validation. Pure. |
| `app/data/spot-writes.ts` | Duplicate check, create, update, gallery links. Separate from `spots.ts`, which stays read-only. |
| `app/lib/photo-upload.client.ts` | Downscale in the browser, upload to Storage |
| `app/routes/submit.tsx` | Pin drop → duplicate check → form |
| `app/routes/spots.$slug.edit.tsx` | Edit a spot you submitted |

`spot-writes.ts` is deliberately separate from `spots.ts`: reads are called by every page, writes by two routes, and keeping them apart means the read path never accidentally imports a mutation.

---

## Task 1: Storage writes and the photo cap

**Files:**
- Create: `supabase/migrations/20260810000008_contribution.sql`
- Test: `tests/db/contribution-rules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/contribution-rules.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { MAX_PHOTOS_PER_KIND } from "../../app/domain/spots/submission";

let author: TestUser;
let spotId: string;

beforeAll(async () => {
  author = await createTestUser("Contributor");
  const { data } = await serviceClient()
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Cap Test Spot",
      slug: `cap-test-${Date.now()}`,
      location: "POINT(-85.68 42.95)",
      created_by: author.id,
    })
    .select("id")
    .single();
  spotId = data!.id;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  await deleteTestUser(author.id);
});

const addPhoto = (kind: "scouting" | "session", n: number) =>
  serviceClient().from("photos").insert({
    spot_id: spotId,
    profile_id: author.id,
    kind,
    storage_path: `${author.id}/${kind}-${n}-${Date.now()}-${Math.random()}.jpg`,
    rights_attested: kind === "session",
    credit_name: null,
  });

describe("photo cap", () => {
  it(`accepts up to ${MAX_PHOTOS_PER_KIND} scouting photos`, async () => {
    for (let i = 0; i < MAX_PHOTOS_PER_KIND; i++) {
      const { error } = await addPhoto("scouting", i);
      expect(error).toBeNull();
    }
  });

  it("rejects one past the cap", async () => {
    const { error } = await addPhoto("scouting", 99);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cap|limit|too many/i);
  });

  // The cap is per kind, so a full scouting set must not block session photos.
  it("counts each kind separately", async () => {
    const { error } = await addPhoto("session", 0);
    expect(error).toBeNull();
  });

  // Removed photos free a slot — otherwise a spot can be permanently jammed by
  // content an admin has already taken down.
  it("does not count removed photos toward the cap", async () => {
    await serviceClient()
      .from("photos")
      .update({ status: "removed" })
      .eq("spot_id", spotId)
      .eq("kind", "scouting")
      .neq("storage_path", "");

    const { error } = await addPhoto("scouting", 100);
    expect(error).toBeNull();
  });
});

describe("storage write policy", () => {
  it("lets a signed-in user upload under their own id", async () => {
    const { error } = await author.client.storage
      .from("spot-photos")
      .upload(`${author.id}/own-${Date.now()}.txt`, new Blob(["x"], { type: "text/plain" }));
    expect(error).toBeNull();
  });

  // Otherwise any signed-in user could scribble into anyone else's folder.
  it("refuses an upload under someone else's id", async () => {
    const { error } = await author.client.storage
      .from("spot-photos")
      .upload(`00000000-0000-0000-0000-000000000000/theirs-${Date.now()}.txt`, new Blob(["x"]));
    expect(error).not.toBeNull();
  });

  it("refuses an upload from a logged-out visitor", async () => {
    const { anonClient } = await import("./helpers");
    const { error } = await anonClient()
      .storage.from("spot-photos")
      .upload(`anon-${Date.now()}.txt`, new Blob(["x"]));
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/contribution-rules.test.ts`
Expected: FAIL — `Cannot find module '../../app/domain/spots/submission'`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810000008_contribution.sql`:

```sql
-- Uploads happen BEFORE the spot exists (spec §10: a failed upload must not be
-- able to leave a photo-less spot), so a path cannot be keyed by spot id.
-- Keying by uploader gives the policy something to check and stops one user
-- writing into another's folder.
create policy "signed-in users upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'spot-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users manage their own uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'spot-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Spec §4.2 caps hosted photos per spot. Enforced as a trigger rather than in
-- the command layer, so it holds for anything that reaches the table — the API
-- directly, a future import script, a careless migration.
--
-- Removed photos do not count: an admin takedown should free the slot rather
-- than jam the spot permanently.
create or replace function public.enforce_photo_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_cap constant integer := 6;
begin
  select count(*) into v_count
  from public.photos
  where spot_id = new.spot_id
    and kind = new.kind
    and status = 'published';

  if v_count >= v_cap then
    raise exception 'photo cap reached: at most % published % photos per spot', v_cap, new.kind
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger photos_enforce_cap
  before insert on public.photos
  for each row execute function public.enforce_photo_cap();

revoke execute on function public.enforce_photo_cap() from public;

-- One transaction for the spot, its shoot types and its photos (spec §10).
-- SECURITY INVOKER so RLS still decides who may write; the function supplies
-- atomicity, not privilege. created_by comes from auth.uid(), so a caller
-- cannot attribute a submission to someone else.
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
  p_photos jsonb
)
returns uuid
language plpgsql
security invoker
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
    kind, name, slug, description, location, created_by, locality, region
  )
  values (
    p_kind, p_name, p_slug, nullif(p_description, ''),
    extensions.st_point(p_lng, p_lat)::extensions.geography,
    auth.uid(), nullif(p_locality, ''), nullif(p_region, '')
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

revoke execute on function public.create_spot(text, public.spot_kind, double precision, double precision, text, text, text, text, integer[], jsonb) from public;
grant execute on function public.create_spot(text, public.spot_kind, double precision, double precision, text, text, text, text, integer[], jsonb) to authenticated;

-- Is a slug already taken? Callable by anyone signed in, so the submission form
-- can resolve a collision before it tries to insert.
create or replace function public.slug_exists(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.spots where slug = p_slug)
$$;

revoke execute on function public.slug_exists(text) from public;
grant execute on function public.slug_exists(text) to authenticated, service_role;
```

- [ ] **Step 4: Apply the migration**

```bash
npx supabase db reset
```

Expected: applies all eight migrations with no errors.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/db/contribution-rules.test.ts`
Expected: PASS — 7 tests.

**Ordering note:** this test imports `MAX_PHOTOS_PER_KIND` from `app/domain/spots/submission.ts`,
which **Task 3** creates. Do Tasks 2 and 3 first, then come back and run this step — the migration
itself has no dependency on them, so it can be written and applied now.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/db/contribution-rules.test.ts
git commit -m "feat: add storage write policy, photo cap and create_spot"
```

---

## Task 2: Slug generation

Spec §9.1: slugify the name; on collision append the slugified locality, then a short discriminator. "Millennium Park" genuinely recurs across cities, so collisions are the normal path, not an error case.

**Files:**
- Create: `app/domain/spots/slug.ts`
- Test: `app/domain/spots/slug.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/domain/spots/slug.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slugify, slugCandidates } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Millennium Park Meadow")).toBe("millennium-park-meadow");
  });

  it("strips punctuation", () => {
    expect(slugify("Ah-Nab-Awen Park!")).toBe("ah-nab-awen-park");
  });

  it("collapses runs of separators", () => {
    expect(slugify("Blue   Bridge  --  North")).toBe("blue-bridge-north");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  -- Fish Ladder --  ")).toBe("fish-ladder");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(slugify("Café Élan")).toBe("cafe-elan");
  });

  it("returns an empty string for input with nothing usable", () => {
    expect(slugify("!!! ???")).toBe("");
  });
});

describe("slugCandidates", () => {
  it("offers the bare name first", () => {
    expect(slugCandidates("Millennium Park", "Grand Rapids", "MI")[0]).toBe("millennium-park");
  });

  it("falls back to name-plus-locality", () => {
    expect(slugCandidates("Millennium Park", "Grand Rapids", "MI")[1]).toBe(
      "millennium-park-grand-rapids",
    );
  });

  it("then adds the region", () => {
    expect(slugCandidates("Millennium Park", "Grand Rapids", "MI")[2]).toBe(
      "millennium-park-grand-rapids-mi",
    );
  });

  it("ends with a discriminated candidate that differs each call", () => {
    const a = slugCandidates("Millennium Park", "Grand Rapids", "MI").at(-1)!;
    const b = slugCandidates("Millennium Park", "Grand Rapids", "MI").at(-1)!;
    expect(a).not.toBe(b);
    expect(a.startsWith("millennium-park-")).toBe(true);
  });

  it("skips locality steps when there is no locality", () => {
    const candidates = slugCandidates("Millennium Park", null, null);
    expect(candidates[0]).toBe("millennium-park");
    expect(candidates).toHaveLength(2);
  });

  // A name of pure punctuation must still produce something insertable, since
  // slug is NOT NULL and unique.
  it("still produces a usable slug for an unusable name", () => {
    const candidates = slugCandidates("!!!", null, null);
    expect(candidates.every((c) => c.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/domain/spots/slug.test.ts`
Expected: FAIL — `Cannot find module './slug'`

- [ ] **Step 3: Write the implementation**

Create `app/domain/spots/slug.ts`:

```ts
/**
 * A URL-safe slug.
 *
 * Accents are stripped rather than dropped, so "Café" becomes "cafe" and not
 * "caf" — losing a letter changes how the name reads.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Slugs to try, in order, until one is free.
 *
 * Spec §9.1: slugs are globally unique because `/spots/:slug` is a flat URL
 * space, and "Millennium Park" genuinely recurs across cities — so collision is
 * the normal path. The last candidate always carries a random discriminator, so
 * the list can never be exhausted.
 */
export function slugCandidates(
  name: string,
  locality: string | null,
  region: string | null,
): string[] {
  const base = slugify(name) || "spot";
  const candidates = [base];

  const localityPart = locality ? slugify(locality) : "";
  if (localityPart) {
    candidates.push(`${base}-${localityPart}`);
    const regionPart = region ? slugify(region) : "";
    if (regionPart) candidates.push(`${base}-${localityPart}-${regionPart}`);
  }

  candidates.push(`${base}-${Math.random().toString(36).slice(2, 8)}`);
  return candidates;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/domain/spots/slug.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add app/domain/spots/slug.ts app/domain/spots/slug.test.ts
git commit -m "feat: generate spot slugs with a collision strategy"
```

---

## Task 3: Submission validation

**Files:**
- Create: `app/domain/spots/submission.ts`
- Test: `app/domain/spots/submission.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/domain/spots/submission.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateSubmission,
  MAX_PHOTOS_PER_KIND,
  type SubmissionInput,
  type PhotoInput,
} from "./submission";

const photo = (over: Partial<PhotoInput> = {}): PhotoInput => ({
  storagePath: "user-id/abc.jpg",
  kind: "scouting",
  rightsAttested: false,
  creditName: null,
  creditUrl: null,
  caption: null,
  ...over,
});

const input = (over: Partial<SubmissionInput> = {}): SubmissionInput => ({
  name: "Millennium Park Meadow",
  kind: "outdoor",
  position: { lat: 42.92, lng: -85.72 },
  description: null,
  locality: "Grand Rapids",
  region: "MI",
  shootTypeIds: [1],
  photos: [photo()],
  ...over,
});

const errorsFor = (over: Partial<SubmissionInput>) => validateSubmission(input(over)).errors;

describe("validateSubmission", () => {
  it("accepts the minimum viable submission", () => {
    expect(validateSubmission(input()).errors).toEqual([]);
  });

  it("requires a name", () => {
    expect(errorsFor({ name: "   " })).toContainEqual({ field: "name", message: expect.any(String) });
  });

  it("rejects a name that is too long to render", () => {
    expect(errorsFor({ name: "x".repeat(121) }).some((e) => e.field === "name")).toBe(true);
  });

  it("requires at least one shoot type", () => {
    expect(errorsFor({ shootTypeIds: [] }).some((e) => e.field === "shootTypeIds")).toBe(true);
  });

  it("requires at least one photo", () => {
    expect(errorsFor({ photos: [] }).some((e) => e.field === "photos")).toBe(true);
  });

  // Spec §4.3, and the database enforces it too — but catching it in the form
  // means the user is told before uploading rather than after.
  it("requires a rights attestation on a session photo", () => {
    const errors = errorsFor({ photos: [photo({ kind: "session", rightsAttested: false })] });
    expect(errors.some((e) => e.field === "photos")).toBe(true);
  });

  it("accepts a session photo that is attested", () => {
    expect(errorsFor({ photos: [photo({ kind: "session", rightsAttested: true })] })).toEqual([]);
  });

  it("does not require an attestation on a scouting photo", () => {
    expect(errorsFor({ photos: [photo({ kind: "scouting", rightsAttested: false })] })).toEqual([]);
  });

  it("rejects more photos of one kind than the cap allows", () => {
    const tooMany = Array.from({ length: MAX_PHOTOS_PER_KIND + 1 }, (_, i) =>
      photo({ storagePath: `user-id/${i}.jpg` }),
    );
    expect(errorsFor({ photos: tooMany }).some((e) => e.field === "photos")).toBe(true);
  });

  it("counts the cap per kind, not across kinds", () => {
    const full = [
      ...Array.from({ length: MAX_PHOTOS_PER_KIND }, (_, i) =>
        photo({ storagePath: `s/${i}.jpg`, kind: "scouting" as const }),
      ),
      ...Array.from({ length: MAX_PHOTOS_PER_KIND }, (_, i) =>
        photo({ storagePath: `x/${i}.jpg`, kind: "session" as const, rightsAttested: true }),
      ),
    ];
    expect(errorsFor({ photos: full })).toEqual([]);
  });

  it("rejects a position outside the world", () => {
    expect(errorsFor({ position: { lat: 95, lng: 0 } }).some((e) => e.field === "position")).toBe(true);
    expect(errorsFor({ position: { lat: 0, lng: 200 } }).some((e) => e.field === "position")).toBe(true);
  });

  it("reports every problem at once rather than one at a time", () => {
    const errors = errorsFor({ name: "", shootTypeIds: [], photos: [] });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/domain/spots/submission.test.ts`
Expected: FAIL — `Cannot find module './submission'`

- [ ] **Step 3: Write the implementation**

Create `app/domain/spots/submission.ts`:

```ts
import type { LatLng } from "../geo/distance";

/** Spec §4.2. The database enforces the same number in a trigger. */
export const MAX_PHOTOS_PER_KIND = 6;

const MAX_NAME_LENGTH = 120;

export type PhotoKind = "scouting" | "session";

export interface PhotoInput {
  storagePath: string;
  kind: PhotoKind;
  rightsAttested: boolean;
  creditName: string | null;
  creditUrl: string | null;
  caption: string | null;
}

export interface SubmissionInput {
  name: string;
  kind: "outdoor" | "studio";
  position: LatLng;
  description: string | null;
  locality: string | null;
  region: string | null;
  shootTypeIds: number[];
  photos: PhotoInput[];
}

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationResult {
  errors: FieldError[];
}

/**
 * Collects every problem rather than stopping at the first, so the form can
 * show them all at once instead of making the user resubmit repeatedly.
 *
 * This duplicates rules the database also enforces. That is deliberate: the
 * database is the authority, but a user should be told what is wrong before
 * uploading photos, not after.
 */
export function validateSubmission(input: SubmissionInput): ValidationResult {
  const errors: FieldError[] = [];

  if (input.name.trim().length === 0) {
    errors.push({ field: "name", message: "Give the spot a name." });
  } else if (input.name.trim().length > MAX_NAME_LENGTH) {
    errors.push({ field: "name", message: `Keep the name under ${MAX_NAME_LENGTH} characters.` });
  }

  const { lat, lng } = input.position;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    errors.push({ field: "position", message: "Drop the pin on the map." });
  }

  if (input.shootTypeIds.length === 0) {
    errors.push({ field: "shootTypeIds", message: "Pick at least one kind of shoot." });
  }

  if (input.photos.length === 0) {
    errors.push({ field: "photos", message: "Add at least one photo." });
  }

  const unattested = input.photos.filter((p) => p.kind === "session" && !p.rightsAttested);
  if (unattested.length > 0) {
    errors.push({
      field: "photos",
      message: "Confirm you shot each session photo and have the right to post it.",
    });
  }

  for (const kind of ["scouting", "session"] as const) {
    if (input.photos.filter((p) => p.kind === kind).length > MAX_PHOTOS_PER_KIND) {
      errors.push({
        field: "photos",
        message: `At most ${MAX_PHOTOS_PER_KIND} ${kind} photos. Link a full gallery instead.`,
      });
    }
  }

  return { errors };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/domain/spots/submission.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Run the database rules test, which imports this module**

Run: `npx vitest run tests/db/contribution-rules.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add app/domain/spots/submission.ts app/domain/spots/submission.test.ts
git commit -m "feat: validate spot submissions before upload"
```

---

## Task 4: Write-side data layer

**Files:**
- Create: `app/data/spot-writes.ts`
- Test: `tests/db/spot-writes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/spot-writes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  findNearbyDuplicates,
  resolveSlug,
  createSpot,
  addGalleryLink,
} from "../../app/data/spot-writes";
import { serviceClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";

let author: TestUser;
let familyTypeId: number;
const created: string[] = [];

beforeAll(async () => {
  author = await createTestUser("Writer");
  const { data } = await serviceClient()
    .from("shoot_types")
    .select("id")
    .eq("slug", "family")
    .single();
  familyTypeId = data!.id;
});

afterAll(async () => {
  for (const id of created) await serviceClient().from("spots").delete().eq("id", id);
  await deleteTestUser(author.id);
});

const submission = (name: string) => ({
  name,
  kind: "outdoor" as const,
  position: { lat: 42.95, lng: -85.68 },
  description: "A test spot.",
  locality: "Grand Rapids",
  region: "MI",
  shootTypeIds: [familyTypeId],
  photos: [
    {
      storagePath: `${author.id}/${crypto.randomUUID()}.jpg`,
      kind: "scouting" as const,
      rightsAttested: false,
      creditName: null,
      creditUrl: null,
      caption: null,
    },
  ],
});

describe("createSpot", () => {
  it("creates the spot, its shoot types and its photos in one call", async () => {
    const id = await createSpot(author.client, submission("Write Test Spot"), "write-test-spot");
    created.push(id);

    const db = serviceClient();
    const { data: spot } = await db.from("spots").select("name, created_by").eq("id", id).single();
    expect(spot!.name).toBe("Write Test Spot");
    expect(spot!.created_by).toBe(author.id);

    const { data: types } = await db.from("spot_shoot_types").select("shoot_type_id").eq("spot_id", id);
    expect(types).toHaveLength(1);

    const { data: photos } = await db.from("photos").select("id").eq("spot_id", id);
    expect(photos).toHaveLength(1);
  });

  it("attributes the spot to the caller even if asked otherwise", async () => {
    const id = await createSpot(author.client, submission("Attribution Test"), "attribution-test");
    created.push(id);
    const { data } = await serviceClient().from("spots").select("created_by").eq("id", id).single();
    expect(data!.created_by).toBe(author.id);
  });

  // Spec §10: the whole reason this is one RPC. A rejected photo must not leave
  // a spot behind.
  it("leaves nothing behind when a photo is rejected", async () => {
    const bad = {
      ...submission("Rollback Test"),
      photos: [
        {
          storagePath: `${author.id}/${crypto.randomUUID()}.jpg`,
          kind: "session" as const,
          rightsAttested: false, // violates the database check
          creditName: null,
          creditUrl: null,
          caption: null,
        },
      ],
    };

    await expect(createSpot(author.client, bad, "rollback-test")).rejects.toThrow();

    const { data } = await serviceClient()
      .from("spots")
      .select("id")
      .eq("slug", "rollback-test")
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("refuses a submission with no photos", async () => {
    const none = { ...submission("No Photos"), photos: [] };
    await expect(createSpot(author.client, none, "no-photos")).rejects.toThrow();
  });
});

describe("findNearbyDuplicates", () => {
  it("finds a spot of the same kind within the radius", async () => {
    const id = await createSpot(author.client, submission("Duplicate Target"), "duplicate-target");
    created.push(id);

    const near = await findNearbyDuplicates(author.client, { lat: 42.9505, lng: -85.68 }, "outdoor");
    expect(near.map((s) => s.name)).toContain("Duplicate Target");
  });

  it("does not offer a studio for an outdoor pin", async () => {
    const near = await findNearbyDuplicates(author.client, { lat: 42.9505, lng: -85.68 }, "studio");
    expect(near.map((s) => s.name)).not.toContain("Duplicate Target");
  });

  it("returns the distance so the prompt can say how far away it is", async () => {
    const near = await findNearbyDuplicates(author.client, { lat: 42.9505, lng: -85.68 }, "outdoor");
    expect(near[0].distanceMeters).toBeGreaterThan(0);
    expect(near[0].distanceMeters).toBeLessThan(200);
  });

  it("returns nothing in empty country", async () => {
    expect(await findNearbyDuplicates(author.client, { lat: 10, lng: 10 }, "outdoor")).toEqual([]);
  });
});

describe("resolveSlug", () => {
  it("returns the bare slug when it is free", async () => {
    const slug = await resolveSlug(author.client, "Totally Unused Name", "Grand Rapids", "MI");
    expect(slug).toBe("totally-unused-name");
  });

  it("falls through to a variant when the bare slug is taken", async () => {
    const id = await createSpot(author.client, submission("Taken Name"), "taken-name");
    created.push(id);

    const slug = await resolveSlug(author.client, "Taken Name", "Grand Rapids", "MI");
    expect(slug).not.toBe("taken-name");
    expect(slug.startsWith("taken-name")).toBe(true);
  });
});

describe("addGalleryLink", () => {
  it("attaches a link to a spot", async () => {
    const id = await createSpot(author.client, submission("Gallery Host"), "gallery-host");
    created.push(id);

    await addGalleryLink(author.client, id, "https://example.com/gallery", "Autumn session");
    const { data } = await serviceClient()
      .from("spot_gallery_links")
      .select("url, title")
      .eq("spot_id", id);
    expect(data).toHaveLength(1);
    expect(data![0].url).toBe("https://example.com/gallery");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/spot-writes.test.ts`
Expected: FAIL — `Cannot find module '../../app/data/spot-writes'`

- [ ] **Step 3: Write the implementation**

Create `app/data/spot-writes.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LatLng } from "../domain/geo/distance";
import { DUPLICATE_RADIUS_METERS } from "../domain/geo/distance";
import { slugCandidates } from "../domain/spots/slug";
import type { SubmissionInput } from "../domain/spots/submission";
import type { SpotKind } from "./spots";

export interface NearbySpot {
  id: string;
  name: string;
  slug: string;
  kind: SpotKind;
  locality: string | null;
  region: string | null;
  distanceMeters: number;
}

interface NearbyRow {
  id: string;
  name: string;
  slug: string;
  kind: SpotKind;
  locality: string | null;
  region: string | null;
  distance_meters: number;
}

/**
 * Spec §9.1: run before the form, not after. Catching a duplicate up front
 * turns a rejection into a contribution, because the user can be sent to the
 * existing spot instead.
 */
export async function findNearbyDuplicates(
  supabase: SupabaseClient,
  position: LatLng,
  kind: SpotKind,
  radiusMeters: number = DUPLICATE_RADIUS_METERS,
): Promise<NearbySpot[]> {
  const { data, error } = await supabase.rpc("spots_within_meters", {
    p_lng: position.lng,
    p_lat: position.lat,
    p_meters: radiusMeters,
    p_kind: kind,
  });
  if (error) throw error;

  return ((data ?? []) as NearbyRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    locality: row.locality,
    region: row.region,
    distanceMeters: row.distance_meters,
  }));
}

/**
 * First free candidate from `slugCandidates`.
 *
 * The last candidate always carries a random discriminator, so this cannot run
 * out — but the insert is still the authority, since another submission could
 * take the slug between this check and the write.
 */
export async function resolveSlug(
  supabase: SupabaseClient,
  name: string,
  locality: string | null,
  region: string | null,
): Promise<string> {
  for (const candidate of slugCandidates(name, locality, region)) {
    const { data, error } = await supabase.rpc("slug_exists", { p_slug: candidate });
    if (error) throw error;
    if (!data) return candidate;
  }
  // Unreachable: the final candidate is randomised. Belt and braces.
  return `${slugCandidates(name, locality, region)[0]}-${crypto.randomUUID().slice(0, 8)}`;
}

/** One transaction for the spot, its shoot types and its photos (spec §10). */
export async function createSpot(
  supabase: SupabaseClient,
  input: SubmissionInput,
  slug: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_spot", {
    p_name: input.name.trim(),
    p_kind: input.kind,
    p_lng: input.position.lng,
    p_lat: input.position.lat,
    p_slug: slug,
    p_description: input.description ?? "",
    p_locality: input.locality ?? "",
    p_region: input.region ?? "",
    p_shoot_type_ids: input.shootTypeIds,
    p_photos: input.photos.map((p) => ({
      storage_path: p.storagePath,
      kind: p.kind,
      rights_attested: p.rightsAttested,
      credit_name: p.creditName ?? "",
      credit_url: p.creditUrl ?? "",
      caption: p.caption ?? "",
    })),
  });

  if (error) throw error;
  return data as string;
}

export async function addGalleryLink(
  supabase: SupabaseClient,
  spotId: string,
  url: string,
  title: string,
): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Must be signed in to add a gallery link.");

  const { error } = await supabase.from("spot_gallery_links").insert({
    spot_id: spotId,
    profile_id: user.user.id,
    url,
    title,
  });
  if (error) throw error;
}

/** Editing is column-scoped by the grants in migration 5; `status` is not writable here. */
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
    })
    .eq("id", spotId);
  if (error) throw error;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/db/spot-writes.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add app/data/spot-writes.ts tests/db/spot-writes.test.ts
git commit -m "feat: add spot write operations with atomic creation"
```

---

## Task 5: Client-side photo upload

**Files:**
- Create: `app/lib/photo-upload.client.ts`
- Test: `app/lib/photo-upload.client.test.ts`

- [ ] **Step 1: Write the failing test**

The canvas work needs a browser, so what is tested here is the pure decision-making: what size to scale to, and what storage path to use.

Create `app/lib/photo-upload.client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { targetDimensions, uploadPathFor, MAX_IMAGE_EDGE } from "./photo-upload.client";

describe("targetDimensions", () => {
  it("leaves a small image alone", () => {
    expect(targetDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a wide image down by its longest edge", () => {
    const { width, height } = targetDimensions(4000, 3000);
    expect(width).toBe(MAX_IMAGE_EDGE);
    expect(height).toBe(Math.round((3000 / 4000) * MAX_IMAGE_EDGE));
  });

  it("scales a tall image down by its longest edge", () => {
    const { width, height } = targetDimensions(3000, 4000);
    expect(height).toBe(MAX_IMAGE_EDGE);
    expect(width).toBe(Math.round((3000 / 4000) * MAX_IMAGE_EDGE));
  });

  it("preserves aspect ratio", () => {
    const { width, height } = targetDimensions(4000, 2000);
    expect(width / height).toBeCloseTo(2, 5);
  });

  it("never returns a zero dimension", () => {
    const { width, height } = targetDimensions(10000, 1);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});

describe("uploadPathFor", () => {
  // The storage policy requires the first folder to be the uploader's id, and
  // the spot does not exist yet at upload time (spec §10).
  it("puts the file under the uploader's id", () => {
    expect(uploadPathFor("user-123", "photo.JPG").startsWith("user-123/")).toBe(true);
  });

  it("keeps the extension, lowercased", () => {
    expect(uploadPathFor("user-123", "photo.JPG").endsWith(".jpg")).toBe(true);
  });

  it("gives a different path each time, so uploads cannot collide", () => {
    expect(uploadPathFor("u", "a.jpg")).not.toBe(uploadPathFor("u", "a.jpg"));
  });

  it("falls back to .jpg when the name has no extension", () => {
    expect(uploadPathFor("u", "screenshot").endsWith(".jpg")).toBe(true);
  });

  it("does not carry the original filename through", () => {
    expect(uploadPathFor("u", "my holiday photo.jpg")).not.toContain("holiday");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/photo-upload.client.test.ts`
Expected: FAIL — `Cannot find module './photo-upload.client'`

- [ ] **Step 3: Write the implementation**

Create `app/lib/photo-upload.client.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { SPOT_PHOTO_BUCKET } from "./photo-url";

/** Longest edge after downscaling. Enough for a full-width hero on a retina screen. */
export const MAX_IMAGE_EDGE = 2000;

const JPEG_QUALITY = 0.82;

export function targetDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_IMAGE_EDGE) return { width, height };

  const scale = MAX_IMAGE_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Where a file goes in the bucket.
 *
 * The first folder must be the uploader's id — that is what the storage policy
 * checks — and the spot does not exist yet at upload time (spec §10). The
 * original filename is discarded rather than sanitised: it can carry the
 * uploader's name or location and there is no reason to publish it.
 */
export function uploadPathFor(userId: string, originalName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(originalName);
  const ext = (match?.[1] ?? "jpg").toLowerCase();
  return `${userId}/${crypto.randomUUID()}.${ext}`;
}

/** Downscale in the browser so a 12 MP phone photo does not travel at full size. */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = targetDimensions(bitmap.width, bitmap.height);

  if (width === bitmap.width && height === bitmap.height && file.size < 1_500_000) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  return blob ?? file;
}

export interface UploadedPhoto {
  storagePath: string;
  width: number;
  height: number;
}

/**
 * Uploads before the spot exists. An abandoned submission therefore leaves
 * orphaned objects, which spec §10 says a periodic job sweeps — that is the
 * accepted cost of never creating a photo-less spot.
 */
export async function uploadSpotPhoto(
  supabase: SupabaseClient,
  userId: string,
  file: File,
): Promise<UploadedPhoto> {
  const bitmap = await createImageBitmap(file);
  const dimensions = targetDimensions(bitmap.width, bitmap.height);
  bitmap.close();

  const body = await downscale(file);
  const path = uploadPathFor(userId, file.name);

  const { error } = await supabase.storage.from(SPOT_PHOTO_BUCKET).upload(path, body, {
    contentType: body.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;

  return { storagePath: path, width: dimensions.width, height: dimensions.height };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/photo-upload.client.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add app/lib/photo-upload.client.ts app/lib/photo-upload.client.test.ts
git commit -m "feat: downscale and upload photos from the browser"
```

---

## Task 6: The submission route

**Files:**
- Create: `app/routes/submit.tsx`
- Modify: `app/routes.ts`

- [ ] **Step 1: Register the route**

Replace the contents of `app/routes.ts`:

```ts
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("submit", "routes/submit.tsx"),
  route("spots/:slug", "routes/spots.$slug.tsx"),
  route("spots/:slug/edit", "routes/spots.$slug.edit.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/callback", "routes/auth.callback.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
] satisfies RouteConfig;
```

- [ ] **Step 2: Write the route**

Create `app/routes/submit.tsx`:

```tsx
import { useCallback, useState } from "react";
import { Link, redirect, useFetcher, data as routeData } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { readEnv } from "~/lib/env.server";
import { getCurrentProfile } from "~/data/profiles";
import {
  findNearbyDuplicates,
  resolveSlug,
  createSpot,
  type NearbySpot,
} from "~/data/spot-writes";
import {
  validateSubmission,
  MAX_PHOTOS_PER_KIND,
  type PhotoInput,
  type SubmissionInput,
} from "~/domain/spots/submission";
import { uploadSpotPhoto } from "~/lib/photo-upload.client";
import { createClient } from "@supabase/supabase-js";
import type { Route } from "./+types/submit";

export function meta() {
  return [{ title: "Add a spot — Photospots" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const env = readEnv();
  const profile = await getCurrentProfile(supabase);

  // Submitting requires an account (spec §4.6). Browsing does not, so this is
  // the only place in the app that redirects to sign-in.
  if (!profile) throw redirect("/auth/login", { headers });

  const { data: shootTypes } = await supabase
    .from("shoot_types")
    .select("id, slug, label")
    .order("sort_order");

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const kind = url.searchParams.get("kind") === "studio" ? "studio" : "outdoor";

  const hasPin = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  const nearby: NearbySpot[] = hasPin
    ? await findNearbyDuplicates(supabase, { lat, lng }, kind)
    : [];

  return routeData(
    {
      profile,
      shootTypes: shootTypes ?? [],
      position: hasPin ? { lat, lng } : null,
      kind,
      nearby,
      supabaseUrl: env.supabaseUrl,
      supabaseAnonKey: env.supabaseAnonKey,
    },
    { headers },
  );
}

export async function action({ request }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const profile = await getCurrentProfile(supabase);
  if (!profile) return routeData({ errors: [{ field: "auth", message: "Sign in first." }] }, { headers });

  const form = await request.formData();
  const photos = JSON.parse(String(form.get("photos") ?? "[]")) as PhotoInput[];
  const input: SubmissionInput = {
    name: String(form.get("name") ?? ""),
    kind: form.get("kind") === "studio" ? "studio" : "outdoor",
    position: { lat: Number(form.get("lat")), lng: Number(form.get("lng")) },
    description: String(form.get("description") ?? "") || null,
    locality: String(form.get("locality") ?? "") || null,
    region: String(form.get("region") ?? "") || null,
    shootTypeIds: form.getAll("shootTypeIds").map(Number).filter(Number.isFinite),
    photos,
  };

  const { errors } = validateSubmission(input);
  if (errors.length > 0) return routeData({ errors }, { headers });

  const slug = await resolveSlug(supabase, input.name, input.locality, input.region);
  try {
    await createSpot(supabase, input, slug);
  } catch (err) {
    return routeData(
      { errors: [{ field: "form", message: err instanceof Error ? err.message : "Could not save." }] },
      { headers },
    );
  }

  return redirect(`/spots/${slug}`, { headers });
}

interface StagedPhoto extends PhotoInput {
  previewName: string;
}

export default function Submit({ loaderData }: Route.ComponentProps) {
  const { profile, shootTypes, position, kind, nearby, supabaseUrl, supabaseAnonKey } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const onFiles = useCallback(
    async (files: FileList | null, photoKind: "scouting" | "session") => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setUploadError(null);
      try {
        // A browser client, because uploads go straight to Storage rather than
        // through the server (spec §9.1).
        const browser = createClient(supabaseUrl, supabaseAnonKey);
        const { data: session } = await browser.auth.getSession();
        if (!session.session) throw new Error("Session expired — sign in again.");

        for (const file of Array.from(files)) {
          const uploaded = await uploadSpotPhoto(browser, profile!.id, file);
          setStaged((prev) => [
            ...prev,
            {
              storagePath: uploaded.storagePath,
              kind: photoKind,
              rightsAttested: false,
              creditName: null,
              creditUrl: null,
              caption: null,
              previewName: file.name,
            },
          ]);
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [profile, supabaseUrl, supabaseAnonKey],
  );

  const errors = fetcher.data?.errors ?? [];
  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message;

  if (!position) {
    return (
      <main className="submit">
        <h1>Add a spot</h1>
        <p>
          Open the map, find the place, and use “Add a spot here”. The pin comes first so we can
          check whether it is already on the map.
        </p>
        <p>
          <Link to="/">← Back to the map</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="submit">
      <p>
        <Link to="/">← Back to the map</Link>
      </p>
      <h1>Add a spot</h1>

      {nearby.length > 0 && (
        <section className="submit__duplicates">
          <h2>Is it one of these?</h2>
          <p>There {nearby.length === 1 ? "is" : "are"} already {nearby.length} nearby.</p>
          <ul>
            {nearby.map((s) => (
              <li key={s.id}>
                <Link to={`/spots/${s.slug}`}>{s.name}</Link>{" "}
                <span>{Math.round(s.distanceMeters)} m away</span>
              </li>
            ))}
          </ul>
          <p>If none of them is it, carry on below.</p>
        </section>
      )}

      <fetcher.Form method="post" className="submit__form">
        <input type="hidden" name="lat" value={position.lat} />
        <input type="hidden" name="lng" value={position.lng} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="photos" value={JSON.stringify(staged)} />

        <label>
          Name
          <input name="name" required maxLength={120} />
        </label>
        {errorFor("name") && <p role="alert">{errorFor("name")}</p>}

        <fieldset>
          <legend>What is it good for?</legend>
          {shootTypes.map((t) => (
            <label key={t.id}>
              <input type="checkbox" name="shootTypeIds" value={t.id} />
              {t.label}
            </label>
          ))}
        </fieldset>
        {errorFor("shootTypeIds") && <p role="alert">{errorFor("shootTypeIds")}</p>}

        <fieldset>
          <legend>Photos</legend>
          <p>
            Scouting shots show what the place looks like. Session photos are work you shot there —
            up to {MAX_PHOTOS_PER_KIND} of each.
          </p>
          <label>
            Scouting photos
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onFiles(e.currentTarget.files, "scouting")}
            />
          </label>
          <label>
            Session photos
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onFiles(e.currentTarget.files, "session")}
            />
          </label>

          {uploading && <p>Uploading…</p>}
          {uploadError && <p role="alert">{uploadError}</p>}

          <ul className="submit__staged">
            {staged.map((p, i) => (
              <li key={p.storagePath}>
                {p.previewName} — {p.kind}
                {p.kind === "session" && (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={p.rightsAttested}
                        onChange={(e) =>
                          setStaged((prev) =>
                            prev.map((q, j) =>
                              j === i ? { ...q, rightsAttested: e.currentTarget.checked } : q,
                            ),
                          )
                        }
                      />
                      I shot this and have the right to post it
                    </label>
                    <label>
                      Credit
                      <input
                        value={p.creditName ?? ""}
                        onChange={(e) =>
                          setStaged((prev) =>
                            prev.map((q, j) =>
                              j === i ? { ...q, creditName: e.currentTarget.value || null } : q,
                            ),
                          )
                        }
                      />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
        {errorFor("photos") && <p role="alert">{errorFor("photos")}</p>}

        <details>
          <summary>Add details</summary>
          <label>
            Description
            <textarea name="description" rows={3} />
          </label>
          <label>
            Town or city
            <input name="locality" defaultValue="Grand Rapids" />
          </label>
          <label>
            State
            <input name="region" defaultValue="MI" />
          </label>
        </details>

        {errorFor("form") && <p role="alert">{errorFor("form")}</p>}

        <button type="submit" disabled={uploading || fetcher.state !== "idle"}>
          {fetcher.state === "idle" ? "Add this spot" : "Saving…"}
        </button>
      </fetcher.Form>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0

- [ ] **Step 4: Commit**

```bash
git add app/routes/submit.tsx app/routes.ts
git commit -m "feat: add the spot submission flow"
```

---

## Task 7: Link to submission from the map

**Files:**
- Modify: `app/routes/home.tsx`

- [ ] **Step 1: Add the entry point**

In `app/routes/home.tsx`, inside the `controls` block, add an "Add a spot here" link immediately before the `explore__account` div. It carries the current map centre so the pin starts where the user is looking:

```tsx
        <Link
          className="explore__add"
          to={`/submit?lat=${((filters.viewport.north + filters.viewport.south) / 2).toFixed(6)}&lng=${((filters.viewport.east + filters.viewport.west) / 2).toFixed(6)}`}
        >
          Add a spot here
        </Link>
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0

- [ ] **Step 3: Commit**

```bash
git add app/routes/home.tsx
git commit -m "feat: link to submission from the map"
```

---

## Task 8: Edit route

**Files:**
- Create: `app/routes/spots.$slug.edit.tsx`

- [ ] **Step 1: Write the route**

Create `app/routes/spots.$slug.edit.tsx`:

```tsx
import { Form, Link, redirect, data as routeData } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { getCurrentProfile } from "~/data/profiles";
import { getSpotBySlug } from "~/data/spots";
import { updateSpot, addGalleryLink } from "~/data/spot-writes";
import type { Route } from "./+types/spots.$slug.edit";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `Edit ${loaderData.spot.name} — Photospots` : "Edit — Photospots" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const profile = await getCurrentProfile(supabase);
  if (!profile) throw redirect("/auth/login", { headers });

  const spot = await getSpotBySlug(supabase, params.slug);
  if (!spot) throw new Response("Not found", { status: 404, headers });

  return routeData({ spot }, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const spot = await getSpotBySlug(supabase, params.slug);
  if (!spot) throw new Response("Not found", { status: 404, headers });

  const form = await request.formData();

  if (form.get("intent") === "add-link") {
    const url = String(form.get("url") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    if (!url || !title) {
      return routeData({ error: "A gallery link needs both a URL and a title." }, { headers });
    }
    try {
      await addGalleryLink(supabase, spot.id, url, title);
    } catch {
      return routeData({ error: "Could not add that link." }, { headers });
    }
    return redirect(`/spots/${params.slug}/edit`, { headers });
  }

  try {
    // RLS decides whether this user may edit; a stranger's update matches no
    // rows rather than erroring, so success here does not prove a change.
    await updateSpot(supabase, spot.id, {
      name: String(form.get("name") ?? spot.name),
      description: String(form.get("description") ?? "") || null,
      locality: String(form.get("locality") ?? "") || null,
      region: String(form.get("region") ?? "") || null,
      walkMinutes: form.get("walkMinutes") ? Number(form.get("walkMinutes")) : null,
      parkingNotes: String(form.get("parkingNotes") ?? "") || null,
    });
  } catch {
    return routeData({ error: "Could not save those changes." }, { headers });
  }

  return redirect(`/spots/${params.slug}`, { headers });
}

export default function EditSpot({ loaderData, actionData }: Route.ComponentProps) {
  const { spot } = loaderData;

  return (
    <main className="spot-detail">
      <p>
        <Link to={`/spots/${spot.slug}`}>← Back to {spot.name}</Link>
      </p>
      <h1>Edit {spot.name}</h1>

      {actionData?.error && <p role="alert">{actionData.error}</p>}

      <Form method="post" className="submit__form">
        <label>
          Name
          <input name="name" defaultValue={spot.name} required maxLength={120} />
        </label>
        <label>
          Description
          <textarea name="description" rows={3} defaultValue={spot.description ?? ""} />
        </label>
        <label>
          Town or city
          <input name="locality" defaultValue={spot.locality ?? ""} />
        </label>
        <label>
          State
          <input name="region" defaultValue={spot.region ?? ""} />
        </label>
        <label>
          Walk from parking (minutes)
          <input
            name="walkMinutes"
            type="number"
            min={0}
            defaultValue={spot.walkMinutes ?? ""}
          />
        </label>
        <label>
          Parking notes
          <input name="parkingNotes" defaultValue={spot.parkingNotes ?? ""} />
        </label>
        <button type="submit">Save changes</button>
      </Form>

      <h2>Link a full gallery</h2>
      <p>Hosted photos are capped, so link the full session rather than uploading it.</p>
      <Form method="post" className="submit__form">
        <input type="hidden" name="intent" value="add-link" />
        <label>
          Title
          <input name="title" required />
        </label>
        <label>
          URL
          <input name="url" type="url" required />
        </label>
        <button type="submit">Add link</button>
      </Form>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="spot-detail">
      <h1>Spot not found</h1>
      <p>
        <Link to="/">← Back to the map</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0

- [ ] **Step 3: Commit**

```bash
git add app/routes/spots.\$slug.edit.tsx
git commit -m "feat: add spot editing and gallery links"
```

---

## Task 9: Show photos and gallery links on the detail page

**Files:**
- Modify: `app/data/spots.ts` (add `getSpotMedia`)
- Modify: `app/routes/spots.$slug.tsx`

- [ ] **Step 1: Add the media query**

Append to `app/data/spots.ts`:

```ts
export interface SpotPhoto {
  id: string;
  storagePath: string;
  kind: "scouting" | "session";
  caption: string | null;
  creditName: string | null;
  creditUrl: string | null;
}

export interface SpotGalleryLink {
  id: string;
  url: string;
  title: string;
}

export interface SpotMedia {
  photos: SpotPhoto[];
  galleryLinks: SpotGalleryLink[];
}

/**
 * `status = 'published'` is written explicitly even though RLS enforces it —
 * the RLS predicate is a disjunction and would leave a partial index unused.
 */
export async function getSpotMedia(
  supabase: SupabaseClient,
  spotId: string,
): Promise<SpotMedia> {
  const [photos, links] = await Promise.all([
    supabase
      .from("photos")
      .select("id, storage_path, kind, caption, credit_name, credit_url")
      .eq("spot_id", spotId)
      .eq("status", "published")
      .order("kind", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("spot_gallery_links")
      .select("id, url, title")
      .eq("spot_id", spotId)
      .order("created_at", { ascending: true }),
  ]);

  if (photos.error) throw photos.error;
  if (links.error) throw links.error;

  return {
    photos: (photos.data ?? []).map((p) => ({
      id: p.id as string,
      storagePath: p.storage_path as string,
      kind: p.kind as "scouting" | "session",
      caption: p.caption as string | null,
      creditName: p.credit_name as string | null,
      creditUrl: p.credit_url as string | null,
    })),
    galleryLinks: (links.data ?? []).map((l) => ({
      id: l.id as string,
      url: l.url as string,
      title: l.title as string,
    })),
  };
}
```

- [ ] **Step 2: Render them**

In `app/routes/spots.$slug.tsx`:

Change the imports to include the media query and the URL helper:

```tsx
import { getSpotBySlug, getSpotMedia, type SpotDetail } from "~/data/spots";
import { photoUrl } from "~/lib/photo-url";
import { getCurrentProfile } from "~/data/profiles";
```

Replace the body of `loader` after the `if (!spot)` guard with:

```tsx
  const [media, profile] = await Promise.all([
    getSpotMedia(supabase, spot.id),
    getCurrentProfile(supabase),
  ]);

  return routeData({ spot, media, profile, supabaseUrl: env.supabaseUrl }, { headers });
```

Replace the `spot-detail__pending` paragraph with the media sections and an edit link:

```tsx
      {media.photos.length > 0 && (
        <section className="spot-detail__photos">
          <h2>Photos</h2>
          <ul>
            {media.photos.map((p) => (
              <li key={p.id}>
                <img src={photoUrl(supabaseUrl, p.storagePath) ?? ""} alt={p.caption ?? ""} loading="lazy" />
                <p>
                  {p.kind === "session" ? "Session" : "Scouting"}
                  {p.creditName && <> · {p.creditName}</>}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {media.galleryLinks.length > 0 && (
        <section>
          <h2>Full galleries</h2>
          <ul>
            {media.galleryLinks.map((l) => (
              <li key={l.id}>
                <a href={l.url} target="_blank" rel="noreferrer noopener">
                  {l.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile && (
        <p>
          <Link to={`/spots/${spot.slug}/edit`}>Edit this spot</Link>
        </p>
      )}

      <p className="spot-detail__pending">Comments and voting arrive in the next milestone.</p>
```

Update the component destructuring to `const { spot, media, profile, supabaseUrl } = loaderData;`.

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0

- [ ] **Step 4: Commit**

```bash
git add app/data/spots.ts app/routes/spots.\$slug.tsx
git commit -m "feat: show photos and gallery links on the detail page"
```

---

## Task 10: Styles

**Files:**
- Modify: `app/app.css`

- [ ] **Step 1: Append the submission styles**

Append to `app/app.css`:

```css
/* ---- Submission ---- */

.submit { max-width: 44rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
.submit__form { display: grid; gap: 0.9rem; margin-top: 1rem; }
.submit__form label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
.submit__form fieldset { border: 1px solid rgb(0 0 0 / 0.15); border-radius: 8px; padding: 0.75rem; }
.submit__form fieldset legend { padding: 0 0.4rem; font-weight: 600; }
.submit__form fieldset label { display: inline-flex; gap: 0.3rem; align-items: center; margin-right: 0.9rem; }
.submit__form input[type="text"],
.submit__form input:not([type]),
.submit__form input[type="url"],
.submit__form input[type="number"],
.submit__form textarea {
  padding: 0.4rem 0.5rem; border: 1px solid rgb(0 0 0 / 0.25); border-radius: 6px; font: inherit;
}
.submit__form button[type="submit"] {
  justify-self: start; padding: 0.5rem 1.1rem; border-radius: 6px;
  border: 1px solid #1f2937; background: #1f2937; color: white; font: inherit; cursor: pointer;
}
.submit__form button[type="submit"]:disabled { opacity: 0.55; cursor: default; }
.submit__form [role="alert"] { color: #b42318; font-size: 0.85rem; margin: 0; }

.submit__duplicates {
  border: 1px solid #c08a2e; background: rgb(192 138 46 / 0.08);
  border-radius: 8px; padding: 0.75rem 1rem; margin: 1rem 0;
}
.submit__duplicates ul { margin: 0.5rem 0; padding-left: 1.1rem; }

.submit__staged { list-style: none; padding: 0; margin: 0.6rem 0 0; display: grid; gap: 0.5rem; }
.submit__staged li {
  display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
  border: 1px solid rgb(0 0 0 / 0.12); border-radius: 6px; padding: 0.4rem 0.6rem; font-size: 0.85rem;
}

.explore__add {
  padding: 0.25rem 0.7rem; border: 1px solid #1f2937; border-radius: 999px;
  background: #1f2937; color: white; text-decoration: none; font-size: 0.9rem;
}

.spot-detail__photos ul {
  list-style: none; padding: 0; margin: 0;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem;
}
.spot-detail__photos img { width: 100%; height: 165px; object-fit: cover; border-radius: 6px; }
.spot-detail__photos p { margin: 0.25rem 0 0; font-size: 0.8rem; opacity: 0.7; }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add app/app.css
git commit -m "feat: style the submission flow"
```

---

## Task 11: Verify it end to end

**Files:** none — verification only.

- [ ] **Step 1: Reset, seed and start**

```bash
npx supabase db reset && npm run seed && npm run backfill:scores
npm run dev &
until curl -s -o /dev/null http://localhost:5173/; do sleep 1; done
```

- [ ] **Step 2: Submitting requires an account**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://localhost:5173/submit?lat=42.95&lng=-85.68"
```

Expected: a redirect to `/auth/login`. Browsing must never redirect, so also confirm the map does not:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
```

Expected: `200`

- [ ] **Step 3: The duplicate check finds a seeded spot**

Millennium Park Meadow is at `42.9214, -85.7267`. Query the RPC directly as a signed-in user would:

```bash
node --input-type=module -e "
const { createClient } = await import('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await db.rpc('spots_within_meters', {
  p_lng: -85.7268, p_lat: 42.9215, p_meters: 200, p_kind: 'outdoor' });
console.log(data.length + ' nearby: ' + data.map(s => s.name + ' (' + Math.round(s.distance_meters) + 'm)').join(', '));
"
```

Expected: at least one result naming Millennium Park Meadow.

- [ ] **Step 4: The photo cap holds against the API, not just the form**

```bash
node --input-type=module -e "
const { createClient } = await import('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: spot } = await db.from('spots').select('id, created_by').limit(1).single();
let inserted = 0, blocked = null;
for (let i = 0; i < 12; i++) {
  const { error } = await db.from('photos').insert({
    spot_id: spot.id, profile_id: spot.created_by, kind: 'scouting',
    storage_path: spot.created_by + '/cap-' + i + '-' + Date.now() + '.jpg',
    rights_attested: false, credit_name: null,
  });
  if (error) { blocked = error.message; break; }
  inserted++;
}
console.log('inserted ' + inserted + ' before: ' + blocked);
"
```

Expected: it stops at the cap with a "photo cap reached" message. The seed already added one scouting photo per spot, so the number inserted before blocking is one fewer than the cap.

- [ ] **Step 5: Uploads are scoped to the uploader**

Covered by `tests/db/contribution-rules.test.ts`; re-run it against the reset database:

```bash
npx vitest run tests/db/contribution-rules.test.ts
```

Expected: PASS

- [ ] **Step 6: A rejected photo leaves no spot behind**

```bash
npx vitest run tests/db/spot-writes.test.ts
```

Expected: PASS, including "leaves nothing behind when a photo is rejected".

- [ ] **Step 7: Stop the dev server and run everything**

```bash
npm test && npm run typecheck && npm run build
```

Expected: all pass.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found in contribution verification"
```

---

## Task 12: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

- Status table: contribution is done; next is voting and comments.
- Under "How it works", note that hosted photos are capped per spot and full sessions are linked.
- Verify every path, script and claim before committing.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for the contribution milestone"
```

---

## Done when

- `npm test`, `npm run typecheck` and `npm run build` all pass
- `/submit` redirects a logged-out visitor to sign-in, while `/` still returns 200
- Dropping a pin next to a seeded spot lists it as a possible duplicate, with a distance
- The photo cap blocks the seventh photo of a kind when called directly through the API
- An upload under another user's folder is refused
- A submission whose photo violates the rights check leaves no spot behind
- A submitted spot appears on the map and its detail page shows its photos

## Not in this plan

Voting and comments are plan 4. The detail page says so.

Deferred deliberately:

- **Sweeping orphaned storage objects.** Uploading before the spot exists means an abandoned submission leaves files behind. Spec §10 calls for a periodic sweep; it needs a scheduled job like `refresh:hot`, and nothing breaks until storage costs matter.
- **Editing photos on an existing spot.** Task 8 edits text fields and adds gallery links; replacing photos needs the same upload flow as submission and is worth doing once, later, rather than twice now.
