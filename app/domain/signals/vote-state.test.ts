import { describe, it, expect } from "vitest";
import {
  applyPendingUpvote,
  applyPendingShootAgain,
  type ShootTypeVoteState,
  type ShootAgainState,
} from "./vote-state";

const rows = (): ShootTypeVoteState[] => [
  { shootTypeId: 1, label: "Family", upvoteCount: 3, viewerUpvoted: false },
  { shootTypeId: 9, label: "Pets", upvoteCount: 1, viewerUpvoted: true },
];

describe("applyPendingUpvote", () => {
  it("returns the rows unchanged when nothing is in flight", () => {
    expect(applyPendingUpvote(rows(), null)).toEqual(rows());
  });

  it("adds the viewer's vote optimistically", () => {
    const [family] = applyPendingUpvote(rows(), { shootTypeId: 1, upvoted: true });
    expect(family.upvoteCount).toBe(4);
    expect(family.viewerUpvoted).toBe(true);
  });

  it("removes it again on a retraction", () => {
    const pets = applyPendingUpvote(rows(), { shootTypeId: 9, upvoted: false })[1];
    expect(pets.upvoteCount).toBe(0);
    expect(pets.viewerUpvoted).toBe(false);
  });

  // The server treats a duplicate vote as success (spec §9.2), so a double
  // click sends the same intent twice. If that incremented twice the count
  // would visibly jump by two and then snap back on revalidation.
  it("is idempotent — re-asserting a vote the viewer already cast changes nothing", () => {
    expect(applyPendingUpvote(rows(), { shootTypeId: 9, upvoted: true })).toEqual(rows());
    expect(applyPendingUpvote(rows(), { shootTypeId: 1, upvoted: false })).toEqual(rows());
  });

  it("leaves every other row alone", () => {
    const after = applyPendingUpvote(rows(), { shootTypeId: 1, upvoted: true });
    expect(after[1]).toEqual(rows()[1]);
  });

  it("ignores a shoot type that is not on the list", () => {
    expect(applyPendingUpvote(rows(), { shootTypeId: 404, upvoted: true })).toEqual(rows());
  });

  it("does not mutate the rows it was given", () => {
    const original = rows();
    applyPendingUpvote(original, { shootTypeId: 1, upvoted: true });
    expect(original).toEqual(rows());
  });

  // Distinct from the mutation check above: this proves the *output* rows
  // are independent copies, not aliases back into the input array — even on
  // the unchanged paths where the values happen to be identical. Without
  // this, a caller that mutates a returned row in place would corrupt the
  // input too, and no other test here would notice.
  it("returns fresh row objects, not aliases into the input", () => {
    const input = rows();
    const after = applyPendingUpvote(input, { shootTypeId: 1, upvoted: true });
    after.forEach((row, i) => expect(row).not.toBe(input[i]));
  });
});

const shootAgain = (over: Partial<ShootAgainState> = {}): ShootAgainState => ({
  yesCount: 5,
  noCount: 2,
  viewerAnswer: null,
  ...over,
});

describe("applyPendingShootAgain", () => {
  it("returns the state unchanged when nothing is in flight", () => {
    expect(applyPendingShootAgain(shootAgain(), undefined)).toEqual(shootAgain());
  });

  it("counts a first answer", () => {
    expect(applyPendingShootAgain(shootAgain(), 1)).toEqual(
      shootAgain({ yesCount: 6, viewerAnswer: 1 }),
    );
  });

  // The reason cast_signal exists: flipping is a delete plus an insert, and
  // both counters move. Adding to the new side without removing from the old
  // shows the viewer voting twice.
  it("moves the vote across when the viewer flips their answer", () => {
    const before = shootAgain({ viewerAnswer: 1 });
    expect(applyPendingShootAgain(before, 0)).toEqual(
      shootAgain({ yesCount: 4, noCount: 3, viewerAnswer: 0 }),
    );
  });

  it("takes the vote back on a retraction", () => {
    const before = shootAgain({ viewerAnswer: 0 });
    expect(applyPendingShootAgain(before, null)).toEqual(
      shootAgain({ noCount: 1, viewerAnswer: null }),
    );
  });

  it("is idempotent — repeating the current answer changes nothing", () => {
    const before = shootAgain({ viewerAnswer: 1 });
    expect(applyPendingShootAgain(before, 1)).toEqual(before);
  });

  // As given in the plan this test asserted `toEqual(before)`, i.e. that
  // retracting leaves viewerAnswer at 1. That contradicts "takes the vote
  // back on a retraction" above, which requires viewerAnswer to become null
  // on any `null` pending. Fixed to check the actual intent: clamp keeps
  // yesCount from going negative, while viewerAnswer still transitions.
  it("never shows a negative count", () => {
    const before = shootAgain({ yesCount: 0, noCount: 0, viewerAnswer: 1 });
    expect(applyPendingShootAgain(before, null)).toEqual(
      shootAgain({ yesCount: 0, noCount: 0, viewerAnswer: null }),
    );
  });
});
