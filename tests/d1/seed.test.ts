import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "./helpers";
import { seed } from "../../scripts/seed-grand-rapids";

describe("local seed", () => {
  let t: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    t = createTestDatabase();
  });
  afterEach(() => t.close());
  it("is idempotent and keeps seeded photos, counters and scores consistent", async () => {
    const objects = new Map<string, string>();
    const bucket = {
      async put(key: string, body: string) {
        objects.set(key, body);
      },
    };
    expect(await seed(t.db, bucket)).toBe(6);
    expect(await seed(t.db, bucket)).toBe(0);
    expect(objects.size).toBe(12);
    expect(
      await t.db.prepare("SELECT COUNT(*) AS n FROM photos").first("n"),
    ).toBe(12);
    const { results } = await t.db
      .prepare(
        "SELECT scouting_photo_count,session_photo_count,score FROM spots",
      )
      .all();
    expect(results).toHaveLength(6);
    expect(
      results.every(
        (s) =>
          s.scouting_photo_count === 1 &&
          s.session_photo_count === 1 &&
          s.score === 2.5,
      ),
    ).toBe(true);
  });
});
