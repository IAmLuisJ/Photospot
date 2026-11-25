import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { getStudioDetails, claimStudio } from "../../app/data/studios";

let owner: TestUser;
let stranger: TestUser;
/** The listing whose contact_email is the owner's address. */
let claimableId: string;
/** A second listing, contact_email belonging to nobody in this file. */
let otherId: string;
/** An outdoor spot, which has no studio_details row at all. */
let outdoorId: string;

const admin = () => serviceClient();

const makeSpot = async (name: string, kind: "outdoor" | "studio") => {
  const { data, error } = await admin()
    .from("spots")
    .insert({
      kind,
      name,
      slug: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.66 42.96)",
      created_by: owner.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
};

beforeAll(async () => {
  owner = await createTestUser("Studio Owner");
  stranger = await createTestUser("Passing Stranger");

  claimableId = await makeSpot("Claimable Studio", "studio");
  otherId = await makeSpot("Other Studio", "studio");
  outdoorId = await makeSpot("Just A Park", "outdoor");

  // Both objects carry the same keys: PostgREST unions the keys of a bulk
  // insert and nulls the gaps, bypassing column defaults.
  const { error } = await admin().from("studio_details").insert([
    {
      spot_id: claimableId,
      contact_email: owner.email,
      hourly_rate_cents: 12000,
      booking_url: "https://example.test/book",
    },
    {
      spot_id: otherId,
      contact_email: "nobody@example.test",
      hourly_rate_cents: null,
      booking_url: null,
    },
  ]);
  if (error) throw error;
});

afterAll(async () => {
  const { error } = await admin()
    .from("spots")
    .delete()
    .in("id", [claimableId, otherId, outdoorId]);
  if (error) throw error;
  await deleteTestUser(owner.id);
  await deleteTestUser(stranger.id);
});

describe("getStudioDetails", () => {
  it("reads the listing's business fields", async () => {
    const details = await getStudioDetails(anonClient(), claimableId);
    expect(details).toMatchObject({
      spotId: claimableId,
      hourlyRateCents: 12000,
      bookingUrl: "https://example.test/book",
      claimedBy: null,
      claimedAt: null,
    });
  });

  // An outdoor spot has no studio_details row. `single()` would call that a
  // PGRST116 error rather than an answer, which is why this uses maybeSingle.
  it("returns null for a spot that is not a studio", async () => {
    expect(await getStudioDetails(anonClient(), outdoorId)).toBeNull();
  });

  // supabase-js returns errors, it does not throw. A mapper that ignores
  // `error` returns null on failure, which reads as "not a studio" — the
  // wrong answer, silently.
  it("throws when the query fails rather than reporting no studio", async () => {
    await expect(getStudioDetails(anonClient(), "not-a-uuid")).rejects.toMatchObject({
      code: "22P02",
    });
  });
});

describe("claimStudio", () => {
  it("refuses a logged-out caller", async () => {
    await expect(claimStudio(anonClient(), claimableId)).rejects.toMatchObject({ code: "42501" });
  });

  // The whole point of spec §9.3: without the email check this is first-come,
  // first-served across every unclaimed listing in the database.
  it("refuses somebody whose email does not match the listing", async () => {
    await expect(claimStudio(stranger.client, claimableId)).rejects.toThrow(/confirmed email/i);

    const details = await getStudioDetails(anonClient(), claimableId);
    expect(details!.claimedBy).toBeNull();
  });

  it("lets the owner of the contact email claim the listing", async () => {
    await claimStudio(owner.client, claimableId);

    const details = await getStudioDetails(anonClient(), claimableId);
    expect(details!.claimedBy).toBe(owner.id);
    expect(details!.claimedAt).not.toBeNull();
  });

  // Claiming sets ownership on the spot too, which is what makes the listing
  // editable by its owner — spots_update allows owner_profile_id = auth.uid().
  it("makes the claimant the spot's owner", async () => {
    const { data } = await admin()
      .from("spots")
      .select("owner_profile_id")
      .eq("id", claimableId)
      .single();
    expect(data!.owner_profile_id).toBe(owner.id);
  });

  it("refuses a listing that is already claimed", async () => {
    await expect(claimStudio(owner.client, claimableId)).rejects.toThrow(/not claimable/i);
  });

  // claimed_by is absent from the column grants, so only claim_studio sets it.
  // Otherwise any signed-in user could claim any listing by writing the column.
  it("cannot be done by writing the column directly", async () => {
    const { error } = await stranger.client
      .from("studio_details")
      .update({ claimed_by: stranger.id })
      .eq("spot_id", otherId);
    expect(error?.code).toBe("42501");

    const details = await getStudioDetails(anonClient(), otherId);
    expect(details!.claimedBy).toBeNull();
  });

  it("refuses a spot that has no listing at all", async () => {
    await expect(claimStudio(owner.client, outdoorId)).rejects.toThrow(/not claimable/i);
  });
});
