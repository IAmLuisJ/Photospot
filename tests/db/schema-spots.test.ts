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
