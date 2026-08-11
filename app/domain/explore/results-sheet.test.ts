import { describe, it, expect } from "vitest";
import { nextSnap, SNAP_HEIGHTS, type SheetSnap } from "./results-sheet";

describe("nextSnap", () => {
  it("stays put when the drag goes nowhere", () => {
    expect(nextSnap("half", 0, 0)).toBe("half");
  });

  it("opens further on a small upward drag", () => {
    expect(nextSnap("peek", -120, 0)).toBe("half");
  });

  it("closes on a small downward drag", () => {
    expect(nextSnap("half", 120, 0)).toBe("peek");
  });

  // A flick is an intent, not a measurement. Without this, a fast short swipe
  // springs back and the sheet feels stuck to the thumb. It moves one step,
  // like a drag does — jumping straight to full would overshoot the stop most
  // people actually want.
  it("lets a fast flick win over a short distance", () => {
    expect(nextSnap("peek", -20, -2.5)).toBe("half");
    expect(nextSnap("full", 20, 2.5)).toBe("half");
  });

  // A drag has to fully cross a step. Rounding instead of truncating would
  // turn a 60px wobble into a committed move.
  it("returns to where it started when the drag is under one step", () => {
    expect(nextSnap("half", -60, 0)).toBe("half");
    expect(nextSnap("half", 60, 0)).toBe("half");
  });

  it("cannot go past the ends", () => {
    expect(nextSnap("full", -400, -3)).toBe("full");
    expect(nextSnap("peek", 400, 3)).toBe("peek");
  });

  it("crosses two stops on a long drag", () => {
    expect(nextSnap("peek", -400, 0)).toBe("full");
  });

  it("has a height for every snap point", () => {
    for (const snap of ["peek", "half", "full"] as SheetSnap[]) {
      expect(SNAP_HEIGHTS[snap]).toMatch(/^\d+(vh|%)$/);
    }
  });

  // Ordered closed to open, so the sheet cannot be taller when peeking than
  // when full — the kind of thing a careless edit to the constants would do.
  it("orders the heights from smallest to largest", () => {
    const value = (s: SheetSnap) => Number.parseInt(SNAP_HEIGHTS[s], 10);
    expect(value("peek")).toBeLessThan(value("half"));
    expect(value("half")).toBeLessThan(value("full"));
  });
});
