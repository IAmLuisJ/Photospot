import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import {
  getShootTypeVotes,
  getViewerShootAgain,
  castSignal,
  retractSignal,
  isDuplicateSignal,
} from "../../app/data/signals";

let voter: TestUser;
let other: TestUser;
let spotId: string;
/** A second spot, so "retract" can be shown not to reach across spots. */
let otherSpotId: string;
let familyId: number;

beforeAll(async () => {
  voter = await createTestUser("Data Voter");
  other = await createTestUser("Data Other");
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
      name: "Signals Data Park",
      slug: `signals-data-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.67 42.94)",
      created_by: voter.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = data.id;

  const { data: second, error: secondError } = await admin
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Signals Data Park Two",
      slug: `signals-data-two-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.66 42.93)",
      created_by: voter.id,
      status: "published",
    })
    .select("id")
    .single();
  if (secondError) throw secondError;
  otherSpotId = second.id;

  // Both objects carry the same keys: PostgREST unions the keys of a bulk
  // insert and nulls the gaps, bypassing column defaults.
  const { error: linkError } = await admin.from("spot_shoot_types").insert([
    { spot_id: spotId, shoot_type_id: familyId },
    { spot_id: otherSpotId, shoot_type_id: familyId },
  ]);
  if (linkError) throw linkError;
});

afterAll(async () => {
  // Throws rather than discarding the error, matching deleteTestUser: a silent
  // cleanup failure here leaves a published spot on the local map.
  const { error } = await serviceClient()
    .from("spots")
    .delete()
    .in("id", [spotId, otherSpotId]);
  if (error) throw error;
  await deleteTestUser(voter.id);
  await deleteTestUser(other.id);
});

const upvote = (shootTypeId: number) =>
  ({ spotId, kind: "shoot_type_upvote", shootTypeId }) as const;
const shootAgain = () => ({ spotId, kind: "shoot_again", shootTypeId: null }) as const;

// These tests share state and run in order: each builds on the votes cast by
// the one before it.
describe("getShootTypeVotes", () => {
  it("maps the RPC into camelCase rows a component can render", async () => {
    const rows = await getShootTypeVotes(anonClient(), spotId);
    expect(rows).toEqual([
      {
        shootTypeId: familyId,
        slug: "family",
        label: "Family",
        upvoteCount: 0,
        viewerUpvoted: false,
      },
    ]);
  });
});

describe("castSignal", () => {
  it("records an upvote and reflects it back to the voter", async () => {
    await castSignal(voter.client, upvote(familyId));

    const rows = await getShootTypeVotes(voter.client, spotId);
    expect(rows[0].upvoteCount).toBe(1);
    expect(rows[0].viewerUpvoted).toBe(true);
  });

  it("swallows a duplicate, because a double click is a no-op not an error (spec §9.2)", async () => {
    await expect(castSignal(voter.client, upvote(familyId))).resolves.toBeUndefined();

    const rows = await getShootTypeVotes(voter.client, spotId);
    expect(rows[0].upvoteCount).toBe(1);
  });

  it("flips a shoot-again answer in one call", async () => {
    await castSignal(voter.client, shootAgain(), 1);
    expect(await getViewerShootAgain(voter.client, spotId, voter.id)).toBe(1);

    await castSignal(voter.client, shootAgain(), 0);
    expect(await getViewerShootAgain(voter.client, spotId, voter.id)).toBe(0);

    const { data } = await serviceClient()
      .from("spots")
      .select("shoot_again_yes_count, shoot_again_no_count")
      .eq("id", spotId)
      .single();
    expect(data).toEqual({ shoot_again_yes_count: 0, shoot_again_no_count: 1 });
  });

  // A permission failure must surface, not be swallowed alongside duplicates.
  it("refuses a logged-out caller with a permission error, not a silent no-op", async () => {
    await expect(castSignal(anonClient(), upvote(familyId))).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("isDuplicateSignal", () => {
  // Built from an error Postgres actually produced, not a hand-written object:
  // the whole point of the predicate is that it matches the real SQLSTATE.
  it("recognises the unique violation the constraint raises", async () => {
    const insert = () =>
      other.client.from("signals").insert({
        spot_id: spotId,
        profile_id: other.id,
        kind: "shoot_type_upvote",
        shoot_type_id: familyId,
        value: 1,
      });

    const first = await insert();
    expect(first.error).toBeNull();

    const second = await insert();
    expect(second.error?.code).toBe("23505");
    expect(isDuplicateSignal(second.error)).toBe(true);
  });

  it("does not mistake a permission error for a duplicate", async () => {
    const { error } = await anonClient().from("signals").insert({
      spot_id: spotId,
      profile_id: other.id,
      kind: "shoot_again",
      shoot_type_id: null,
      value: 1,
    });
    expect(error?.code).toBe("42501");
    expect(isDuplicateSignal(error)).toBe(false);
  });

  it("is false for no error at all", () => {
    expect(isDuplicateSignal(null)).toBe(false);
  });
});

describe("retractSignal", () => {
  it("removes the caller's own vote and leaves everyone else's", async () => {
    // `other` upvoted family in the isDuplicateSignal test above.
    await retractSignal(voter.client, upvote(familyId));

    const rows = await getShootTypeVotes(other.client, spotId);
    expect(rows[0].upvoteCount).toBe(1);
    expect(rows[0].viewerUpvoted).toBe(true);
  });

  // RLS carries this rule, not an application filter: signals_delete is
  // `using (profile_id = auth.uid())`. A delete naming someone else's row
  // matches nothing rather than erroring, so assert on what survived.
  it("cannot delete somebody else's vote", async () => {
    await retractSignal(voter.client, upvote(familyId));

    const { count, error } = await serviceClient()
      .from("signals")
      .select("id", { count: "exact", head: true })
      .eq("spot_id", spotId)
      .eq("profile_id", other.id)
      .eq("kind", "shoot_type_upvote");
    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  // Without the spot filter the delete is scoped only by kind and shoot type,
  // so taking back one upvote would silently remove the same vote from every
  // other spot the user had upvoted for that shoot type.
  it("retracts the vote on one spot only, not the same vote everywhere", async () => {
    await castSignal(voter.client, upvote(familyId));
    await castSignal(voter.client, { ...upvote(familyId), spotId: otherSpotId });

    await retractSignal(voter.client, upvote(familyId));

    const here = await getShootTypeVotes(voter.client, spotId);
    const there = await getShootTypeVotes(voter.client, otherSpotId);
    expect(here[0].viewerUpvoted).toBe(false);
    expect(there[0].viewerUpvoted).toBe(true);
  });

  // shoot_again rows carry a null shoot_type_id, and `.eq(col, null)` sends
  // `col=eq.null`, which matches nothing. This is the `.is` path.
  it("retracts a shoot-again answer, matching the null shoot_type_id", async () => {
    expect(await getViewerShootAgain(voter.client, spotId, voter.id)).toBe(0);

    await retractSignal(voter.client, shootAgain());
    expect(await getViewerShootAgain(voter.client, spotId, voter.id)).toBeNull();
  });
});

describe("getViewerShootAgain", () => {
  it("returns null for a logged-out visitor without querying", async () => {
    expect(await getViewerShootAgain(anonClient(), spotId, null)).toBeNull();
  });
});

// supabase-js returns errors, it does not throw. A mapper that ignores `error`
// and reads `data` returns an empty list on failure, so the page renders "no
// votes yet" for what is actually a broken query.
describe("error propagation", () => {
  it("throws when the summary RPC fails rather than returning nothing", async () => {
    await expect(getShootTypeVotes(anonClient(), "not-a-uuid")).rejects.toMatchObject({
      code: "22P02",
    });
  });

  it("throws when the shoot-again lookup fails", async () => {
    await expect(
      getViewerShootAgain(anonClient(), "not-a-uuid", voter.id),
    ).rejects.toMatchObject({ code: "22P02" });
  });
});
