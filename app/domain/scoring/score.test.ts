import { describe, it, expect } from "vitest";
import { computeScore, ZERO_COUNTERS, type SpotCounters } from "./score";
import { DEFAULT_WEIGHTS } from "./weights";

const counters = (overrides: Partial<SpotCounters> = {}): SpotCounters => ({
  ...ZERO_COUNTERS,
  ...overrides,
});

describe("computeScore", () => {
  it("is zero for a spot with no activity", () => {
    expect(computeScore(ZERO_COUNTERS)).toBe(0);
  });

  it("sums each signal type by its weight", () => {
    const result = computeScore(
      counters({
        shootTypeUpvoteCount: 3,
        shootAgainYesCount: 2,
        commentCount: 4,
        scoutingPhotoCount: 2,
        sessionPhotoCount: 1,
      }),
    );
    // 3(1.0) + 2(2.0) + 4(0.5) + 2(1.0) + 1(1.5) = 12.5
    expect(result).toBe(12.5);
  });

  it("subtracts shoot-again no votes", () => {
    const result = computeScore(counters({ shootAgainYesCount: 2, shootAgainNoCount: 2 }));
    // 2(2.0) + 2(-1.5) = 1
    expect(result).toBe(1);
  });

  it("can go negative when a spot is widely rejected", () => {
    expect(computeScore(counters({ shootAgainNoCount: 4 }))).toBe(-6);
  });

  it("accepts alternative weights so ranking can be tuned without a migration", () => {
    const result = computeScore(counters({ shootTypeUpvoteCount: 3 }), {
      ...DEFAULT_WEIGHTS,
      shootTypeUpvote: 10,
    });
    expect(result).toBe(30);
  });

  it("rounds to three decimals to keep stored values stable", () => {
    // 0.1236 rounds UP to 0.124. A truncating implementation would give 0.123,
    // so this value distinguishes rounding from truncation; 0.1234567 would not.
    const result = computeScore(counters({ commentCount: 1 }), {
      ...DEFAULT_WEIGHTS,
      comment: 0.1236,
    });
    expect(result).toBe(0.124);
  });
});
