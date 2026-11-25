import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSpot, addUser, createTestDatabase } from "./helpers";
import {
  getSpotBySlug,
  getSpotMedia,
  listSpotsInViewport,
} from "../../app/data/spots";
import { findNearbyDuplicates } from "../../app/data/spot-writes";
import { DEFAULT_FILTERS } from "../../app/domain/filters/explore-filters";
import type { DataContext } from "../../app/data/context";

describe("D1 public reads", () => {
  let t: ReturnType<typeof createTestDatabase>;
  let ctx: DataContext;
  let userId: string;
  beforeEach(async () => {
    t = createTestDatabase();
    ctx = { db: t.db, viewer: null };
    userId = (await addUser(t.db)).id;
  });
  afterEach(() => t.close());

  it("excludes hidden and out-of-bounds spots and returns numeric scores", async () => {
    const a = await addSpot(t.db, userId, { score: 12.5 });
    await addSpot(t.db, userId, { status: "hidden", score: 50 });
    await addSpot(t.db, userId, { lat: 40 });
    const rows = await listSpotsInViewport(ctx, DEFAULT_FILTERS);
    expect(rows.map((s) => s.id)).toEqual([a.id]);
    expect(rows[0].score).toBe(12.5);
  });
  it("applies every attribute filter before limiting results", async () => {
    await addSpot(t.db, userId, { score: 100, cost_type: "hourly_rate" });
    const good = await addSpot(t.db, userId, {
      cost_type: "free",
      walk_minutes: 0,
      dog_friendly: 1,
      accessibility: '["wheelchair","stroller"]',
    });
    await addSpot(t.db, userId, {
      cost_type: "free",
      walk_minutes: 0,
      dog_friendly: 1,
      accessibility: '["wheelchair"]',
    });
    const rows = await listSpotsInViewport(
      ctx,
      {
        ...DEFAULT_FILTERS,
        attributes: {
          costTypes: ["free"],
          maxWalkMinutes: 0,
          dogFriendlyOnly: true,
          accessibility: ["wheelchair", "stroller"],
        },
      },
      1,
    );
    expect(rows.map((s) => s.id)).toEqual([good.id]);
  });
  it("filters unknown attributes and preserves false versus null on details", async () => {
    const no = await addSpot(t.db, userId, {
      dog_friendly: 0,
      accessibility: "[]",
    });
    const unknown = await addSpot(t.db, userId);
    expect((await getSpotBySlug(ctx, no.slug))?.dogFriendly).toBe(false);
    expect((await getSpotBySlug(ctx, no.slug))?.accessibility).toEqual([]);
    expect((await getSpotBySlug(ctx, unknown.slug))?.dogFriendly).toBeNull();
    expect(
      await listSpotsInViewport(ctx, {
        ...DEFAULT_FILTERS,
        attributes: { ...DEFAULT_FILTERS.attributes, dogFriendlyOnly: true },
      }),
    ).toEqual([]);
  });
  it("sorts by hot score and filters shoot types", async () => {
    const a = await addSpot(t.db, userId, { hot_score: 2, score: 20 });
    const b = await addSpot(t.db, userId, { hot_score: 5, score: 1 });
    expect(
      (await listSpotsInViewport(ctx, { ...DEFAULT_FILTERS, sort: "hot" })).map(
        (s) => s.id,
      ),
    ).toEqual([b.id, a.id]);
    await t.db
      .prepare("INSERT INTO spot_shoot_types VALUES (?,1)")
      .bind(b.id)
      .run();
    expect(
      (
        await listSpotsInViewport(ctx, { ...DEFAULT_FILTERS, shootTypeId: 1 })
      ).map((s) => s.id),
    ).toEqual([b.id]);
  });
  it("hides moderated detail pages and their media even from their author", async () => {
    const s = await addSpot(t.db, userId, { status: "hidden" });
    await t.db
      .prepare(
        "INSERT INTO photos(id,spot_id,kind,storage_path) VALUES ('p',?,'scouting','hidden.jpg')",
      )
      .bind(s.id)
      .run();
    expect(await getSpotBySlug(ctx, s.slug)).toBeNull();
    expect(await getSpotMedia(ctx, s.id)).toEqual({
      photos: [],
      galleryLinks: [],
    });
  });
  it("prefers a session photo cover and excludes removed photos", async () => {
    const s = await addSpot(t.db, userId);
    await t.db
      .prepare(
        "INSERT INTO photos(id,spot_id,kind,storage_path,rights_attested) VALUES ('scout',?,'scouting','scout.jpg',0),('session',?,'session','session.jpg',1)",
      )
      .bind(s.id, s.id)
      .run();
    expect(
      (await listSpotsInViewport(ctx, DEFAULT_FILTERS))[0].coverPhotoPath,
    ).toBe("session.jpg");
    await t.db
      .prepare("UPDATE photos SET status='removed' WHERE id='session'")
      .run();
    expect(
      (await getSpotMedia(ctx, s.id)).photos.map((p) => p.storagePath),
    ).toEqual(["scout.jpg"]);
  });
  it("finds nearby matching kinds with real distance rather than a rectangular approximation", async () => {
    const close = await addSpot(t.db, userId, { lat: 43, lng: -85 });
    await addSpot(t.db, userId, { lat: 43.01, lng: -85 });
    await addSpot(t.db, userId, { lat: 43, lng: -85, kind: "studio" });
    const rows = await findNearbyDuplicates(
      ctx,
      { lat: 43, lng: -85 },
      "outdoor",
    );
    expect(rows.map((s) => s.id)).toEqual([close.id]);
    expect(rows[0].distanceMeters).toBe(0);
  });
});
