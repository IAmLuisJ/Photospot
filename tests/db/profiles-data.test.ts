import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getProfile, getCurrentProfile } from "../../app/data/profiles";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser("Grace Hopper");
});

afterAll(async () => {
  await deleteTestUser(user.id);
});

describe("getProfile", () => {
  it("returns a domain profile, not a database row", async () => {
    const profile = await getProfile(serviceClient(), user.id);
    expect(profile).toEqual({
      id: user.id,
      displayName: "Grace Hopper",
      role: "user",
      avatarUrl: null,
      bio: null,
      websiteUrl: null,
      instagram: null,
    });
  });

  // Photographer credits render for logged-out visitors, so this path crosses
  // both the anon SELECT grant and the profiles_read policy. Every other test
  // here reads as service_role or as the user themselves, which exercises
  // neither.
  it("is readable by a logged-out visitor", async () => {
    const profile = await getProfile(anonClient(), user.id);
    expect(profile?.displayName).toBe("Grace Hopper");
  });

  it("returns null for an unknown id", async () => {
    const profile = await getProfile(
      serviceClient(),
      "00000000-0000-0000-0000-000000000000",
    );
    expect(profile).toBeNull();
  });
});

describe("getCurrentProfile", () => {
  it("returns the signed-in user's profile", async () => {
    const profile = await getCurrentProfile(user.client);
    expect(profile?.displayName).toBe("Grace Hopper");
  });

  it("returns null for a logged-out visitor", async () => {
    expect(await getCurrentProfile(anonClient())).toBeNull();
  });
});
