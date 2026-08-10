import { describe, it, expect } from "vitest";
import { weightForSignalKind, type WeightedActivity } from "./signal-weight";
import { computeScore, ZERO_COUNTERS } from "./score";
import { DEFAULT_WEIGHTS } from "./weights";

describe("weightForSignalKind", () => {
  it("weights a shoot-type upvote", () => {
    expect(weightForSignalKind({ kind: "shoot_type_upvote" })).toBe(1.0);
  });

  it("distinguishes a shoot-again yes from a no", () => {
    expect(weightForSignalKind({ kind: "shoot_again", value: 1 })).toBe(2.0);
    expect(weightForSignalKind({ kind: "shoot_again", value: 0 })).toBe(-1.5);
  });

  it("weights a comment", () => {
    expect(weightForSignalKind({ kind: "comment" })).toBe(0.5);
  });

  it("distinguishes scouting from session photos", () => {
    expect(weightForSignalKind({ kind: "photo", photoKind: "scouting" })).toBe(1.0);
    expect(weightForSignalKind({ kind: "photo", photoKind: "session" })).toBe(1.5);
  });

  it("honours alternative weights", () => {
    const w = { ...DEFAULT_WEIGHTS, shootTypeUpvote: 10 };
    expect(weightForSignalKind({ kind: "shoot_type_upvote" }, w)).toBe(10);
  });

  // The whole point of this module. computeScore applies weights internally
  // from counters; the hot-refresh job applies them per event before calling
  // computeHotScore. If those two disagree, the lifetime and hot rankings drift
  // apart after any re-weighting, silently and with no failing test.
  it("agrees with computeScore for the same activity", () => {
    const activity: WeightedActivity[] = [
      { kind: "shoot_type_upvote" },
      { kind: "shoot_type_upvote" },
      { kind: "shoot_again", value: 1 },
      { kind: "shoot_again", value: 0 },
      { kind: "comment" },
      { kind: "photo", photoKind: "scouting" },
      { kind: "photo", photoKind: "session" },
    ];

    const viaMapping = activity.reduce((sum, a) => sum + weightForSignalKind(a), 0);

    const viaCounters = computeScore({
      ...ZERO_COUNTERS,
      shootTypeUpvoteCount: 2,
      shootAgainYesCount: 1,
      shootAgainNoCount: 1,
      commentCount: 1,
      scoutingPhotoCount: 1,
      sessionPhotoCount: 1,
    });

    expect(Math.round(viaMapping * 1000) / 1000).toBe(viaCounters);
  });

  it("still agrees after the weights are retuned", () => {
    const tuned = {
      shootTypeUpvote: 3,
      shootAgainYes: 7,
      shootAgainNo: -2.25,
      comment: 0.75,
      scoutingPhoto: 4,
      sessionPhoto: 6.5,
    };
    const activity: WeightedActivity[] = [
      { kind: "shoot_type_upvote" },
      { kind: "shoot_again", value: 0 },
      { kind: "photo", photoKind: "session" },
      { kind: "comment" },
    ];

    const viaMapping = activity.reduce((sum, a) => sum + weightForSignalKind(a, tuned), 0);
    const viaCounters = computeScore(
      {
        ...ZERO_COUNTERS,
        shootTypeUpvoteCount: 1,
        shootAgainNoCount: 1,
        sessionPhotoCount: 1,
        commentCount: 1,
      },
      tuned,
    );

    expect(Math.round(viaMapping * 1000) / 1000).toBe(viaCounters);
  });
});
