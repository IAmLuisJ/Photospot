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
      spot_id: spotId, profile_id: userId, kind: "shoot_type_upvote",
      shoot_type_id: familyTypeId, value: 1,
    });
    expect(error).toBeNull();
  });

  it("rejects a second upvote for the same shoot type", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId, profile_id: userId, kind: "shoot_type_upvote",
      shoot_type_id: familyTypeId, value: 1,
    });
    expect(error?.code).toBe("23505");
  });

  it("allows the same user to upvote a different shoot type", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId, profile_id: userId, kind: "shoot_type_upvote",
      shoot_type_id: weddingTypeId, value: 1,
    });
    expect(error).toBeNull();
  });

  it("accepts a shoot-again vote with no shoot type", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId, profile_id: userId, kind: "shoot_again", value: 1,
    });
    expect(error).toBeNull();
  });

  // The bug this schema exists to prevent: with a plain UNIQUE constraint,
  // NULL shoot_type_id values are distinct and this insert would succeed.
  it("rejects a second shoot-again vote from the same user", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId, profile_id: userId, kind: "shoot_again", value: 0,
    });
    expect(error?.code).toBe("23505");
  });

  it("rejects a shoot-type upvote with no shoot type", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId, profile_id: userId, kind: "shoot_type_upvote", value: 1,
    });
    expect(error).not.toBeNull();
  });

  it("rejects a shoot-again vote that carries a shoot type", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId, profile_id: userId, kind: "shoot_again",
      shoot_type_id: familyTypeId, value: 1,
    });
    expect(error).not.toBeNull();
  });

  it("rejects a downvote — there are none", async () => {
    const { error } = await serviceClient().from("signals").insert({
      spot_id: spotId, profile_id: userId, kind: "shoot_type_upvote",
      shoot_type_id: familyTypeId, value: -1,
    });
    expect(error).not.toBeNull();
  });
});

describe("photos", () => {
  it("accepts a scouting photo without a rights attestation", async () => {
    const { error } = await serviceClient().from("photos").insert({
      spot_id: spotId, profile_id: userId, kind: "scouting",
      storage_path: `${spotId}/scout-1.jpg`,
    });
    expect(error).toBeNull();
  });

  it("rejects a session photo without a rights attestation", async () => {
    const { error } = await serviceClient().from("photos").insert({
      spot_id: spotId, profile_id: userId, kind: "session",
      storage_path: `${spotId}/session-1.jpg`, rights_attested: false,
    });
    expect(error).not.toBeNull();
  });

  it("accepts a session photo with the attestation", async () => {
    const { error } = await serviceClient().from("photos").insert({
      spot_id: spotId, profile_id: userId, kind: "session",
      storage_path: `${spotId}/session-2.jpg`, rights_attested: true,
      credit_name: "Ada Lovelace", credit_url: "https://example.com",
    });
    expect(error).toBeNull();
  });
});

// Task 8 established the pattern (spots.created_by / owner_profile_id): a
// contributor deleting their account must not fail, and must not silently
// erase the content other people rely on. Every table here that stores
// content someone *authored* follows the same rule — the FK is nullable and
// ON DELETE SET NULL, so the row survives with an anonymous author. Only
// `signals` cascades, because a vote by a person who no longer exists isn't
// content worth keeping anonymously — it's just a stale ballot.
describe("account deletion", () => {
  it("orphans authored content but discards the deleted user's votes", async () => {
    const db = serviceClient();
    const deleter = await createTestUser("Deleter");
    const deleterId = deleter.id;

    const { data: spot } = await db
      .from("spots")
      .insert({
        kind: "studio",
        name: "Deletion Test Spot",
        slug: `deletion-test-${Date.now()}`,
        location: "POINT(-85.7267 42.9214)",
        created_by: deleterId,
      })
      .select("id")
      .single();
    const deletionSpotId = spot!.id as string;

    const { data: photo } = await db
      .from("photos")
      .insert({
        spot_id: deletionSpotId, profile_id: deleterId, kind: "scouting",
        storage_path: `${deletionSpotId}/deletion-test.jpg`,
      })
      .select("id")
      .single();

    const { data: link } = await db
      .from("spot_gallery_links")
      .insert({
        spot_id: deletionSpotId, profile_id: deleterId,
        url: "https://example.com/gallery", title: "Full gallery",
      })
      .select("id")
      .single();

    const { data: comment } = await db
      .from("comments")
      .insert({ spot_id: deletionSpotId, profile_id: deleterId, body: "Great light in the morning." })
      .select("id")
      .single();

    // deleter is the reporter on one report...
    const { data: reportFiledByDeleter } = await db
      .from("reports")
      .insert({
        target_type: "spot", target_id: deletionSpotId, profile_id: deleterId,
        reason: "wrong location",
      })
      .select("id")
      .single();

    // ...and the resolving admin on another, filed by someone else.
    const { data: reportResolvedByDeleter } = await db
      .from("reports")
      .insert({
        target_type: "spot", target_id: deletionSpotId, profile_id: userId,
        reason: "duplicate", status: "resolved", resolved_by: deleterId,
      })
      .select("id")
      .single();

    await db.from("studio_details").insert({
      spot_id: deletionSpotId, claimed_by: deleterId, claimed_at: new Date().toISOString(),
    });

    await db.from("signals").insert({
      spot_id: deletionSpotId, profile_id: deleterId, kind: "shoot_again", value: 1,
    });

    await deleteTestUser(deleterId);

    const { data: photoAfter } = await db
      .from("photos").select("profile_id").eq("id", photo!.id).single();
    expect(photoAfter?.profile_id).toBeNull();

    const { data: linkAfter } = await db
      .from("spot_gallery_links").select("profile_id").eq("id", link!.id).single();
    expect(linkAfter?.profile_id).toBeNull();

    const { data: commentAfter } = await db
      .from("comments").select("profile_id").eq("id", comment!.id).single();
    expect(commentAfter?.profile_id).toBeNull();

    const { data: reportFiledAfter } = await db
      .from("reports").select("profile_id").eq("id", reportFiledByDeleter!.id).single();
    expect(reportFiledAfter?.profile_id).toBeNull();

    const { data: reportResolvedAfter } = await db
      .from("reports").select("resolved_by, profile_id").eq("id", reportResolvedByDeleter!.id).single();
    expect(reportResolvedAfter?.resolved_by).toBeNull();
    expect(reportResolvedAfter?.profile_id).toBe(userId);

    const { data: studioAfter } = await db
      .from("studio_details").select("claimed_by").eq("spot_id", deletionSpotId).single();
    expect(studioAfter?.claimed_by).toBeNull();

    const { data: signalsAfter } = await db
      .from("signals").select("id").eq("spot_id", deletionSpotId);
    expect(signalsAfter).toEqual([]);

    // reports.target_id is polymorphic with no foreign key, so deleting the
    // spot does not cascade to its reports — and reports.profile_id is ON
    // DELETE SET NULL, so deleting the reporter orphans the row rather than
    // removing it. Both reports above would otherwise outlive this file.
    await db.from("reports").delete().eq("target_id", deletionSpotId);
    await db.from("spots").delete().eq("id", deletionSpotId);
  });
});
