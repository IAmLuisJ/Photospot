import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  serviceClient,
  anonClient,
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./helpers";

let voter: TestUser;
let other: TestUser;
let spotId: string;
let familyTypeId: number;

beforeAll(async () => {
  voter = await createTestUser("Voter");
  other = await createTestUser("Other");
  const db = serviceClient();

  const { data: spot } = await db
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "RPC Test Spot",
      slug: `rpc-test-${Date.now()}`,
      location: "POINT(-85.7267 42.9214)",
      created_by: voter.id,
    })
    .select("id")
    .single();
  spotId = spot!.id;

  const { data: types } = await db.from("shoot_types").select("id").eq("slug", "family").single();
  familyTypeId = types!.id;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  for (const u of [voter, other]) await deleteTestUser(u.id);
});

const signalsFor = async (profileId: string) => {
  const { data } = await serviceClient()
    .from("signals")
    .select("kind, shoot_type_id, value")
    .eq("spot_id", spotId)
    .eq("profile_id", profileId);
  return data ?? [];
};

describe("spots_within_meters access", () => {
  // The duplicate check runs during submission, which requires an account.
  it("is callable by a signed-in user", async () => {
    const { error } = await voter.client.rpc("spots_within_meters", {
      p_lng: -85.7267,
      p_lat: 42.9223,
      p_meters: 250,
      p_kind: "outdoor",
    });
    expect(error).toBeNull();
  });

  it("is not callable by a logged-out visitor", async () => {
    const { error } = await anonClient().rpc("spots_within_meters", {
      p_lng: -85.7267,
      p_lat: 42.9223,
      p_meters: 250,
      p_kind: "outdoor",
    });
    expect(error).not.toBeNull();
  });
});

describe("cast_signal", () => {
  it("records a shoot-again vote", async () => {
    const { error } = await voter.client.rpc("cast_signal", {
      p_spot_id: spotId,
      p_kind: "shoot_again",
      p_value: 1,
    });
    expect(error).toBeNull();

    const rows = await signalsFor(voter.id);
    expect(rows.filter((r) => r.kind === "shoot_again")).toHaveLength(1);
    expect(rows.find((r) => r.kind === "shoot_again")?.value).toBe(1);
  });

  // The reason this function exists. Done client-side as delete-then-insert,
  // a failure between the two silently discards the vote the optimistic UI has
  // already shown as changed.
  it("flips a vote in one call, leaving exactly one row", async () => {
    const { error } = await voter.client.rpc("cast_signal", {
      p_spot_id: spotId,
      p_kind: "shoot_again",
      p_value: 0,
    });
    expect(error).toBeNull();

    const rows = (await signalsFor(voter.id)).filter((r) => r.kind === "shoot_again");
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(0);
  });

  it("is idempotent, so a double click is not an error", async () => {
    const args = { p_spot_id: spotId, p_kind: "shoot_type_upvote", p_shoot_type_id: familyTypeId };
    expect((await voter.client.rpc("cast_signal", args)).error).toBeNull();
    expect((await voter.client.rpc("cast_signal", args)).error).toBeNull();

    const rows = (await signalsFor(voter.id)).filter((r) => r.kind === "shoot_type_upvote");
    expect(rows).toHaveLength(1);
  });

  it("attributes the vote to the caller, not to a supplied id", async () => {
    await other.client.rpc("cast_signal", {
      p_spot_id: spotId,
      p_kind: "shoot_again",
      p_value: 1,
    });
    // voter's own shoot_again vote is untouched, and the new row belongs to other
    expect((await signalsFor(other.id)).filter((r) => r.kind === "shoot_again")).toHaveLength(1);
    expect(
      (await signalsFor(voter.id)).find((r) => r.kind === "shoot_again")?.value,
    ).toBe(0);
  });

  it("rejects a logged-out caller", async () => {
    const { error } = await anonClient().rpc("cast_signal", {
      p_spot_id: spotId,
      p_kind: "shoot_again",
      p_value: 1,
    });
    expect(error).not.toBeNull();
  });

  it("keeps the counters correct across a flip", async () => {
    const counts = async () => {
      const { data } = await serviceClient()
        .from("spots")
        .select("shoot_again_yes_count, shoot_again_no_count")
        .eq("id", spotId)
        .single();
      return data!;
    };

    // voter is currently 'no', other is 'yes'
    let c = await counts();
    expect(c.shoot_again_no_count).toBe(1);
    expect(c.shoot_again_yes_count).toBe(1);

    await voter.client.rpc("cast_signal", {
      p_spot_id: spotId,
      p_kind: "shoot_again",
      p_value: 1,
    });

    c = await counts();
    expect(c.shoot_again_no_count).toBe(0);
    expect(c.shoot_again_yes_count).toBe(2);
  });

  it("still refuses a malformed signal, so the check constraint is not bypassed", async () => {
    // shoot_type_upvote with no shoot type violates signals_shape.
    const { error } = await voter.client.rpc("cast_signal", {
      p_spot_id: spotId,
      p_kind: "shoot_type_upvote",
      p_value: 1,
    });
    expect(error).not.toBeNull();
  });
});
