import { describe, it, expect } from "vitest";
import { reportIntentFrom, reportConfirmation } from "./ReportButton";

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
};

describe("reportIntentFrom", () => {
  it("reads a target and reason", () => {
    expect(
      reportIntentFrom(form({ intent: "report", targetType: "comment", targetId: "c1", reason: "abuse" })),
    ).toEqual({ targetType: "comment", targetId: "c1", reason: "abuse", note: null });
  });

  it("is null when nothing is in flight", () => {
    expect(reportIntentFrom(undefined)).toBeNull();
  });

  it("is null for another intent", () => {
    expect(reportIntentFrom(form({ intent: "upvote", shootTypeId: "1" }))).toBeNull();
  });

  // target_type is a Postgres enum, so a bad value is a 22P02 the user cannot
  // act on — and the action is a public endpoint, not just this form.
  it("is null for a target type that is not one of the three", () => {
    expect(
      reportIntentFrom(form({ intent: "report", targetType: "profile", targetId: "p1", reason: "spam" })),
    ).toBeNull();
  });

  it("is null for a reason outside the vocabulary", () => {
    expect(
      reportIntentFrom(form({ intent: "report", targetType: "spot", targetId: "s1", reason: "nope" })),
    ).toBeNull();
  });

  it("is null when the target id is missing", () => {
    expect(
      reportIntentFrom(form({ intent: "report", targetType: "spot", targetId: "", reason: "spam" })),
    ).toBeNull();
  });

  // An empty note is "no note", not an empty string to store.
  it("reads a blank note as null", () => {
    const parsed = reportIntentFrom(
      form({ intent: "report", targetType: "spot", targetId: "s1", reason: "spam", note: "   " }),
    );
    expect(parsed?.note).toBeNull();
  });

  it("keeps a real note, trimmed", () => {
    const parsed = reportIntentFrom(
      form({ intent: "report", targetType: "spot", targetId: "s1", reason: "spam", note: "  bad  " }),
    );
    expect(parsed?.note).toBe("bad");
  });
});

describe("reportConfirmation", () => {
  // Reporting is not a vote: the reporter should be told it went somewhere and
  // not be promised an outcome, because an admin may well dismiss it.
  it("confirms without promising an outcome", () => {
    const text = reportConfirmation();
    expect(text).toMatch(/thank|received|logged/i);
    expect(text).not.toMatch(/removed|deleted/i);
  });
});
