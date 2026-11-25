import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { refreshHotScores } from "../../scripts/refresh-hot-scores";
import { serviceClient, createTestUser, deleteTestUser } from "./helpers";
import { HOT_WINDOW_DAYS } from "../../app/domain/scoring/hot";

let userId: string;
let freshSpot: string;
let staleSpot: string;
let quietSpot: string;
let familyTypeId: number;

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const makeSpot = async (name: string) => {
  const { data } = await serviceClient()
    .from("spots")
    .insert({
      kind: "outdoor",
      name,
      slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      location: "POINT(-85.7267 42.9214)",
      created_by: userId,
    })
    .select("id")
    .single();
  return data!.id as string;
};

const hotOf = async (id: string) => {
  const { data } = await serviceClient().from("spots").select("hot_score").eq("id", id).single();
  return Number(data!.hot_score);
};

beforeAll(async () => {
  userId = (await createTestUser("Hot Refresher")).id;
  const db = serviceClient();
  const { data: t } = await db.from("shoot_types").select("id").eq("slug", "family").single();
  familyTypeId = t!.id;

  freshSpot = await makeSpot("Fresh Spot");
  staleSpot = await makeSpot("Stale Spot");
  quietSpot = await makeSpot("Quiet Spot");

  // Fresh: one upvote right now.
  await db.from("signals").insert({
    spot_id: freshSpot,
    profile_id: userId,
    kind: "shoot_type_upvote",
    shoot_type_id: familyTypeId,
    value: 1,
  });

  // Stale: activity outside the window. created_at has a default, so it is
  // inserted then backdated.
  await db
    .from("comments")
    .insert({ spot_id: staleSpot, profile_id: userId, body: "Ancient history." });
  await db
    .from("comments")
    .update({ created_at: daysAgo(HOT_WINDOW_DAYS + 5) })
    .eq("spot_id", staleSpot);

  // Quiet: no activity at all.
});

afterAll(async () => {
  const db = serviceClient();
  for (const id of [freshSpot, staleSpot, quietSpot]) await db.from("spots").delete().eq("id", id);
  await deleteTestUser(userId);
});

describe("refreshHotScores", () => {
  it("gives recent activity a nonzero hot score", async () => {
    await refreshHotScores(serviceClient());
    expect(await hotOf(freshSpot)).toBeGreaterThan(0);
  });

  it("ignores activity older than the window", async () => {
    await refreshHotScores(serviceClient());
    expect(await hotOf(staleSpot)).toBe(0);
  });

  it("leaves a spot with no activity at zero", async () => {
    await refreshHotScores(serviceClient());
    expect(await hotOf(quietSpot)).toBe(0);
  });

  // The failure mode that makes a "hot" list wrong forever: a spot that was hot
  // must cool off when its activity ages out. A job that only writes spots it
  // finds activity for would leave the old value in place.
  it("cools a spot down when its activity ages out of the window", async () => {
    await refreshHotScores(serviceClient());
    expect(await hotOf(freshSpot)).toBeGreaterThan(0);

    // Delete and re-insert rather than UPDATE: `signals` deliberately has no
    // UPDATE privilege — a vote is changed by delete-then-insert, which is what
    // cast_signal does atomically. An UPDATE here silently does nothing and the
    // test passes for the wrong reason.
    const db = serviceClient();
    await db.from("signals").delete().eq("spot_id", freshSpot);
    await db.from("signals").insert({
      spot_id: freshSpot,
      profile_id: userId,
      kind: "shoot_type_upvote",
      shoot_type_id: familyTypeId,
      value: 1,
      created_at: daysAgo(HOT_WINDOW_DAYS + 1),
    });

    await refreshHotScores(db);
    expect(await hotOf(freshSpot)).toBe(0);
  });

  it("is idempotent", async () => {
    await refreshHotScores(serviceClient());
    const first = await hotOf(staleSpot);
    await refreshHotScores(serviceClient());
    expect(await hotOf(staleSpot)).toBe(first);
  });

  it("decays: the same activity scores lower when it is older", async () => {
    const db = serviceClient();
    const spot = await makeSpot("Decay Spot");
    await db.from("comments").insert({ spot_id: spot, profile_id: userId, body: "Fresh." });

    await refreshHotScores(db);
    const whenNew = await hotOf(spot);

    await db
      .from("comments")
      .update({ created_at: daysAgo(28) })
      .eq("spot_id", spot);
    await refreshHotScores(db);
    const whenOld = await hotOf(spot);

    expect(whenNew).toBeGreaterThan(whenOld);
    expect(whenOld).toBeGreaterThan(0);
    // Two 14-day half-lives: roughly a quarter of the original.
    expect(whenOld).toBeCloseTo(whenNew / 4, 2);

    await db.from("spots").delete().eq("id", spot);
  });

  it("reports how many spots it updated", async () => {
    const updated = await refreshHotScores(serviceClient());
    expect(updated).toBeGreaterThanOrEqual(3);
  });
});
