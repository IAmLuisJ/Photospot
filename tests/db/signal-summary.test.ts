import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";

interface SummaryRow {
  shoot_type_id: number;
  slug: string;
  label: string;
  sort_order: number;
  upvote_count: number;
  viewer_upvoted: boolean;
}

let voter: TestUser;
let other: TestUser;
let spotId: string;
let familyId: number;
let petsId: number;

beforeAll(async () => {
  voter = await createTestUser("Summary Voter");
  other = await createTestUser("Summary Other");
  const admin = serviceClient();

  const { data: types, error: typeError } = await admin.from("shoot_types").select("id, slug");
  if (typeError) throw typeError;
  familyId = types!.find((t) => t.slug === "family")!.id;
  petsId = types!.find((t) => t.slug === "pets")!.id;

  const { data, error } = await admin
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Signal Summary Park",
      slug: `signal-summary-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.68 42.95)",
      created_by: voter.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = data.id;

  // Both objects carry the same keys: PostgREST unions the keys of a bulk
  // insert and nulls the gaps, bypassing column defaults.
  const { error: linkError } = await admin.from("spot_shoot_types").insert([
    { spot_id: spotId, shoot_type_id: familyId },
    { spot_id: spotId, shoot_type_id: petsId },
  ]);
  if (linkError) throw linkError;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  await deleteTestUser(voter.id);
  await deleteTestUser(other.id);
});

const summary = async (client = anonClient()): Promise<SummaryRow[]> => {
  const { data, error } = await client.rpc("spot_signal_summary", { p_spot_id: spotId });
  expect(error).toBeNull();
  return (data ?? []) as SummaryRow[];
};

// These tests run in order and share state deliberately: each one builds on
// the votes cast by the one before it.
describe("spot_signal_summary", () => {
  it("is callable by a logged-out visitor, since browsing is open (spec §4.6)", async () => {
    const rows = await summary();
    expect(rows).toHaveLength(2);
  });

  it("lists every tagged shoot type at zero before anyone votes", async () => {
    const rows = await summary();
    expect(rows.map((r) => r.slug).sort()).toEqual(["family", "pets"]);
    expect(rows.every((r) => r.upvote_count === 0)).toBe(true);
    expect(rows.every((r) => r.viewer_upvoted === false)).toBe(true);
  });

  it("counts upvotes per shoot type, not as one total", async () => {
    for (const [user, typeId] of [
      [voter, familyId],
      [other, familyId],
      [voter, petsId],
    ] as const) {
      const { error } = await user.client.rpc("cast_signal", {
        p_spot_id: spotId,
        p_kind: "shoot_type_upvote",
        p_shoot_type_id: typeId,
      });
      expect(error).toBeNull();
    }

    const rows = await summary();
    expect(rows.find((r) => r.slug === "family")!.upvote_count).toBe(2);
    expect(rows.find((r) => r.slug === "pets")!.upvote_count).toBe(1);
  });

  it("reports viewer_upvoted for the caller and nobody else", async () => {
    const mine = await summary(voter.client);
    expect(mine.find((r) => r.slug === "family")!.viewer_upvoted).toBe(true);
    expect(mine.find((r) => r.slug === "pets")!.viewer_upvoted).toBe(true);

    const theirs = await summary(other.client);
    expect(theirs.find((r) => r.slug === "family")!.viewer_upvoted).toBe(true);
    expect(theirs.find((r) => r.slug === "pets")!.viewer_upvoted).toBe(false);

    const loggedOut = await summary();
    expect(loggedOut.every((r) => r.viewer_upvoted === false)).toBe(true);
  });

  it("orders by sort_order", async () => {
    const rows = await summary();
    const orders = rows.map((r) => r.sort_order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  // A spot's shoot types are editable (plan 3). Listing only the currently
  // tagged types would drop these votes off the page while
  // spots.shoot_type_upvote_count still counts them, so the totals line and
  // the breakdown would disagree with no error anywhere.
  it("keeps a shoot type that still carries votes after it is untagged", async () => {
    const { error } = await serviceClient()
      .from("spot_shoot_types")
      .delete()
      .eq("spot_id", spotId)
      .eq("shoot_type_id", petsId);
    expect(error).toBeNull();

    const rows = await summary();
    const pets = rows.find((r) => r.slug === "pets");
    expect(pets).toBeDefined();
    expect(pets!.upvote_count).toBe(1);
  });

  it("returns nothing for a spot with no shoot types and no votes", async () => {
    const admin = serviceClient();
    const { data, error } = await admin
      .from("spots")
      .insert({
        kind: "outdoor",
        name: "Untagged Spot",
        slug: `untagged-${crypto.randomUUID().slice(0, 8)}`,
        location: "POINT(-85.69 42.96)",
        created_by: voter.id,
        status: "published",
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: rows } = await anonClient().rpc("spot_signal_summary", { p_spot_id: data.id });
    expect(rows).toEqual([]);

    await admin.from("spots").delete().eq("id", data.id);
  });
});
