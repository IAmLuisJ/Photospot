import { describe, it, expect } from "vitest";
import {
  computeHotScore,
  HOT_HALF_LIFE_DAYS,
  HOT_WINDOW_DAYS,
  type ActivityEvent,
} from "./hot";

const NOW = new Date("2026-08-09T12:00:00Z");

const daysAgo = (days: number): Date =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const event = (weight: number, days: number): ActivityEvent => ({
  weight,
  occurredAt: daysAgo(days),
});

describe("computeHotScore", () => {
  it("is zero with no activity", () => {
    expect(computeHotScore([], NOW)).toBe(0);
  });

  it("counts activity from right now at full weight", () => {
    expect(computeHotScore([event(4, 0)], NOW)).toBe(4);
  });

  it("halves an event's contribution after one half-life", () => {
    expect(computeHotScore([event(4, HOT_HALF_LIFE_DAYS)], NOW)).toBe(2);
  });

  it("quarters an event's contribution after two half-lives", () => {
    expect(computeHotScore([event(4, HOT_HALF_LIFE_DAYS * 2)], NOW)).toBe(1);
  });

  it("ignores events older than the trailing window", () => {
    expect(computeHotScore([event(100, HOT_WINDOW_DAYS + 1)], NOW)).toBe(0);
  });

  it("lets recent activity outrank a larger but older pile", () => {
    const fresh = computeHotScore([event(3, 0)], NOW);
    const stale = computeHotScore([event(8, HOT_HALF_LIFE_DAYS * 3)], NOW);
    expect(fresh).toBeGreaterThan(stale);
  });

  it("sums multiple events", () => {
    const result = computeHotScore(
      [event(2, 0), event(2, HOT_HALF_LIFE_DAYS)],
      NOW,
    );
    expect(result).toBe(3);
  });

  // Without this, step decay passes: every other test samples an exact multiple
  // of the half-life, where a staircase and a smooth curve agree. Verified by
  // mutation — floor/ceil/round variants of the exponent all survive the rest
  // of this suite and are caught only here.
  it("decays continuously between half-lives, not in steps", () => {
    // Half a half-life: 4 * 0.5^0.5 = 2.828..., not 4 (step) and not 3 (linear).
    expect(computeHotScore([event(4, HOT_HALF_LIFE_DAYS / 2)], NOW)).toBe(2.828);
  });

  it("treats future timestamps as now rather than amplifying them", () => {
    const future: ActivityEvent = { weight: 5, occurredAt: daysAgo(-10) };
    expect(computeHotScore([future], NOW)).toBe(5);
  });
});
