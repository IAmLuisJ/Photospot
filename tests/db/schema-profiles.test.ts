import { describe, it, expect, afterAll } from "vitest";
import { serviceClient, createTestUser, deleteTestUser } from "./helpers";

const created: string[] = [];

afterAll(async () => {
  for (const id of created) await deleteTestUser(id);
});

describe("shoot_types", () => {
  it("is seeded with the nine agreed categories", async () => {
    const { data, error } = await serviceClient().from("shoot_types").select("slug");
    expect(error).toBeNull();
    expect(data?.map((r) => r.slug).sort()).toEqual(
      [
        "branding",
        "engagement",
        "family",
        "headshot",
        "maternity",
        "newborn",
        "pets",
        "senior-portrait",
        "wedding",
      ].sort(),
    );
  });
});

describe("profiles", () => {
  it("is created automatically when a user signs up", async () => {
    const user = await createTestUser("Ada Lovelace");
    created.push(user.id);

    const { data, error } = await serviceClient()
      .from("profiles")
      .select("id, display_name, role")
      .eq("id", user.id)
      .single();

    expect(error).toBeNull();
    expect(data?.display_name).toBe("Ada Lovelace");
    expect(data?.role).toBe("user");
  });

  it("is deleted when the auth user is deleted", async () => {
    const user = await createTestUser();
    await deleteTestUser(user.id);

    const { data } = await serviceClient()
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    expect(data).toBeNull();
  });

  it("rejects a role outside the allowed set", async () => {
    const user = await createTestUser();
    created.push(user.id);

    const { error } = await serviceClient()
      .from("profiles")
      .update({ role: "superuser" })
      .eq("id", user.id);

    expect(error).not.toBeNull();
  });
});
