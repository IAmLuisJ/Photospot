import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { fileReport, listReportQueue, resolveReport } from "../../app/data/reports";

let boss: TestUser;
let author: TestUser;
let spotId: string;

const admin = () => serviceClient();

beforeAll(async () => {
  boss = await createTestUser("Queue Admin");
  author = await createTestUser("Queue Author");
  const { error: promote } = await admin()
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", boss.id);
  if (promote) throw promote;

  const { data, error } = await admin()
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Report Target",
      slug: `report-target-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.67 42.94)",
      created_by: author.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = data.id;
});

afterAll(async () => {
  // Reports have no cascade from spots — target_id is polymorphic with no
  // foreign key — so they have to be deleted explicitly or they outlive the
  // fixture and pollute every later run of the queue tests.
  const { error: reportError } = await admin().from("reports").delete().eq("target_id", spotId);
  if (reportError) throw reportError;
  const { error } = await admin().from("spots").delete().eq("id", spotId);
  if (error) throw error;
  await deleteTestUser(boss.id);
  await deleteTestUser(author.id);
});

describe("fileReport", () => {
  it("stores a report attributed to the caller", async () => {
    await fileReport(author.client, {
      targetType: "spot",
      targetId: spotId,
      reason: "unsafe",
      note: "The stairs are broken.",
      profileId: author.id,
    });

    const { data } = await admin()
      .from("reports")
      .select("target_type, reason, note, status, profile_id")
      .eq("target_id", spotId)
      .single();
    expect(data).toEqual({
      target_type: "spot",
      reason: "unsafe",
      note: "The stairs are broken.",
      status: "open",
      profile_id: author.id,
    });
  });

  // RLS is the authority here (reports_insert: profile_id = auth.uid()), so
  // passing someone else's id must fail at the database rather than be trusted.
  it("cannot be attributed to somebody else", async () => {
    await expect(
      fileReport(author.client, {
        targetType: "spot",
        targetId: spotId,
        reason: "spam",
        note: null,
        profileId: boss.id,
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses a logged-out reporter", async () => {
    await expect(
      fileReport(anonClient(), {
        targetType: "spot",
        targetId: spotId,
        reason: "spam",
        note: null,
        profileId: author.id,
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  // reports.reason is free text, so the database will store anything and an
  // unrecognised value renders as itself in the queue forever.
  it("rejects a reason outside the vocabulary before it reaches the database", async () => {
    await expect(
      fileReport(author.client, {
        targetType: "spot",
        targetId: spotId,
        reason: "because_i_say_so",
        note: null,
        profileId: author.id,
      }),
    ).rejects.toThrow(/reason/i);
  });

  it("stores a whitespace-only note as no note", async () => {
    await fileReport(author.client, {
      targetType: "spot",
      targetId: spotId,
      reason: "wrong_place",
      note: "   \n ",
      profileId: author.id,
    });

    const { data } = await admin()
      .from("reports")
      .select("note")
      .eq("target_id", spotId)
      .eq("reason", "wrong_place")
      .single();
    expect(data!.note).toBeNull();
  });
});

describe("listReportQueue", () => {
  it("maps the RPC into camelCase rows the queue can render", async () => {
    const rows = await listReportQueue(boss.client);
    const row = rows.find((r) => r.targetId === spotId)!;
    expect(row.targetType).toBe("spot");
    expect(row.targetTitle).toBe("Report Target");
    expect(row.targetStatus).toBe("published");
    expect(row.status).toBe("open");
  });

  // An empty queue and a forbidden one look identical to a caller, and the
  // difference is what decides whether to show an admin surface at all.
  it("throws for a non-admin rather than returning an empty queue", async () => {
    await expect(listReportQueue(author.client)).rejects.toBeTruthy();
  });

  it("throws for a logged-out visitor", async () => {
    await expect(listReportQueue(anonClient())).rejects.toMatchObject({ code: "42501" });
  });
});

describe("resolveReport", () => {
  it("hides a spot and closes its report in one call", async () => {
    const open = (await listReportQueue(boss.client)).find(
      (r) => r.targetId === spotId && r.status === "open",
    )!;
    await resolveReport(boss.client, open.id, "hide");

    const { data } = await admin().from("spots").select("status").eq("id", spotId).single();
    expect(data!.status).toBe("hidden");

    const { data: report } = await admin()
      .from("reports")
      .select("status")
      .eq("id", open.id)
      .single();
    expect(report!.status).toBe("resolved");
  });

  it("refuses a non-admin", async () => {
    const open = (await listReportQueue(boss.client)).find(
      (r) => r.targetId === spotId && r.status === "open",
    )!;
    await expect(resolveReport(author.client, open.id, "remove")).rejects.toBeTruthy();
  });
});
