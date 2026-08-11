import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { refreshSpotScore } from "../../app/data/scores";
import { castSignal } from "../../app/data/signals";
import { addComment } from "../../app/data/comments";
import { DEFAULT_WEIGHTS } from "../../app/domain/scoring/weights";

let voter: TestUser;
let spotId: string;
let familyId: number;

beforeAll(async () => {
  voter = await createTestUser("Score Voter");
  const admin = serviceClient();

  const { data: types, error: typeError } = await admin
    .from("shoot_types")
    .select("id, slug")
    .eq("slug", "family");
  if (typeError) throw typeError;
  familyId = types![0].id;

  const { data, error } = await admin
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Score Park",
      slug: `score-park-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.65 42.92)",
      created_by: voter.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = data.id;

  const { error: linkError } = await admin
    .from("spot_shoot_types")
    .insert({ spot_id: spotId, shoot_type_id: familyId });
  if (linkError) throw linkError;
});

afterAll(async () => {
  const { error } = await serviceClient().from("spots").delete().eq("id", spotId);
  if (error) throw error;
  await deleteTestUser(voter.id);
});

const storedScore = async (): Promise<number> => {
  const { data, error } = await serviceClient()
    .from("spots")
    .select("score")
    .eq("id", spotId)
    .single();
  if (error) throw error;
  // numeric arrives from PostgREST as a string, to avoid precision loss.
  return Number(data.score);
};

// These tests run in order and share state: each builds on the activity of the
// one before it.
describe("refreshSpotScore", () => {
  it("starts at zero, since nothing has happened to the spot", async () => {
    expect(await storedScore()).toBe(0);
  });

  // The gap this closes. `authenticated` has no UPDATE privilege on
  // spots.score, deliberately — score is the default sort order, so a
  // user-writable column is rank manipulation.
  it("leaves the score stale until it is called", async () => {
    await castSignal(voter.client, {
      spotId,
      kind: "shoot_type_upvote",
      shootTypeId: familyId,
    });

    const { data, error } = await serviceClient()
      .from("spots")
      .select("shoot_type_upvote_count, score")
      .eq("id", spotId)
      .single();
    if (error) throw error;
    expect(data.shoot_type_upvote_count).toBe(1);
    expect(Number(data.score)).toBe(0);
  });

  it("writes the weighted score the counters imply", async () => {
    const written = await refreshSpotScore(serviceClient(), spotId);
    expect(written).toBe(DEFAULT_WEIGHTS.shootTypeUpvote);
    expect(await storedScore()).toBe(DEFAULT_WEIGHTS.shootTypeUpvote);
  });

  it("counts comments and shoot-again answers too, not just upvotes", async () => {
    await addComment(voter.client, spotId, "Gravel path, but short.", voter.id);
    await castSignal(voter.client, { spotId, kind: "shoot_again", shootTypeId: null }, 1);

    const expected =
      DEFAULT_WEIGHTS.shootTypeUpvote + DEFAULT_WEIGHTS.comment + DEFAULT_WEIGHTS.shootAgainYes;
    expect(await refreshSpotScore(serviceClient(), spotId)).toBe(expected);
    expect(await storedScore()).toBe(expected);
  });

  it("follows the counters back down when a vote is retracted", async () => {
    const { error } = await serviceClient()
      .from("signals")
      .delete()
      .eq("spot_id", spotId)
      .eq("kind", "shoot_type_upvote");
    if (error) throw error;

    const expected = DEFAULT_WEIGHTS.comment + DEFAULT_WEIGHTS.shootAgainYes;
    expect(await refreshSpotScore(serviceClient(), spotId)).toBe(expected);
  });

  // A "no" answer is worth -1.5, so the arithmetic has to survive the sign.
  it("handles a negative contribution without clamping it", async () => {
    await castSignal(voter.client, { spotId, kind: "shoot_again", shootTypeId: null }, 0);

    const expected = DEFAULT_WEIGHTS.comment + DEFAULT_WEIGHTS.shootAgainNo;
    expect(await refreshSpotScore(serviceClient(), spotId)).toBe(expected);
    expect(expected).toBeLessThan(0);
  });

  // The whole point of the service-role client. If this ever starts passing,
  // spots.score has become writable by application roles and the ranking is
  // user-controlled.
  it("cannot be done with the caller's own client, because score is not theirs to write", async () => {
    const { error } = await voter.client.from("spots").update({ score: 9999 }).eq("id", spotId);
    expect(error?.code).toBe("42501");
    expect(await storedScore()).toBeLessThan(9999);
  });

  // Handed the wrong client — a live possibility, since the route action holds
  // both — the read succeeds and only the write is refused. Swallowing that
  // would leave every score frozen with nothing failing anywhere.
  it("throws when handed a client that may not write the score", async () => {
    const before = await storedScore();

    await expect(refreshSpotScore(voter.client, spotId)).rejects.toMatchObject({
      code: "42501",
    });
    expect(await storedScore()).toBe(before);
  });

  // PGRST116 specifically, not merely "something threw": with the read error
  // ignored, `data` is null and the mapping throws a TypeError instead, which
  // a looser assertion cannot tell apart from the error being propagated.
  it("throws rather than silently skipping an unknown spot", async () => {
    await expect(
      refreshSpotScore(serviceClient(), "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: "PGRST116" });
  });
});
