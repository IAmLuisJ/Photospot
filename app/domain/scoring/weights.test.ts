import { describe, it, expect } from "vitest";
import { DEFAULT_WEIGHTS } from "./weights";

describe("DEFAULT_WEIGHTS", () => {
  it("matches the weights agreed in the spec", () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      shootTypeUpvote: 1.0,
      shootAgainYes: 2.0,
      shootAgainNo: -1.5,
      comment: 0.5,
      scoutingPhoto: 1.0,
      sessionPhoto: 1.5,
    });
  });

  it("never rewards a shoot-again no more than a yes", () => {
    expect(DEFAULT_WEIGHTS.shootAgainNo).toBeLessThan(DEFAULT_WEIGHTS.shootAgainYes);
  });
});
