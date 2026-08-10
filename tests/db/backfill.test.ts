import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { backfillScores } from "../../scripts/backfill-scores";
import { serviceClient, createTestUser, deleteTestUser } from "./helpers";

let userId: string;
let spotId: string;
let familyTypeId: number;

beforeAll(async () => {
  userId = (await createTestUser("Backfiller")).id;
  const db = serviceClient();

  const { data: spot } = await db
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Backfill Spot",
      slug: `backfill-${Date.now()}`,
      location: "POINT(-85.7267 42.9214)",
      created_by: userId,
    })
    .select("id")
    .single();
  spotId = spot!.id;

  const { data: types } = await db.from("shoot_types").select("id").eq("slug", "family");
  familyTypeId = types![0].id;

  await db.from("signals").insert({
    spot_id: spotId,
    profile_id: userId,
    kind: "shoot_type_upvote",
    shoot_type_id: familyTypeId,
    value: 1,
  });
  await db
    .from("comments")
    .insert({ spot_id: spotId, profile_id: userId, body: "Good parking." });
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  await deleteTestUser(userId);
});

const scoreOf = async (): Promise<number> => {
  const { data } = await serviceClient().from("spots").select("score").eq("id", spotId).single();
  return Number(data!.score);
};

describe("backfillScores", () => {
  it("writes the weighted score from the counters", async () => {
    const updated = await backfillScores(serviceClient());
    expect(updated).toBeGreaterThan(0);
    // 1 upvote (1.0) + 1 comment (0.5)
    expect(await scoreOf()).toBe(1.5);
  });

  it("applies alternative weights when re-weighting", async () => {
    await backfillScores(serviceClient(), {
      shootTypeUpvote: 10,
      shootAgainYes: 2,
      shootAgainNo: -1.5,
      comment: 0,
      scoutingPhoto: 1,
      sessionPhoto: 1.5,
    });
    expect(await scoreOf()).toBe(10);
  });

  it("is idempotent", async () => {
    await backfillScores(serviceClient());
    const first = await scoreOf();
    await backfillScores(serviceClient());
    expect(await scoreOf()).toBe(first);
  });
});
