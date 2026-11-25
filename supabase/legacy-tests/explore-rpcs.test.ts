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
