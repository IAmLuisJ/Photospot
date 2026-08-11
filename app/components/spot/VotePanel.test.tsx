import { describe, it, expect } from "vitest";
import {
  pendingUpvoteFrom,
  pendingShootAgainFrom,
  upvoteLabel,
  voteTotalsLine,
} from "./VotePanel";

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
};

describe("pendingUpvoteFrom", () => {
  it("is null when no submission is in flight", () => {
    expect(pendingUpvoteFrom(undefined)).toBeNull();
  });

  it("reads an upvote in flight", () => {
    expect(pendingUpvoteFrom(form({ intent: "upvote", shootTypeId: "3" }))).toEqual({
      shootTypeId: 3,
      upvoted: true,
    });
  });

  it("reads a retraction in flight", () => {
    expect(pendingUpvoteFrom(form({ intent: "unvote", shootTypeId: "3" }))).toEqual({
      shootTypeId: 3,
      upvoted: false,
    });
  });

  it("ignores a submission for a different intent", () => {
    expect(pendingUpvoteFrom(form({ intent: "comment", body: "hi" }))).toBeNull();
  });

  // Number("") is 0, not NaN, so a missing field would otherwise be read as a
  // pending vote on shoot type 0 rather than as nothing in flight.
  it("ignores a submission with no shoot type on it", () => {
    expect(pendingUpvoteFrom(form({ intent: "upvote" }))).toBeNull();
  });

  it("ignores a shoot type that is not a number", () => {
    expect(pendingUpvoteFrom(form({ intent: "upvote", shootTypeId: "family" }))).toBeNull();
  });
});

describe("pendingShootAgainFrom", () => {
  // undefined means "nothing in flight" and null means "retract", so these two
  // cases must not collapse into each other.
  it("distinguishes nothing-in-flight from a retraction", () => {
    expect(pendingShootAgainFrom(undefined)).toBeUndefined();
    expect(pendingShootAgainFrom(form({ intent: "shoot-again", answer: "retract" }))).toBeNull();
  });

  it("reads yes and no", () => {
    expect(pendingShootAgainFrom(form({ intent: "shoot-again", answer: "yes" }))).toBe(1);
    expect(pendingShootAgainFrom(form({ intent: "shoot-again", answer: "no" }))).toBe(0);
  });

  it("ignores a submission for a different intent", () => {
    expect(pendingShootAgainFrom(form({ intent: "upvote", shootTypeId: "1" }))).toBeUndefined();
  });

  it("treats an unrecognised answer as nothing in flight", () => {
    expect(pendingShootAgainFrom(form({ intent: "shoot-again", answer: "maybe" }))).toBeUndefined();
  });
});

describe("upvoteLabel", () => {
  it("offers to add a vote", () => {
    expect(
      upvoteLabel({ shootTypeId: 1, label: "Family", upvoteCount: 2, viewerUpvoted: false }),
    ).toBe("Upvote Family");
  });

  it("offers to take it back once cast", () => {
    expect(
      upvoteLabel({ shootTypeId: 1, label: "Family", upvoteCount: 3, viewerUpvoted: true }),
    ).toBe("Remove your Family upvote");
  });
});

describe("voteTotalsLine", () => {
  const totals = (over = {}) => ({
    shootTypeUpvoteCount: 4,
    shootAgainYesCount: 2,
    shootAgainNoCount: 0,
    ...over,
  });

  it("summarises the lifetime counts", () => {
    expect(voteTotalsLine(totals())).toBe("4 upvotes · 2 would shoot here again");
  });

  // This line predates voting, so every count was necessarily zero and the
  // plural read correctly by accident.
  it("says one upvote, not one upvotes", () => {
    expect(voteTotalsLine(totals({ shootTypeUpvoteCount: 1 }))).toBe(
      "1 upvote · 2 would shoot here again",
    );
  });

  it("still says upvotes for none", () => {
    expect(voteTotalsLine(totals({ shootTypeUpvoteCount: 0 }))).toContain("0 upvotes");
  });

  // Nobody has said no is the common case, and the clause would read oddly at
  // zero — "0 would not" invites the reader to wonder who did.
  it("omits the dissent clause when there is none", () => {
    expect(voteTotalsLine(totals())).not.toContain("would not");
  });

  it("includes the dissent clause when there is some", () => {
    expect(voteTotalsLine(totals({ shootAgainNoCount: 3 }))).toBe(
      "4 upvotes · 2 would shoot here again · 3 would not",
    );
  });
});
