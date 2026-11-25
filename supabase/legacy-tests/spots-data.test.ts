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
