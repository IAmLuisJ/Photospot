import { describe, it, expect } from "vitest";
import {
  REPORT_REASONS,
  isReportReason,
  actionsFor,
  labelForReason,
  type ReportTarget,
} from "./reasons";

describe("REPORT_REASONS", () => {
  it("offers the takedown reason spec §4.3 requires", () => {
    expect(REPORT_REASONS.map((r) => r.value)).toContain("rights");
  });

  it("keeps values machine-shaped and labels human-shaped", () => {
    for (const reason of REPORT_REASONS) {
      expect(reason.value).toMatch(/^[a-z][a-z_]*$/);
      expect(reason.label[0]).toMatch(/[A-Z]/);
    }
  });

  it("has no duplicate values", () => {
    const values = REPORT_REASONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("recognises which strings are reasons", () => {
    expect(isReportReason("rights")).toBe(true);
    expect(isReportReason("Rights")).toBe(false);
    expect(isReportReason("")).toBe(false);
  });

  it("labels a known reason and falls back to the raw value", () => {
    expect(labelForReason("rights")).not.toBe("rights");
    // Reports filed before a reason was renamed still have to render.
    expect(labelForReason("mystery")).toBe("mystery");
  });
});

describe("actionsFor", () => {
  // spots.status is spot_status (published | hidden | removed); photos and
  // comments are content_status (published | removed). Hide does not exist for
  // them, and a queue must not offer an action the target cannot take.
  it("offers hide only for a spot", () => {
    expect(actionsFor("spot")).toContain("hide");
    expect(actionsFor("photo")).not.toContain("hide");
    expect(actionsFor("comment")).not.toContain("hide");
  });

  it("offers remove and dismiss for every target", () => {
    for (const target of ["spot", "photo", "comment"] as ReportTarget[]) {
      expect(actionsFor(target)).toContain("remove");
      expect(actionsFor(target)).toContain("dismiss");
    }
  });

  it("never offers the same action twice", () => {
    for (const target of ["spot", "photo", "comment"] as ReportTarget[]) {
      const actions = actionsFor(target);
      expect(new Set(actions).size).toBe(actions.length);
    }
  });
});
