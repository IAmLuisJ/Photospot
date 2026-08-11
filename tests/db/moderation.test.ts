import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";

let boss: TestUser;
let author: TestUser;
let spotId: string;
let spotSlug: string;
let commentId: string;
let spotReportId: string;
let commentReportId: string;

const admin = () => serviceClient();

/** Promotes a test user to admin, which no application code may do (plan 1). */
const promote = async (id: string) => {
  const { error } = await admin().from("profiles").update({ role: "admin" }).eq("id", id);
  if (error) throw error;
};

beforeAll(async () => {
  boss = await createTestUser("Moderator");
  author = await createTestUser("Reported Author");
  await promote(boss.id);

  spotSlug = `moderation-${crypto.randomUUID().slice(0, 8)}`;
  const { data: spot, error } = await admin()
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Moderation Target",
      slug: spotSlug,
      location: "POINT(-85.68 42.95)",
      created_by: author.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = spot.id;

  const { data: comment } = await admin()
    .from("comments")
    .insert({ spot_id: spotId, profile_id: author.id, body: "Reported comment." })
    .select("id")
    .single();
  commentId = comment!.id;

  // Both objects carry the same keys: PostgREST unions the keys of a bulk
  // insert and nulls the gaps, bypassing column defaults.
  const { data: reports, error: reportError } = await admin()
    .from("reports")
    .insert([
      { target_type: "spot", target_id: spotId, profile_id: author.id, reason: "unsafe", note: null },
      { target_type: "comment", target_id: commentId, profile_id: author.id, reason: "abuse", note: null },
    ])
    .select("id, target_type");
  if (reportError) throw reportError;
  spotReportId = reports!.find((r) => r.target_type === "spot")!.id;
  commentReportId = reports!.find((r) => r.target_type === "comment")!.id;
});

afterAll(async () => {
  await admin().from("reports").delete().eq("target_id", spotId);
  await admin().from("reports").delete().eq("target_id", commentId);
  const { error } = await admin().from("spots").delete().eq("id", spotId);
  if (error) throw error;
  await deleteTestUser(boss.id);
  await deleteTestUser(author.id);
});

const statusOf = async (table: "spots" | "comments", id: string) => {
  const { data } = await admin().from(table).select("status").eq("id", id).single();
  return data!.status;
};

const reportRow = async (id: string) => {
  const { data } = await admin().from("reports").select("status, resolved_by").eq("id", id).single();
  return data!;
};

/** A throwaway open report on the spot, for tests that need to consume one. */
const spareReport = async (targetType: "spot" | "comment", targetId: string) => {
  const { data } = await admin()
    .from("reports")
    .insert({ target_type: targetType, target_id: targetId, profile_id: author.id, reason: "spam" })
    .select("id")
    .single();
  return data!.id as string;
};

// These run in order and share state: the spot is hidden partway through.
describe("resolve_report", () => {
  it("refuses a caller who is not an admin", async () => {
    const { error } = await author.client.rpc("resolve_report", {
      p_report_id: spotReportId,
      p_action: "remove",
    });
    expect(error).not.toBeNull();
    expect(await statusOf("spots", spotId)).toBe("published");
  });

  it("refuses a logged-out caller", async () => {
    const { error } = await anonClient().rpc("resolve_report", {
      p_report_id: spotReportId,
      p_action: "remove",
    });
    expect(error?.code).toBe("42501");
  });

  // The gap this function exists to close: an admin cannot write spots.status
  // through PostgREST at all, because `admin` is a value in profiles.role and
  // no column grant can express it.
  it("hides a spot, which a direct update cannot do even as an admin", async () => {
    const direct = await boss.client.from("spots").update({ status: "hidden" }).eq("id", spotId);
    expect(direct.error?.code).toBe("42501");

    const { error } = await boss.client.rpc("resolve_report", {
      p_report_id: spotReportId,
      p_action: "hide",
    });
    expect(error).toBeNull();
    expect(await statusOf("spots", spotId)).toBe("hidden");
  });

  // Both rows move together, or an admin does the work twice and the queue
  // never empties.
  it("resolves the report in the same call", async () => {
    const row = await reportRow(spotReportId);
    expect(row.status).toBe("resolved");
    expect(row.resolved_by).toBe(boss.id);
  });

  it("removes a comment", async () => {
    const { error } = await boss.client.rpc("resolve_report", {
      p_report_id: commentReportId,
      p_action: "remove",
    });
    expect(error).toBeNull();
    expect(await statusOf("comments", commentId)).toBe("removed");
    expect((await reportRow(commentReportId)).status).toBe("resolved");
  });

  // spots.status is spot_status; comments.status is content_status, which has
  // no 'hidden'. Asking for one must fail loudly rather than storing something
  // adjacent.
  // The guard is about the message, not the outcome: without it,
  // `'hidden'::content_status` raises 22P02 and the report is left open just
  // the same. Asserting only "something threw" therefore passes with the guard
  // removed — so this asserts the sentence an admin would actually read.
  it("refuses to hide a comment, and says why rather than naming an enum", async () => {
    const id = await spareReport("comment", commentId);
    const { error } = await boss.client.rpc("resolve_report", { p_report_id: id, p_action: "hide" });

    expect(error?.message).toMatch(/only a spot can be hidden/i);
    expect(error?.message).not.toMatch(/invalid input value/i);
    expect((await reportRow(id)).status).toBe("open");
  });

  it("dismisses without touching the target", async () => {
    const id = await spareReport("spot", spotId);
    const before = await statusOf("spots", spotId);

    const { error } = await boss.client.rpc("resolve_report", {
      p_report_id: id,
      p_action: "dismiss",
    });
    expect(error).toBeNull();
    expect(await statusOf("spots", spotId)).toBe(before);
    expect((await reportRow(id)).status).toBe("dismissed");
  });

  // Without the guard, `p_action::spot_status` raises a cast error anyway — so
  // asserting only that something threw would pass for the wrong reason. The
  // report still being open is what proves the guard ran first.
  it("rejects an unknown action rather than resolving the report anyway", async () => {
    const id = await spareReport("spot", spotId);
    const { error } = await boss.client.rpc("resolve_report", {
      p_report_id: id,
      p_action: "delete_everything",
    });
    expect(error).not.toBeNull();
    expect((await reportRow(id)).status).toBe("open");
  });

  it("refuses a report id that does not exist", async () => {
    const { error } = await boss.client.rpc("resolve_report", {
      p_report_id: "00000000-0000-0000-0000-000000000000",
      p_action: "dismiss",
    });
    expect(error).not.toBeNull();
  });

  // Spec §9.4: moderation is not reversible by the author. The definer
  // function bypasses RLS by design, so this proves the policies still hold
  // for the author afterwards.
  it("leaves the author unable to un-remove their own comment", async () => {
    const { error } = await author.client
      .from("comments")
      .update({ status: "published" })
      .eq("id", commentId);
    // RLS matches no rows rather than erroring, so assert on what survived.
    expect(error).toBeNull();
    expect(await statusOf("comments", commentId)).toBe("removed");
  });
});

describe("admin_report_queue", () => {
  it("is refused to a non-admin", async () => {
    const { data, error } = await author.client.rpc("admin_report_queue");
    // Either a hard refusal or an empty queue is acceptable; leaking another
    // user's reports is not.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("is refused to a logged-out visitor", async () => {
    const { error } = await anonClient().rpc("admin_report_queue");
    expect(error?.code).toBe("42501");
  });

  // The reason this exists: spot_by_slug and spots_in_viewport both filter
  // status = 'published', so once a spot is hidden an admin can no longer load
  // the thing they are being asked to judge.
  it("shows a hidden spot's title, which no public query returns", async () => {
    const { data: bySlug } = await boss.client.rpc("spot_by_slug", { p_slug: spotSlug });
    expect(bySlug ?? []).toHaveLength(0);

    const { data, error } = await boss.client.rpc("admin_report_queue");
    expect(error).toBeNull();
    const row = (data ?? []).find((r: { target_id: string }) => r.target_id === spotId);
    expect(row).toBeDefined();
    expect(row.target_title).toBe("Moderation Target");
    expect(row.target_status).toBe("hidden");
  });

  it("carries the reason and the target type so the queue can be read at a glance", async () => {
    const { data } = await boss.client.rpc("admin_report_queue");
    const row = (data ?? []).find((r: { target_id: string }) => r.target_id === commentId);
    expect(row?.target_type).toBe("comment");
    expect(typeof row?.reason).toBe("string");
  });

  it("puts open reports before closed ones", async () => {
    const { data } = await boss.client.rpc("admin_report_queue");
    const statuses = (data ?? []).map((r: { status: string }) => r.status === "open");
    // Every open report comes before every closed one.
    expect(statuses.indexOf(false) === -1 || !statuses.slice(statuses.indexOf(false)).includes(true)).toBe(
      true,
    );
  });
});

describe("spot_by_slug after the signature change", () => {
  it("still returns published spots to anonymous visitors", async () => {
    const { data, error } = await anonClient().rpc("spot_by_slug", { p_slug: "fish-ladder-park" });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });

  // Added so the detail page can stop offering "Edit this spot" to everyone —
  // the silent no-op plan 5 turned into an error message.
  it("returns created_by so the page can tell who may edit", async () => {
    const { data } = await anonClient().rpc("spot_by_slug", { p_slug: "fish-ladder-park" });
    expect(data![0]).toHaveProperty("created_by");
    expect(data![0]).toHaveProperty("owner_profile_id");
  });
});
