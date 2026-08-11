import { describe, it, expect } from "vitest";
import { queueSummary, isActionable, availableActions } from "./ReportRow";
import type { QueuedReport } from "~/data/reports";

const report = (over: Partial<QueuedReport> = {}): QueuedReport => ({
  id: "r1",
  targetType: "spot",
  targetId: "s1",
  targetTitle: "Millennium Park Meadow",
  targetStatus: "published",
  reason: "unsafe",
  note: null,
  status: "open",
  createdAt: "2026-08-11T10:00:00.000Z",
  ...over,
});

describe("queueSummary", () => {
  it("leads with the target title and the reason in words", () => {
    const line = queueSummary(report());
    expect(line).toContain("Millennium Park Meadow");
    expect(line).toContain("Going here is unsafe");
  });

  // A deleted target leaves the report pointing at nothing — it still has to
  // render, and still has to be dismissable.
  it("copes with a target that no longer exists", () => {
    const line = queueSummary(report({ targetTitle: null, targetStatus: null }));
    expect(line).toContain("deleted");
  });

  it("says what has already been done to the target", () => {
    expect(queueSummary(report({ targetStatus: "removed" }))).toContain("removed");
  });

  it("says nothing extra when the target is untouched", () => {
    expect(queueSummary(report({ targetStatus: "published" }))).not.toContain("already");
  });
});

describe("isActionable", () => {
  it("is true for an open report with a live target", () => {
    expect(isActionable(report())).toBe(true);
  });

  // Re-resolving a closed report would reopen work that is already done.
  it("is false once resolved or dismissed", () => {
    expect(isActionable(report({ status: "resolved" }))).toBe(false);
    expect(isActionable(report({ status: "dismissed" }))).toBe(false);
  });

  it("is false when the target is gone", () => {
    expect(isActionable(report({ targetTitle: null, targetStatus: null }))).toBe(false);
  });
});

describe("availableActions", () => {
  it("offers hide, remove and dismiss for a live spot", () => {
    expect(availableActions(report())).toEqual(["hide", "remove", "dismiss"]);
  });

  it("omits hide for a comment, whose status column has no such state", () => {
    expect(availableActions(report({ targetType: "comment" }))).toEqual(["remove", "dismiss"]);
  });

  // The destructive actions need something to act on, but the report itself
  // must still be clearable or it sits in the queue forever.
  it("leaves only dismiss when the target has been deleted", () => {
    expect(availableActions(report({ targetTitle: null, targetStatus: null }))).toEqual(["dismiss"]);
  });

  it("offers nothing for a report that is already closed", () => {
    expect(availableActions(report({ status: "resolved" }))).toEqual([]);
  });
});
