import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { ACCESSIBILITY_OPTIONS, TERRAIN_OPTIONS } from "../../app/domain/spots/attributes";

let author: TestUser;
const spotIds: string[] = [];

beforeAll(async () => {
  author = await createTestUser("Vocabulary Author");
});

afterAll(async () => {
  const { error } = await serviceClient().from("spots").delete().in("id", spotIds);
  if (error) throw error;
  await deleteTestUser(author.id);
});

/**
 * Records every id the database hands back, not only the ones a test expected.
 *
 * The rejection tests below insert deliberately invalid rows, so if a
 * constraint is ever missing — which is exactly the state a mutation test puts
 * the database in — those inserts *succeed*. Collecting ids only on the happy
 * path leaves them behind, and the next attempt to add the constraint fails
 * with "is violated by some row" against rows nobody can find.
 */
const insert = async (fields: Record<string, unknown>) => {
  const result = await serviceClient()
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Vocabulary Spot",
      slug: `vocab-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.68 42.95)",
      created_by: author.id,
      status: "published",
      ...fields,
    })
    .select("id")
    .single();

  if (result.data?.id) spotIds.push(result.data.id);
  return result;
};

describe("attribute vocabulary constraints", () => {
  it("accepts every value the domain layer offers", async () => {
    const { error } = await insert({
      accessibility: ACCESSIBILITY_OPTIONS.map((o) => o.value),
      terrain: TERRAIN_OPTIONS.map((o) => o.value),
    });
    expect(error).toBeNull();
  });

  it("rejects an accessibility value outside the vocabulary", async () => {
    const { error } = await insert({ accessibility: ["wheelchair", "teleporter"] });
    expect(error?.code).toBe("23514");
  });

  it("rejects a terrain value outside the vocabulary", async () => {
    const { error } = await insert({ terrain: ["lava"] });
    expect(error?.code).toBe("23514");
  });

  // Case matters: this is the drift the constraint exists to stop.
  it("rejects a value that differs only in case", async () => {
    const { error } = await insert({ accessibility: ["Wheelchair"] });
    expect(error?.code).toBe("23514");
  });

  // Null is "nobody said", which is the normal state for an optional attribute
  // (spec §4.7) and must stay writable.
  it("still accepts null and empty arrays", async () => {
    const nulls = await insert({ accessibility: null, terrain: null });
    expect(nulls.error).toBeNull();

    const empties = await insert({ accessibility: [], terrain: [] });
    expect(empties.error).toBeNull();
  });

  it("leaves the seeded spots valid", async () => {
    const { count, error } = await serviceClient()
      .from("spots")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBeGreaterThan(0);
  });
});
