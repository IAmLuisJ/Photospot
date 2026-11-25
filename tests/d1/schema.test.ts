import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSpot, addUser, createTestDatabase } from "./helpers";

describe("D1 integrity", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    testDb = createTestDatabase();
  });
  afterEach(() => testDb.close());

  it("creates profiles automatically without granting admin", async () => {
    const user = await addUser(testDb.db, "alice");
    expect(
      await testDb.db
        .prepare("SELECT role FROM profiles WHERE id = ?")
        .bind(user.id)
        .first("role"),
    ).toBe("user");
  });
  it("enforces one shoot-again vote even with a null shoot type", async () => {
    const user = await addUser(testDb.db);
    const spot = await addSpot(testDb.db, user.id);
    const insert = () =>
      testDb.db
        .prepare(
          "INSERT INTO signals (id, spot_id, profile_id, kind, value) VALUES (?, ?, ?, 'shoot_again', 1)",
        )
        .bind(crypto.randomUUID(), spot.id, user.id)
        .run();
    await insert();
    await expect(insert()).rejects.toThrow(/UNIQUE/);
  });
  it("requires rights attestation for session photos and caps each kind at six", async () => {
    const user = await addUser(testDb.db);
    const spot = await addSpot(testDb.db, user.id);
    const insert = (kind: string, rights: number) =>
      testDb.db
        .prepare(
          "INSERT INTO photos (id, spot_id, profile_id, kind, storage_path, rights_attested) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          spot.id,
          user.id,
          kind,
          crypto.randomUUID(),
          rights,
        )
        .run();
    await expect(insert("session", 0)).rejects.toThrow(/CHECK/);
    for (let i = 0; i < 6; i++) await insert("scouting", 0);
    await expect(insert("scouting", 0)).rejects.toThrow(/photo cap/);
    await insert("session", 1);
  });
  it("preserves authored content and removes votes when an account is deleted", async () => {
    const user = await addUser(testDb.db);
    const spot = await addSpot(testDb.db, user.id);
    await testDb.db
      .prepare(
        "INSERT INTO signals (id, spot_id, profile_id, kind, value) VALUES ('vote', ?, ?, 'shoot_again', 1)",
      )
      .bind(spot.id, user.id)
      .run();
    await testDb.db
      .prepare('DELETE FROM "user" WHERE id = ?')
      .bind(user.id)
      .run();
    expect(
      await testDb.db
        .prepare("SELECT created_by FROM spots WHERE id = ?")
        .bind(spot.id)
        .first("created_by"),
    ).toBeNull();
    expect(
      await testDb.db.prepare("SELECT COUNT(*) AS n FROM signals").first("n"),
    ).toBe(0);
    expect(
      await testDb.db
        .prepare("SELECT shoot_again_yes_count FROM spots WHERE id = ?")
        .bind(spot.id)
        .first("shoot_again_yes_count"),
    ).toBe(0);
  });
  it("distinguishes null and empty arrays and rejects unknown vocabulary", async () => {
    const user = await addUser(testDb.db);
    const a = await addSpot(testDb.db, user.id);
    const b = await addSpot(testDb.db, user.id, {
      accessibility: "[]",
      dog_friendly: 0,
      walk_minutes: 0,
    });
    expect(
      await testDb.db
        .prepare("SELECT accessibility FROM spots WHERE id = ?")
        .bind(a.id)
        .first("accessibility"),
    ).toBeNull();
    expect(
      await testDb.db
        .prepare("SELECT accessibility FROM spots WHERE id = ?")
        .bind(b.id)
        .first("accessibility"),
    ).toBe("[]");
    await expect(
      addSpot(testDb.db, user.id, { accessibility: '["flying"]' }),
    ).rejects.toThrow(/vocabulary/);
  });
  it("rolls back an entire D1 batch when a child insert fails", async () => {
    const user = await addUser(testDb.db);
    await expect(
      testDb.db.batch([
        testDb.db
          .prepare(
            "INSERT INTO spots (id, name, slug, kind, lat, lng, created_by) VALUES ('rollback', 'Park', 'rollback', 'outdoor', 43, -85, ?)",
          )
          .bind(user.id),
        testDb.db.prepare(
          "INSERT INTO spot_shoot_types (spot_id, shoot_type_id) VALUES ('rollback', 9999)",
        ),
      ]),
    ).rejects.toThrow(/FOREIGN KEY/);
    expect(
      await testDb.db
        .prepare("SELECT id FROM spots WHERE id = 'rollback'")
        .first(),
    ).toBeNull();
  });
});
