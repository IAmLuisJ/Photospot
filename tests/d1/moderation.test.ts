import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSpot, addUser, createTestDatabase } from "./helpers";
import { claimStudio, getStudioDetails } from "../../app/data/studios";
import {
  fileReport,
  listReportQueue,
  resolveReport,
} from "../../app/data/reports";
import type { DataContext } from "../../app/data/context";

describe("D1 claims and moderation", () => {
  let t: ReturnType<typeof createTestDatabase>;
  let alice: DataContext;
  let bob: DataContext;
  let admin: DataContext;
  beforeEach(async () => {
    t = createTestDatabase();
    alice = { db: t.db, viewer: await addUser(t.db, "alice") };
    bob = { db: t.db, viewer: await addUser(t.db, "bob") };
    admin = { db: t.db, viewer: await addUser(t.db, "admin", "admin") };
  });
  afterEach(() => t.close());
  it("requires a verified matching email and sets both ownership records", async () => {
    const s = await addSpot(t.db, "bob", { kind: "studio" });
    await t.db
      .prepare("INSERT INTO studio_details(spot_id,contact_email) VALUES (?,?)")
      .bind(s.id, "alice@example.com")
      .run();
    await expect(claimStudio(bob, s.id)).rejects.toThrow(/confirmed email/);
    await expect(
      claimStudio(
        { ...alice, viewer: { ...alice.viewer!, emailVerified: false } },
        s.id,
      ),
    ).rejects.toThrow(/confirmed email/);
    await claimStudio(alice, s.id);
    expect((await getStudioDetails(alice, s.id))?.claimedBy).toBe("alice");
    expect(
      await t.db
        .prepare("SELECT owner_profile_id FROM spots WHERE id=?")
        .bind(s.id)
        .first("owner_profile_id"),
    ).toBe("alice");
    await expect(claimStudio(bob, s.id)).rejects.toThrow(/not claimable/);
    expect(
      await t.db
        .prepare("SELECT owner_profile_id FROM spots WHERE id=?")
        .bind(s.id)
        .first("owner_profile_id"),
    ).toBe("alice");
  });
  it("does not expose the report queue or allow resolution to contributors", async () => {
    const s = await addSpot(t.db, "alice");
    await fileReport(bob, {
      targetType: "spot",
      targetId: s.id,
      reason: "spam",
      note: null,
      profileId: "bob",
    });
    const row = (await listReportQueue(admin))[0];
    await expect(listReportQueue(alice)).rejects.toThrow(/admin/);
    await expect(resolveReport(alice, row.id, "hide")).rejects.toThrow(/admin/);
    await resolveReport(admin, row.id, "hide");
    expect(
      await t.db
        .prepare("SELECT status FROM spots WHERE id=?")
        .bind(s.id)
        .first("status"),
    ).toBe("hidden");
    expect(
      await t.db
        .prepare("SELECT status,resolved_by FROM reports WHERE id=?")
        .bind(row.id)
        .first(),
    ).toEqual({ status: "resolved", resolved_by: "admin" });
  });
  it("rejects impersonated reports and unsupported moderation actions without closing them", async () => {
    const s = await addSpot(t.db, "alice");
    await expect(
      fileReport(bob, {
        targetType: "spot",
        targetId: s.id,
        reason: "spam",
        note: null,
        profileId: "alice",
      }),
    ).rejects.toThrow();
    await t.db
      .prepare(
        "INSERT INTO comments(id,spot_id,profile_id,body) VALUES ('c',?,'alice','Hello')",
      )
      .bind(s.id)
      .run();
    await fileReport(bob, {
      targetType: "comment",
      targetId: "c",
      reason: "spam",
      note: null,
      profileId: "bob",
    });
    const row = (await listReportQueue(admin))[0];
    await expect(resolveReport(admin, row.id, "hide")).rejects.toThrow(
      /only a spot/i,
    );
    expect(
      await t.db
        .prepare("SELECT status FROM reports WHERE id=?")
        .bind(row.id)
        .first("status"),
    ).toBe("open");
    await resolveReport(admin, row.id, "remove");
    expect(
      await t.db
        .prepare("SELECT comment_count FROM spots WHERE id=?")
        .bind(s.id)
        .first("comment_count"),
    ).toBe(0);
  });
  it("keeps orphaned reports dismissable", async () => {
    const s = await addSpot(t.db, "alice");
    await fileReport(bob, {
      targetType: "spot",
      targetId: s.id,
      reason: "spam",
      note: null,
      profileId: "bob",
    });
    await t.db.prepare("DELETE FROM spots WHERE id=?").bind(s.id).run();
    const row = (await listReportQueue(admin))[0];
    expect(row.targetTitle).toBeNull();
    await resolveReport(admin, row.id, "dismiss");
    expect(
      await t.db
        .prepare("SELECT status FROM reports WHERE id=?")
        .bind(row.id)
        .first("status"),
    ).toBe("dismissed");
  });

  it.each(["hide", "remove", "dismiss"] as const)(
    "refuses a stale %s after a competing dismissal wins",
    async (action) => {
      const spot = await addSpot(t.db, "alice");
      await fileReport(alice, {
        targetType: "spot",
        targetId: spot.id,
        reason: "spam",
        note: null,
        profileId: "alice",
      });
      const report = (await listReportQueue(admin))[0];
      // first() captures the open row synchronously; this other committed write
      // wins before resolveReport resumes from its awaited read. No DB is mocked.
      const resolving = resolveReport(admin, report.id, action);
      await t.db
        .prepare(
          "UPDATE reports SET status='dismissed',resolved_by='admin' WHERE id=?",
        )
        .bind(report.id)
        .run();
      await expect(resolving).rejects.toThrow(/already|changed/i);
      expect(
        await t.db
          .prepare("SELECT status FROM spots WHERE id=?")
          .bind(spot.id)
          .first("status"),
      ).toBe("published");
    },
  );
});
