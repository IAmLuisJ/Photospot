import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSpot, addUser, createTestDatabase } from "./helpers";
import { backfillScores, refreshHotScores } from "../../app/jobs/scores";
import { sweepUploads } from "../../app/jobs/uploads";

describe("scheduled D1 work", () => {
  let t: ReturnType<typeof createTestDatabase>;
  const now = new Date("2026-11-25T12:00:00.000Z");
  beforeEach(async () => {
    t = createTestDatabase();
    await addUser(t.db, "alice");
  });
  afterEach(() => t.close());
  it("refreshes all lifetime scores and resets quiet hot scores", async () => {
    const active = await addSpot(t.db, "alice");
    const quiet = await addSpot(t.db, "alice", { hot_score: 999 });
    await t.db
      .prepare(
        "INSERT INTO comments(id,spot_id,profile_id,body,created_at) VALUES ('c',?,'alice','Great place',?)",
      )
      .bind(active.id, now.toISOString())
      .run();
    expect(await backfillScores(t.db)).toBe(2);
    expect(await refreshHotScores(t.db, undefined, now)).toBe(2);
    expect(
      await t.db
        .prepare("SELECT hot_score FROM spots WHERE id=?")
        .bind(quiet.id)
        .first("hot_score"),
    ).toBe(0);
    expect(
      await t.db
        .prepare("SELECT score,hot_score FROM spots WHERE id=?")
        .bind(active.id)
        .first(),
    ).toEqual({ score: 0.5, hot_score: 0.5 });
  });
  it("decays events once and excludes removed and old content", async () => {
    const spot = await addSpot(t.db, "alice");
    await t.db
      .prepare(
        "INSERT INTO comments(id,spot_id,body,status,created_at) VALUES ('a',?,'Old but relevant','published','2026-11-11T12:00:00.000Z'),('b',?,'Removed','removed',?),('c',?,'Ancient','published','2025-01-01T00:00:00.000Z')",
      )
      .bind(spot.id, spot.id, now.toISOString(), spot.id)
      .run();
    await refreshHotScores(t.db, undefined, now);
    expect(
      await t.db
        .prepare("SELECT hot_score FROM spots WHERE id=?")
        .bind(spot.id)
        .first("hot_score"),
    ).toBe(0.25);
  });
  it("recomputes past the event page size without truncation or per-event rounding", async () => {
    const spot = await addSpot(t.db, "alice");
    const created = "2026-11-18T12:00:00.000Z";
    const insert = t.db.prepare(
      "INSERT INTO comments(id,spot_id,body,created_at) VALUES (?,?,'Useful',?)",
    );
    await t.db.batch(
      Array.from({ length: 1050 }, (_, i) =>
        insert.bind(`c${i.toString().padStart(4, "0")}`, spot.id, created),
      ),
    );
    await refreshHotScores(t.db, undefined, now);
    expect(
      await t.db
        .prepare("SELECT hot_score FROM spots WHERE id=?")
        .bind(spot.id)
        .first("hot_score"),
    ).toBe(371.231);
  });
  it("claims expired uploads before deleting objects and preserves attached or recent ones", async () => {
    const insert = t.db.prepare(
      "INSERT INTO uploads(storage_path,profile_id,content_type,byte_size,state,created_at,expires_at,attached_at) VALUES (?,'alice','image/jpeg',10,'ready','2026-11-20T00:00:00.000Z',?,?)",
    );
    await insert.bind("old.jpg", "2026-11-24T00:00:00.000Z", null).run();
    await insert
      .bind("attached.jpg", "2026-11-24T00:00:00.000Z", now.toISOString())
      .run();
    await insert.bind("recent.jpg", "2026-11-26T00:00:00.000Z", null).run();
    const remaining = new Set(["old.jpg", "attached.jpg", "recent.jpg"]);
    const bucket = {
      async delete(key: string | string[]) {
        for (const k of Array.isArray(key) ? key : [key]) {
          expect(
            await t.db
              .prepare("SELECT state FROM uploads WHERE storage_path=?")
              .bind(k)
              .first("state"),
          ).toBe("deleting");
          remaining.delete(k);
        }
      },
    };
    expect(await sweepUploads(t.db, bucket, now)).toBe(1);
    expect([...remaining]).toEqual(["attached.jpg", "recent.jpg"]);
    expect(
      await t.db
        .prepare(
          "SELECT storage_path FROM uploads WHERE storage_path='old.jpg'",
        )
        .first(),
    ).toBeNull();
  });
  it("retains cleanup receipts when R2 fails so the next schedule can retry", async () => {
    await t.db
      .prepare(
        "INSERT INTO uploads(storage_path,content_type,byte_size,created_at,expires_at) VALUES ('retry.jpg','image/jpeg',10,'2026-11-20T00:00:00.000Z','2026-11-21T00:00:00.000Z')",
      )
      .run();
    await expect(
      sweepUploads(
        t.db,
        {
          async delete() {
            throw new Error("storage unavailable");
          },
        },
        now,
      ),
    ).rejects.toThrow(/storage/);
    expect(
      await t.db
        .prepare("SELECT state FROM uploads WHERE storage_path='retry.jpg'")
        .first("state"),
    ).toBe("deleting");
    expect(await sweepUploads(t.db, { async delete() {} }, now)).toBe(1);
  });
});
