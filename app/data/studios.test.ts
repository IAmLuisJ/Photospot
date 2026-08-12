import { describe, it, expect } from "vitest";
import { hourlyRateLabel } from "./studios";

describe("hourlyRateLabel", () => {
  it("renders a whole number of dollars without decimals", () => {
    expect(hourlyRateLabel(12000)).toBe("$120/hour");
  });

  it("keeps the cents when there are any", () => {
    expect(hourlyRateLabel(12550)).toBe("$125.50/hour");
  });

  // Null is "no rate recorded", which the page omits rather than showing as
  // free — a studio with no rate is not a studio that costs nothing.
  it("returns null when no rate is recorded", () => {
    expect(hourlyRateLabel(null)).toBeNull();
  });

  // Zero is a real rate, and a truthiness check would drop it.
  it("renders a zero rate rather than treating it as missing", () => {
    expect(hourlyRateLabel(0)).toBe("$0/hour");
  });
});
