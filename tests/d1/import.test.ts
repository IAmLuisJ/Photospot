import { describe, expect, it } from "vitest";
import { createTestDatabase } from "./helpers";
import {
  importSnapshot,
  buildImportBatch,
} from "../../scripts/import-supabase";

describe("legacy snapshot import", () => {
  it("exports a parameterized production batch with an atomic empty-target guard", async () => {
    const t = createTestDatabase();
    try {
      const batch = JSON.parse(
        JSON.stringify(
          buildImportBatch({
            users: [
              {
                id: "u",
                email: "u@example.com",
                name: "O'Connor",
                email_verified: true,
              },
            ],
            profiles: [{ id: "u" }],
          }),
        ),
      ) as { sql: string; params: (string | number | null)[] }[];
      await t.db.batch(batch.map((c) => t.db.prepare(c.sql).bind(...c.params)));
      expect(await t.db.prepare('SELECT name FROM "user"').first("name")).toBe(
        "O'Connor",
      );
      await expect(
        t.db.batch(batch.map((c) => t.db.prepare(c.sql).bind(...c.params))),
      ).rejects.toThrow(/CHECK/);
      expect(
        await t.db.prepare('SELECT COUNT(*) AS n FROM "user"').first("n"),
      ).toBe(1);
      expect(
        await t.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='_photospots_import_guard'",
          )
          .first(),
      ).toBeNull();
    } finally {
      t.close();
    }
  });
  it("preserves profile IDs, Google identities, attribution, and nullable attributes", async () => {
    const t = createTestDatabase();
    try {
      await importSnapshot(t.db, {
        users: [
          {
            id: "old-user",
            email: "alice@example.com",
            email_verified: true,
            created_at: "2026-08-01T00:00:00Z",
          },
        ],
        identities: [
          {
            user_id: "old-user",
            provider: "google",
            provider_id: "google-sub-123",
          },
        ],
        profiles: [{ id: "old-user", display_name: "Alice", role: "admin" }],
        spots: [
          {
            id: "old-spot",
            name: "Old park",
            slug: "old-park",
            kind: "outdoor",
            lat: 43,
            lng: -85,
            created_by: "old-user",
            accessibility: [],
            terrain: null,
            dog_friendly: false,
          },
        ],
        comments: [
          {
            id: "old-comment",
            spot_id: "old-spot",
            profile_id: "old-user",
            body: "Keep this advice",
          },
        ],
      });
      expect(
        await t.db.prepare('SELECT id,emailVerified FROM "user"').first(),
      ).toEqual({ id: "old-user", emailVerified: 1 });
      expect(
        await t.db
          .prepare("SELECT role FROM profiles WHERE id='old-user'")
          .first("role"),
      ).toBe("admin");
      expect(
        await t.db
          .prepare(
            "SELECT accountId,userId FROM account WHERE providerId='google'",
          )
          .first(),
      ).toEqual({ accountId: "google-sub-123", userId: "old-user" });
      expect(
        await t.db
          .prepare(
            "SELECT created_by,accessibility,terrain,dog_friendly FROM spots",
          )
          .first(),
      ).toEqual({
        created_by: "old-user",
        accessibility: "[]",
        terrain: null,
        dog_friendly: 0,
      });
      expect(
        await t.db
          .prepare("SELECT profile_id FROM comments")
          .first("profile_id"),
      ).toBe("old-user");
      await expect(importSnapshot(t.db, { users: [] })).rejects.toThrow(
        /empty/i,
      );
    } finally {
      t.close();
    }
  });
  it("rolls back the entire import when a child row violates constraints", async () => {
    const t = createTestDatabase();
    try {
      await expect(
        importSnapshot(t.db, {
          users: [{ id: "u", email: "u@example.com", email_verified: true }],
          spots: [
            {
              id: "bad",
              name: "Bad",
              slug: "bad",
              kind: "outdoor",
              lat: 300,
              lng: 0,
              created_by: "u",
            },
          ],
        }),
      ).rejects.toThrow();
      expect(
        await t.db.prepare('SELECT COUNT(*) AS n FROM "user"').first("n"),
      ).toBe(0);
    } finally {
      t.close();
    }
  });
});
