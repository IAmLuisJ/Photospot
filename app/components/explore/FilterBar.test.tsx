import { describe, it, expect } from "vitest";
import { toggleValue, hiddenByFiltersMessage, activeFilterCount } from "./FilterBar";
import { NO_ATTRIBUTE_FILTERS } from "~/domain/filters/attribute-filters";

describe("toggleValue", () => {
  it("adds a value that is not there", () => {
    expect(toggleValue(["free"], "park_pass")).toEqual(["free", "park_pass"]);
  });

  it("removes a value that is", () => {
    expect(toggleValue(["free", "park_pass"], "free")).toEqual(["park_pass"]);
  });

  it("does not mutate the array it was given", () => {
    const before = ["free"];
    toggleValue(before, "park_pass");
    expect(before).toEqual(["free"]);
  });
});

describe("activeFilterCount", () => {
  it("counts each selected value, so the badge matches what is lit up", () => {
    expect(
      activeFilterCount({
        costTypes: ["free", "park_pass"],
        maxWalkMinutes: 10,
        accessibility: ["shade"],
        dogFriendlyOnly: true,
      }),
    ).toBe(5);
  });

  it("is zero when nothing is filtered", () => {
    expect(activeFilterCount(NO_ATTRIBUTE_FILTERS)).toBe(0);
  });

  // Zero minutes is a real filter and a truthiness check would miss it.
  it("counts a zero-minute walk", () => {
    expect(activeFilterCount({ ...NO_ATTRIBUTE_FILTERS, maxWalkMinutes: 0 })).toBe(1);
  });
});

describe("hiddenByFiltersMessage", () => {
  it("says nothing when no spots were hidden", () => {
    expect(hiddenByFiltersMessage(0)).toBeNull();
  });

  it("says nothing for a negative count rather than inventing a sentence", () => {
    expect(hiddenByFiltersMessage(-3)).toBeNull();
  });

  it("explains a single hidden spot in the singular", () => {
    const message = hiddenByFiltersMessage(1)!;
    expect(message).toContain("1 spot ");
    expect(message).not.toContain("1 spots");
    expect(message).toContain(" does not match");
  });

  it("explains several in the plural", () => {
    const message = hiddenByFiltersMessage(4)!;
    expect(message).toContain("4 spots");
    expect(message).toContain(" do not match");
  });

  // The count mixes two causes — a spot that genuinely does not match, and a
  // spot whose data is missing — and the summary rows cannot tell them apart.
  // Asserting the second would be wrong for the first, which is the common
  // case, so the copy must not claim it.
  it("does not assert that the hidden spots are missing data", () => {
    const message = hiddenByFiltersMessage(3)!;
    expect(message).not.toMatch(/hidden because/i);
    expect(message).toMatch(/including any/i);
  });
});
