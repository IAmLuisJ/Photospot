import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";

let author: TestUser;
const ids: Record<string, string> = {};

// A box well away from the seeded Grand Rapids spots, so this file's assertions
// cannot be perturbed by the seed or by another test file's fixtures.
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
  const { error } = await serviceClient().from("spots").delete().in("id", Object.values(ids));
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
    // Inclusive: 20 must include the 20-minute spot.
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
  // must not return a spot whose walk time nobody recorded.
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

  // dog_friendly = false must behave as "no filter", not as "show me spots
  // that ban dogs" — nobody asked for that, and the UI has no way to send it.
  it("treats a false dogs flag as no filter", async () => {
    expect(await query({ p_dog_friendly: false })).toEqual(["Free", "Permit", "Unknown"]);
  });

  it("still respects the shoot-type filter alongside the new ones", async () => {
    // None of these fixtures is tagged with a shoot type, so any shoot-type
    // filter must empty the result regardless of the attribute filters.
    const { data: types } = await serviceClient()
      .from("shoot_types")
      .select("id")
      .eq("slug", "family")
      .single();
    expect(await query({ p_shoot_type_id: types!.id, p_cost_types: ["free"] })).toEqual([]);
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
