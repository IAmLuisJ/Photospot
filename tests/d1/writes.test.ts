import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSpot, addUser, createTestDatabase } from "./helpers";
import {
  createSpot,
  updateSpot,
  addGalleryLink,
} from "../../app/data/spot-writes";
import {
  castSignal,
  retractSignal,
  getShootTypeVotes,
  getViewerShootAgain,
} from "../../app/data/signals";
import { addComment, listComments } from "../../app/data/comments";
import { refreshSpotScore } from "../../app/data/scores";
import type { DataContext } from "../../app/data/context";
import type { SubmissionInput } from "../../app/domain/spots/submission";

describe("authorized D1 contributions", () => {
  let t: ReturnType<typeof createTestDatabase>;
  let alice: DataContext;
  let bob: DataContext;
  let anon: DataContext;
  beforeEach(async () => {
    t = createTestDatabase();
    alice = { db: t.db, viewer: await addUser(t.db, "alice") };
    bob = { db: t.db, viewer: await addUser(t.db, "bob") };
    anon = { db: t.db, viewer: null };
  });
  afterEach(() => t.close());
  it("rejects direct anonymous writes and cross-user spot edits", async () => {
    const spot = await addSpot(t.db, "alice");
    await expect(updateSpot(anon, spot.id, { name: "Stolen" })).rejects.toThrow(
      /signed in/i,
    );
    expect(await updateSpot(bob, spot.id, { name: "Stolen" })).toBe(false);
    expect(
      await updateSpot(alice, spot.id, {
        name: "My park",
        walkMinutes: 0,
        dogFriendly: false,
        accessibility: [],
      }),
    ).toBe(true);
    expect(
      await t.db
        .prepare(
          "SELECT name,walk_minutes,dog_friendly,accessibility FROM spots WHERE id=?",
        )
        .bind(spot.id)
        .first(),
    ).toEqual({
      name: "My park",
      walk_minutes: 0,
      dog_friendly: 0,
      accessibility: "[]",
    });
  });
  it("cannot edit removed content or inject protected columns", async () => {
    const spot = await addSpot(t.db, "alice", { status: "removed" });
    expect(await updateSpot(alice, spot.id, { name: "Restore" })).toBe(false);
    const published = await addSpot(t.db, "alice");
    await updateSpot(alice, published.id, {
      name: "Fine",
      score: 999,
      status: "removed",
      owner_profile_id: "alice",
    } as Parameters<typeof updateSpot>[2]);
    expect(
      await t.db
        .prepare("SELECT score,status,owner_profile_id FROM spots WHERE id=?")
        .bind(published.id)
        .first(),
    ).toEqual({ score: 0, status: "published", owner_profile_id: null });
  });
  it("retracts only this viewer's vote on this spot", async () => {
    const spot = await addSpot(t.db, "alice");
    const other = await addSpot(t.db, "alice");
    const ref = {
      spotId: spot.id,
      kind: "shoot_type_upvote" as const,
      shootTypeId: 1,
    };
    await castSignal(alice, ref);
    await castSignal(bob, ref);
    await castSignal(alice, { ...ref, spotId: other.id });
    await retractSignal(alice, ref);
    expect(
      await t.db
        .prepare("SELECT profile_id,spot_id FROM signals ORDER BY profile_id")
        .all(),
    ).toMatchObject({
      results: [
        { profile_id: "alice", spot_id: other.id },
        { profile_id: "bob", spot_id: spot.id },
      ],
    });
  });
  it("is idempotent and replaces shoot-again answers atomically", async () => {
    const spot = await addSpot(t.db, "alice");
    const ref = {
      spotId: spot.id,
      kind: "shoot_again" as const,
      shootTypeId: null,
    };
    await castSignal(alice, ref, 1);
    await castSignal(alice, ref, 1);
    await castSignal(alice, ref, 0);
    expect(await getViewerShootAgain(alice, spot.id, "alice")).toBe(0);
    expect(await getViewerShootAgain(bob, spot.id, "alice")).toBeNull();
    expect(
      await t.db
        .prepare(
          "SELECT shoot_again_yes_count,shoot_again_no_count FROM spots WHERE id=?",
        )
        .bind(spot.id)
        .first(),
    ).toEqual({ shoot_again_yes_count: 0, shoot_again_no_count: 1 });
  });
  it("rejects signals on hidden spots and rolls back invalid signal changes", async () => {
    const spot = await addSpot(t.db, "alice");
    const ref = {
      spotId: spot.id,
      kind: "shoot_again" as const,
      shootTypeId: null,
    };
    await castSignal(alice, ref, 1);
    await expect(
      castSignal(alice, { ...ref, shootTypeId: 1 }, 0),
    ).rejects.toThrow();
    expect(await getViewerShootAgain(alice, spot.id, "alice")).toBe(1);
    await t.db
      .prepare("UPDATE spots SET status='hidden' WHERE id=?")
      .bind(spot.id)
      .run();
    await expect(castSignal(bob, ref)).rejects.toThrow(/not found/i);
  });
  it("publishes vote summaries without exposing individual voters", async () => {
    const spot = await addSpot(t.db, "alice");
    await castSignal(alice, {
      spotId: spot.id,
      kind: "shoot_type_upvote",
      shootTypeId: 1,
    });
    const rows = await getShootTypeVotes(bob, spot.id);
    expect(rows).toMatchObject([
      { shootTypeId: 1, upvoteCount: 1, viewerUpvoted: false },
    ]);
    expect(rows[0]).not.toHaveProperty("profileId");
  });
  it("validates comments, derives their author, and hides removed comments", async () => {
    const spot = await addSpot(t.db, "alice");
    await expect(addComment(anon, spot.id, "Hi", "alice")).rejects.toThrow();
    await expect(addComment(bob, spot.id, "Hi", "alice")).rejects.toThrow();
    await expect(
      addComment(alice, spot.id, "\n\t ", "alice"),
    ).rejects.toThrow();
    await addComment(alice, spot.id, " Hello ", "alice");
    expect((await listComments(anon, spot.id))[0]).toMatchObject({
      body: "Hello",
      authorId: "alice",
    });
    await t.db.prepare("UPDATE comments SET status='removed'").run();
    expect(await listComments(alice, spot.id)).toEqual([]);
  });
  it("rejects unsafe gallery URLs and supplies the authenticated author", async () => {
    const spot = await addSpot(t.db, "alice");
    await expect(
      addGalleryLink(anon, spot.id, "https://example.com", "Gallery"),
    ).rejects.toThrow();
    await expect(
      addGalleryLink(alice, spot.id, "javascript:alert(1)", "Gallery"),
    ).rejects.toThrow();
    await addGalleryLink(bob, spot.id, "https://example.com", "Gallery");
    expect(
      await t.db
        .prepare("SELECT profile_id FROM spot_gallery_links")
        .first("profile_id"),
    ).toBe("bob");
  });
  it("requires owned upload receipts and rolls back a failed submission", async () => {
    const input: SubmissionInput = {
      name: "New park",
      kind: "outdoor",
      position: { lat: 43, lng: -85 },
      description: null,
      locality: null,
      region: null,
      shootTypeIds: [1],
      photos: [
        {
          storagePath: "alice/new.jpg",
          kind: "scouting",
          rightsAttested: false,
          creditName: null,
          creditUrl: null,
          caption: null,
        },
      ],
    };
    await expect(createSpot(alice, input, "new-park")).rejects.toThrow(
      /upload/i,
    );
    expect(
      await t.db.prepare("SELECT COUNT(*) AS n FROM spots").first("n"),
    ).toBe(0);
    await t.db
      .prepare(
        "INSERT INTO uploads(storage_path,profile_id,content_type,byte_size,state,created_at,expires_at) VALUES ('alice/new.jpg','alice','image/jpeg',123,'ready',?,?)",
      )
      .bind(
        new Date().toISOString(),
        new Date(Date.now() + 3600000).toISOString(),
      )
      .run();
    await expect(createSpot(bob, input, "stolen")).rejects.toThrow(/upload/i);
    const id = await createSpot(alice, input, "new-park");
    expect(
      await t.db
        .prepare("SELECT created_by,scouting_photo_count FROM spots WHERE id=?")
        .bind(id)
        .first(),
    ).toEqual({ created_by: "alice", scouting_photo_count: 1 });
    expect(
      await t.db
        .prepare("SELECT attached_at FROM uploads")
        .first("attached_at"),
    ).not.toBeNull();
  });
  it("refreshes scores from counters using the domain weights", async () => {
    const spot = await addSpot(t.db, "alice");
    await castSignal(
      alice,
      { spotId: spot.id, kind: "shoot_again", shootTypeId: null },
      1,
    );
    const score = await refreshSpotScore(t.db, spot.id);
    expect(score).toBeGreaterThan(0);
    expect(
      await t.db
        .prepare("SELECT score FROM spots WHERE id=?")
        .bind(spot.id)
        .first("score"),
    ).toBe(score);
  });
});
