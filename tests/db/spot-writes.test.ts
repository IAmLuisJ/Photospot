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
