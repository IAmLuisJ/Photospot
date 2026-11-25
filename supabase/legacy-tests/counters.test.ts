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

  const { data: types } = await db.from("shoot_types").select("id").eq("slug", "family");
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

  it("stops counting a removed photo", async () => {
    await serviceClient().from("photos").update({ status: "removed" }).eq("spot_id", spotId);
    const c = await counters();
    expect(c.scouting_photo_count).toBe(0);
    expect(c.session_photo_count).toBe(0);
  });

  // A recount reads the source tables, so it must not be fooled by rows that
  // belong to a different spot. Without a spot_id filter in recount_spot this
  // would report the global total.
  it("counts only its own spot's rows", async () => {
    const db = serviceClient();
    const { data: other } = await db
      .from("spots")
      .insert({
        kind: "outdoor",
        name: "Other Spot",
        slug: `counter-other-${Date.now()}`,
        location: "POINT(-85.6 42.8)",
        created_by: userId,
      })
      .select("id")
      .single();

    await db
      .from("comments")
      .insert({ spot_id: other!.id, profile_id: userId, body: "Belongs elsewhere." });

    expect((await counters()).comment_count).toBe(0);
    const { data: otherCounts } = await db
      .from("spots")
      .select("comment_count")
      .eq("id", other!.id)
      .single();
    expect(otherCounts!.comment_count).toBe(1);

    await db.from("spots").delete().eq("id", other!.id);
  });

  // Deleting a spot cascades to signals/comments/photos, which fires the
  // recount trigger for a row that no longer exists. It must not error.
  it("survives the cascade when its spot is deleted", async () => {
    const db = serviceClient();
    const { data: doomed } = await db
      .from("spots")
      .insert({
        kind: "outdoor",
        name: "Doomed Spot",
        slug: `counter-doomed-${Date.now()}`,
        location: "POINT(-85.5 42.7)",
        created_by: userId,
      })
      .select("id")
      .single();

    await db
      .from("comments")
      .insert({ spot_id: doomed!.id, profile_id: userId, body: "About to vanish." });

    const { error } = await db.from("spots").delete().eq("id", doomed!.id);
    expect(error).toBeNull();
  });
});
