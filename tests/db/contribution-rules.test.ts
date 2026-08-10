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
