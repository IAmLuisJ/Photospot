import { describe, it, expect } from "vitest";
import {
  parseAttributeFilters,
  attributeFiltersToParams,
  hasAnyAttributeFilter,
  NO_ATTRIBUTE_FILTERS,
  type AttributeFilters,
} from "./attribute-filters";

const parse = (qs: string) => parseAttributeFilters(new URLSearchParams(qs));

describe("parseAttributeFilters", () => {
  it("is empty for an empty URL", () => {
    expect(parse("")).toEqual(NO_ATTRIBUTE_FILTERS);
  });

  it("reads a comma-separated cost list", () => {
    expect(parse("cost=free,park_pass").costTypes).toEqual(["free", "park_pass"]);
  });

  it("reads a maximum walk time", () => {
    expect(parse("walk=10").maxWalkMinutes).toBe(10);
  });

  it("reads accessibility requirements", () => {
    expect(parse("access=wheelchair,restrooms").accessibility).toEqual([
      "wheelchair",
      "restrooms",
    ]);
  });

  it("reads the dogs flag", () => {
    expect(parse("dogs=1").dogFriendlyOnly).toBe(true);
    expect(parse("").dogFriendlyOnly).toBe(false);
  });

  // Only "1" means on. Someone hand-editing a shared link to `dogs=0`
  // expecting to switch it off must not switch it on instead.
  it("treats any dogs value other than 1 as off", () => {
    expect(parse("dogs=0").dogFriendlyOnly).toBe(false);
    expect(parse("dogs=").dogFriendlyOnly).toBe(false);
    expect(parse("dogs=true").dogFriendlyOnly).toBe(false);
  });

  // Search params arrive from other people's links and from hand editing, so
  // every field falls back rather than throwing — a bad URL shows an
  // unfiltered map, not an error page. Dropping also matters for correctness:
  // querying for a value no row can hold looks identical to "no results".
  it("drops values outside the vocabulary instead of querying for them", () => {
    expect(parse("access=wheelchair,teleporter").accessibility).toEqual(["wheelchair"]);
    expect(parse("cost=free,gold_bars").costTypes).toEqual(["free"]);
  });

  it("ignores a walk time that is not a non-negative integer", () => {
    expect(parse("walk=soon").maxWalkMinutes).toBeNull();
    expect(parse("walk=-5").maxWalkMinutes).toBeNull();
    expect(parse("walk=1.5").maxWalkMinutes).toBeNull();
  });

  // Zero is a real filter — you park at the spot — and must survive parsing.
  it("keeps a zero walk time", () => {
    expect(parse("walk=0").maxWalkMinutes).toBe(0);
  });

  it("ignores empty entries rather than filtering on the empty string", () => {
    expect(parse("access=,,wheelchair,").accessibility).toEqual(["wheelchair"]);
    expect(parse("access=").accessibility).toEqual([]);
  });
});

describe("attributeFiltersToParams", () => {
  const filters = (over: Partial<AttributeFilters> = {}): AttributeFilters => ({
    ...NO_ATTRIBUTE_FILTERS,
    ...over,
  });

  it("writes nothing when nothing is filtered", () => {
    expect(attributeFiltersToParams(filters()).toString()).toBe("");
  });

  it("round-trips", () => {
    const f = filters({
      costTypes: ["free"],
      maxWalkMinutes: 12,
      accessibility: ["stroller", "shade"],
      dogFriendlyOnly: true,
    });
    expect(parseAttributeFilters(attributeFiltersToParams(f))).toEqual(f);
  });

  // Zero would be dropped by a truthiness check on the way out, too.
  it("round-trips a zero walk time", () => {
    const f = filters({ maxWalkMinutes: 0 });
    expect(parseAttributeFilters(attributeFiltersToParams(f))).toEqual(f);
  });

  it("omits the dogs flag when it is off, so a share link stays short", () => {
    expect(attributeFiltersToParams(filters({ dogFriendlyOnly: false })).has("dogs")).toBe(false);
  });
});

describe("hasAnyAttributeFilter", () => {
  it("is false for the empty set", () => {
    expect(hasAnyAttributeFilter(NO_ATTRIBUTE_FILTERS)).toBe(false);
  });

  // Each field separately: an `||` chain that forgets one reads as working
  // until someone filters by only that field.
  it("is true for any single filter", () => {
    expect(hasAnyAttributeFilter({ ...NO_ATTRIBUTE_FILTERS, costTypes: ["free"] })).toBe(true);
    expect(hasAnyAttributeFilter({ ...NO_ATTRIBUTE_FILTERS, maxWalkMinutes: 5 })).toBe(true);
    expect(hasAnyAttributeFilter({ ...NO_ATTRIBUTE_FILTERS, accessibility: ["shade"] })).toBe(true);
    expect(hasAnyAttributeFilter({ ...NO_ATTRIBUTE_FILTERS, dogFriendlyOnly: true })).toBe(true);
  });

  // Zero is a real filter and would be dropped by a truthiness check.
  it("treats a zero-minute walk as a filter", () => {
    expect(hasAnyAttributeFilter({ ...NO_ATTRIBUTE_FILTERS, maxWalkMinutes: 0 })).toBe(true);
  });
});
