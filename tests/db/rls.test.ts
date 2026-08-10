import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  serviceClient,
  anonClient,
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./helpers";

let author: TestUser;
let stranger: TestUser;
let admin: TestUser;
let spotId: string;

beforeAll(async () => {
  author = await createTestUser("Author");
  stranger = await createTestUser("Stranger");
  admin = await createTestUser("Admin");

  const db = serviceClient();
  await db.from("profiles").update({ role: "admin" }).eq("id", admin.id);

  const { data } = await db
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "RLS Test Spot",
      slug: `rls-test-${Date.now()}`,
      location: "POINT(-85.7267 42.9214)",
      created_by: author.id,
    })
    .select("id")
    .single();
  spotId = data!.id;
});

afterAll(async () => {
  await serviceClient().from("spots").delete().eq("id", spotId);
  for (const u of [author, stranger, admin]) await deleteTestUser(u.id);
});

describe("spot visibility", () => {
  it("lets a logged-out visitor read published spots", async () => {
    const { data, error } = await anonClient()
      .from("spots")
      .select("id")
      .eq("id", spotId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(spotId);
  });

  it("hides removed spots from the public", async () => {
    await serviceClient().from("spots").update({ status: "removed" }).eq("id", spotId);
    const { data } = await anonClient().from("spots").select("id").eq("id", spotId).maybeSingle();
    expect(data).toBeNull();
    await serviceClient().from("spots").update({ status: "published" }).eq("id", spotId);
  });
});

describe("spot writes", () => {
  it("refuses a spot insert from a logged-out visitor", async () => {
    const { error } = await anonClient().from("spots").insert({
      kind: "outdoor",
      name: "Anon Spot",
      slug: `anon-${Date.now()}`,
      location: "POINT(-85.7 42.9)",
      created_by: author.id,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a spot insert attributed to someone else", async () => {
    const { error } = await stranger.client.from("spots").insert({
      kind: "outdoor",
      name: "Forged Spot",
      slug: `forged-${Date.now()}`,
      location: "POINT(-85.7 42.9)",
      created_by: author.id,
    });
    expect(error).not.toBeNull();
  });

  it("lets the submitter edit their own spot", async () => {
    const { error } = await author.client
      .from("spots")
      .update({ description: "Updated by the author." })
      .eq("id", spotId);
    expect(error).toBeNull();
  });

  it("does not let a stranger edit someone else's spot", async () => {
    const { data } = await stranger.client
      .from("spots")
      .update({ description: "Hijacked." })
      .eq("id", spotId)
      .select("id");
    expect(data ?? []).toEqual([]);

    const { data: check } = await serviceClient()
      .from("spots")
      .select("description")
      .eq("id", spotId)
      .single();
    expect(check?.description).not.toBe("Hijacked.");
  });

  it("lets an admin edit any spot", async () => {
    const { data, error } = await admin.client
      .from("spots")
      .update({ description: "Moderated." })
      .eq("id", spotId)
      .select("id");
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });
});

describe("votes", () => {
  it("refuses a vote from a logged-out visitor", async () => {
    const { error } = await anonClient().from("signals").insert({
      spot_id: spotId,
      profile_id: author.id,
      kind: "shoot_again",
      value: 1,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a vote cast in someone else's name", async () => {
    const { error } = await stranger.client.from("signals").insert({
      spot_id: spotId,
      profile_id: author.id,
      kind: "shoot_again",
      value: 1,
    });
    expect(error).not.toBeNull();
  });

  it("accepts a vote cast in the voter's own name", async () => {
    const { error } = await stranger.client.from("signals").insert({
      spot_id: spotId,
      profile_id: stranger.id,
      kind: "shoot_again",
      value: 1,
    });
    expect(error).toBeNull();
  });
});

describe("derived columns", () => {
  it("does not let a user write their own score", async () => {
    await author.client.from("spots").update({ score: 9999 }).eq("id", spotId);
    const { data } = await serviceClient().from("spots").select("score").eq("id", spotId).single();
    expect(Number(data?.score)).not.toBe(9999);
  });
});

describe("privilege escalation", () => {
  // The profiles_update_own policy authorises the ROW, not the columns, so it
  // cannot stop a user rewriting their own `role`. Only the column-scoped grant
  // does. Since is_admin() reads profiles.role, a hole here is total.
  it("does not let a user promote themselves to admin", async () => {
    await stranger.client.from("profiles").update({ role: "admin" }).eq("id", stranger.id);

    const { data } = await serviceClient()
      .from("profiles")
      .select("role")
      .eq("id", stranger.id)
      .single();

    expect(data?.role).toBe("user");
  });

  it("still lets a user edit their own display name", async () => {
    const { error } = await stranger.client
      .from("profiles")
      .update({ display_name: "Renamed" })
      .eq("id", stranger.id);
    expect(error).toBeNull();

    const { data } = await serviceClient()
      .from("profiles")
      .select("display_name")
      .eq("id", stranger.id)
      .single();
    expect(data?.display_name).toBe("Renamed");
  });
});

// Proves the base grants exist at all. Without them every test above would fail
// with 42501 before RLS was consulted, which is a different failure than a
// policy correctly denying access — and the assertions cannot tell them apart.
describe("base privileges", () => {
  it("lets a logged-out visitor read reference data", async () => {
    const { data, error } = await anonClient().from("shoot_types").select("slug");
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(9);
  });

  // Distinguishes an RLS denial from a missing grant. Both surface as a
  // non-null error, so without checking the code a grant regression would keep
  // these tests green while breaking the app.
  it("denies an anonymous write with an RLS violation, not a missing grant", async () => {
    const { error } = await anonClient().from("comments").insert({
      spot_id: spotId,
      profile_id: author.id,
      body: "nope",
    });
    expect(error?.code).toBe("42501");
  });
});

describe("studio claiming", () => {
  let studioSpotId: string;

  beforeAll(async () => {
    const { data } = await serviceClient()
      .from("spots")
      .insert({
        kind: "studio",
        name: "Claimable Studio",
        slug: `claimable-${Date.now()}`,
        location: "POINT(-85.67 42.96)",
        created_by: author.id,
      })
      .select("id")
      .single();
    studioSpotId = data!.id;

    await serviceClient().from("studio_details").insert({
      spot_id: studioSpotId,
      contact_email: "owner@studio.example",
    });
  });

  afterAll(async () => {
    await serviceClient().from("spots").delete().eq("id", studioSpotId);
  });

  // The hole this closes: with a `for all` policy, only WITH CHECK applies on
  // INSERT, so naming yourself in claimed_by was enough to claim any studio.
  it("does not let a stranger claim a studio by writing claimed_by", async () => {
    await stranger.client
      .from("studio_details")
      .update({ claimed_by: stranger.id })
      .eq("spot_id", studioSpotId);

    const { data } = await serviceClient()
      .from("studio_details")
      .select("claimed_by")
      .eq("spot_id", studioSpotId)
      .single();

    expect(data?.claimed_by).toBeNull();
  });

  it("does not let a stranger claim via the RPC without a matching email", async () => {
    const { error } = await stranger.client.rpc("claim_studio", { p_spot_id: studioSpotId });
    expect(error).not.toBeNull();

    const { data } = await serviceClient()
      .from("studio_details")
      .select("claimed_by")
      .eq("spot_id", studioSpotId)
      .single();
    expect(data?.claimed_by).toBeNull();
  });

  it("lets the listing creator edit contact details without claiming", async () => {
    const { error } = await author.client
      .from("studio_details")
      .update({ hourly_rate_cents: 12000 })
      .eq("spot_id", studioSpotId);
    expect(error).toBeNull();
  });

  // The happy path, which every other test here only approaches from the
  // rejection side. Without it, a claim flow that can never succeed — the
  // mirror image of the bug this design replaced — would pass the suite.
  it("lets someone whose verified email matches the listing claim it", async () => {
    const db = serviceClient();
    const { data: spot } = await db
      .from("spots")
      .insert({
        kind: "studio",
        name: "Claimable By Owner",
        slug: `owner-claim-${Date.now()}`,
        location: "POINT(-85.67 42.96)",
        created_by: author.id,
      })
      .select("id")
      .single();

    // The listing's contact address is the claimant's own confirmed email.
    await db
      .from("studio_details")
      .insert({ spot_id: spot!.id, contact_email: stranger.email });

    const { error } = await stranger.client.rpc("claim_studio", { p_spot_id: spot!.id });
    expect(error).toBeNull();

    const { data: details } = await db
      .from("studio_details")
      .select("claimed_by, claimed_at")
      .eq("spot_id", spot!.id)
      .single();
    expect(details?.claimed_by).toBe(stranger.id);
    expect(details?.claimed_at).not.toBeNull();

    // §9.3: the claim sets ownership on the spot as well.
    const { data: owned } = await db
      .from("spots")
      .select("owner_profile_id")
      .eq("id", spot!.id)
      .single();
    expect(owned?.owner_profile_id).toBe(stranger.id);

    // A claimed listing cannot be claimed again.
    const { error: again } = await stranger.client.rpc("claim_studio", {
      p_spot_id: spot!.id,
    });
    expect(again).not.toBeNull();

    await db.from("spots").delete().eq("id", spot!.id);
  });
});

describe("moderation", () => {
  it("does not let an author un-remove their own comment", async () => {
    const { data: comment } = await serviceClient()
      .from("comments")
      .insert({ spot_id: spotId, profile_id: author.id, body: "Needs moderating." })
      .select("id")
      .single();

    // Admin removes it.
    await serviceClient().from("comments").update({ status: "removed" }).eq("id", comment!.id);

    // Author tries to put it back.
    await author.client
      .from("comments")
      .update({ status: "published" })
      .eq("id", comment!.id);

    const { data } = await serviceClient()
      .from("comments")
      .select("status")
      .eq("id", comment!.id)
      .single();

    expect(data?.status).toBe("removed");
  });
});

describe("reports", () => {
  it("is not readable by a non-admin", async () => {
    await serviceClient().from("reports").insert({
      target_type: "spot",
      target_id: spotId,
      profile_id: stranger.id,
      reason: "spam",
    });
    const { data } = await stranger.client.from("reports").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("is readable by an admin", async () => {
    const { data, error } = await admin.client.from("reports").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
