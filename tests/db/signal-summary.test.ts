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
let probeId: number;

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

  // A probe type that makes the ordering observable. The seed sets
  // sort_order = id * 10, so across the seeded rows id order and sort_order
  // order agree exactly and no assertion can distinguish them. This row is the
  // newest id (so it sorts last by id), the lowest sort_order (so it sorts
  // first by sort_order) and a label that sorts last alphabetically — which
  // makes `order by id`, `order by label` and a missing ORDER BY all visible.
  const { data: probe, error: probeError } = await admin
    .from("shoot_types")
    .insert({ slug: "zz-order-probe", label: "Zulu Probe", sort_order: 5 })
    .select("id")
    .single();
  if (probeError) throw probeError;
  probeId = probe.id;

  // Every object carries the same keys: PostgREST unions the keys of a bulk
  // insert and nulls the gaps, bypassing column defaults.
  const { error: linkError } = await admin.from("spot_shoot_types").insert([
    { spot_id: spotId, shoot_type_id: familyId },
    { spot_id: spotId, shoot_type_id: petsId },
    { spot_id: spotId, shoot_type_id: probeId },
  ]);
  if (linkError) throw linkError;
});

afterAll(async () => {
  // The spot goes first: spot_shoot_types cascades from it, and those rows
  // reference the probe type, which cannot be deleted while they exist.
  await serviceClient().from("spots").delete().eq("id", spotId);
  await serviceClient().from("shoot_types").delete().eq("id", probeId);
  await deleteTestUser(voter.id);
  await deleteTestUser(other.id);
});

const summary = async (client = anonClient(), id = spotId): Promise<SummaryRow[]> => {
  const { data, error } = await client.rpc("spot_signal_summary", { p_spot_id: id });
  expect(error).toBeNull();
  return (data ?? []) as SummaryRow[];
};

// These tests run in order and share state deliberately: each one builds on
// the votes cast by the one before it.
describe("spot_signal_summary", () => {
  it("is callable by a logged-out visitor, since browsing is open (spec §4.6)", async () => {
    const rows = await summary();
    expect(rows).toHaveLength(3);
  });

  it("lists every tagged shoot type at zero before anyone votes", async () => {
    const rows = await summary();
    expect(rows.map((r) => r.slug).sort()).toEqual(["family", "pets", "zz-order-probe"]);
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

  // Asserts the exact sequence, not merely that sort_order is non-decreasing.
  // The weaker form passes under `order by id`, under `order by label` and
  // with no ORDER BY at all, because the seeded rows have sort_order = id * 10
  // and every one of those orders coincides. zz-order-probe is last by id and
  // by label but first by sort_order, so only a real sort_order ordering
  // produces this sequence.
  it("orders by sort_order", async () => {
    const rows = await summary();
    expect(rows.map((r) => r.slug)).toEqual(["zz-order-probe", "family", "pets"]);
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

  // Depends on running after the voting tests: it is the votes on the *other*
  // spot that give `where s.spot_id = p_spot_id` something to exclude. Move
  // this test earlier and it still passes, but stops covering that filter.
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

    // finally, so a failed assertion cannot strand a published spot in the
    // database: spots.created_by is `on delete set null`, so deleting the test
    // user would leave the row behind without any error to notice.
    try {
      expect(await summary(anonClient(), data.id)).toEqual([]);
    } finally {
      await admin.from("spots").delete().eq("id", data.id);
    }
  });

  // The function never selects from public.spots, so spots_read cannot filter
  // it. Without an explicit status check the vote breakdown of a removed spot
  // is readable by anyone holding its id. The spot is both tagged and voted on
  // so that neither branch of the union can smuggle it through — a status
  // check left outside the parentheses would still fail this test.
  it("returns nothing for a spot RLS hides, even to a caller holding its id", async () => {
    const admin = serviceClient();
    const { data, error } = await admin
      .from("spots")
      .insert({
        kind: "outdoor",
        name: "Removed Spot",
        slug: `removed-${crypto.randomUUID().slice(0, 8)}`,
        location: "POINT(-85.7 42.97)",
        created_by: voter.id,
        status: "removed",
      })
      .select("id")
      .single();
    if (error) throw error;

    try {
      await admin.from("spot_shoot_types").insert({ spot_id: data.id, shoot_type_id: familyId });
      await admin.from("signals").insert({
        spot_id: data.id,
        profile_id: voter.id,
        kind: "shoot_type_upvote",
        shoot_type_id: familyId,
        value: 1,
      });

      // The spot really is hidden by RLS, so the RPC is the only way in.
      const { data: visible } = await anonClient().from("spots").select("id").eq("id", data.id);
      expect(visible).toEqual([]);

      expect(await summary(anonClient(), data.id)).toEqual([]);
    } finally {
      await admin.from("spots").delete().eq("id", data.id);
    }
  });

  // The other half of the guard: it must hide unpublished spots without
  // hiding published ones.
  it("still returns rows for a published spot", async () => {
    const rows = await summary();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.find((r) => r.slug === "family")!.upvote_count).toBe(2);
  });
});
