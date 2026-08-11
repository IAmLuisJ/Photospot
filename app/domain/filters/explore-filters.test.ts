import { describe, it, expect } from "vitest";
import {
  parseExploreFilters,
  filtersToSearchParams,
  DEFAULT_FILTERS,
  DEFAULT_VIEWPORT,
  type ExploreFilters,
} from "./explore-filters";

const parse = (qs: string) => parseExploreFilters(new URLSearchParams(qs));

describe("parseExploreFilters", () => {
  it("falls back to Grand Rapids and the split view when the URL is empty", () => {
    expect(parse("")).toEqual(DEFAULT_FILTERS);
    expect(DEFAULT_FILTERS.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(DEFAULT_FILTERS.view).toBe("split");
  });

  it("reads the viewport", () => {
    const f = parse("w=-86&s=42&e=-85&n=43&z=11");
    expect(f.viewport).toEqual({ west: -86, south: 42, east: -85, north: 43 });
    expect(f.zoom).toBe(11);
  });

  it("reads the shoot type and sort", () => {
    const f = parse("type=3&sort=hot");
    expect(f.shootTypeId).toBe(3);
    expect(f.sort).toBe("hot");
  });

  it("reads the view", () => {
    expect(parse("view=gallery").view).toBe("gallery");
    expect(parse("view=map").view).toBe("map");
  });

  // A URL is user-editable and arrives from strangers' links, so every field
  // has to survive nonsense without throwing.
  it("ignores an unknown view", () => {
    expect(parse("view=hologram").view).toBe("split");
  });

  it("ignores an unknown sort", () => {
    expect(parse("sort=vibes").sort).toBe("score");
  });

  it("ignores a non-numeric shoot type", () => {
    expect(parse("type=family").shootTypeId).toBeNull();
  });

  it("ignores a partial viewport rather than building a broken box", () => {
    expect(parse("w=-86&s=42").viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it("ignores an out-of-range viewport", () => {
    expect(parse("w=-200&s=42&e=-85&n=43").viewport).toEqual(DEFAULT_VIEWPORT);
    expect(parse("w=-86&s=-95&e=-85&n=43").viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it("ignores an inverted viewport", () => {
    expect(parse("w=-85&s=43&e=-86&n=42").viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it("clamps the zoom", () => {
    expect(parse("z=99").zoom).toBe(22);
    expect(parse("z=-5").zoom).toBe(0);
  });
});

describe("filtersToSearchParams", () => {
  it("round-trips", () => {
    const filters: ExploreFilters = {
      viewport: { west: -86, south: 42, east: -85, north: 43 },
      zoom: 11,
      shootTypeId: 3,
      sort: "hot",
      view: "gallery",
      attributes: {
        costTypes: ["free"],
        maxWalkMinutes: 10,
        accessibility: ["stroller"],
        dogFriendlyOnly: true,
      },
    };
    expect(parseExploreFilters(filtersToSearchParams(filters))).toEqual(filters);
  });

  // Otherwise every pan writes a URL full of defaults and the share link is
  // unreadable.
  //
  // `view` is the deliberate exception and is always written. Without it,
  // clicking "split" while a cookie remembers "gallery" produces a URL with no
  // view, the loader falls back to the cookie, and the click does nothing.
  it("omits values that match the default, except the view", () => {
    const qs = filtersToSearchParams(DEFAULT_FILTERS).toString();
    expect(qs).toBe("view=split");
  });

  it("writes the view even when it is the default one", () => {
    expect(filtersToSearchParams({ ...DEFAULT_FILTERS, view: "split" }).get("view")).toBe("split");
    expect(filtersToSearchParams({ ...DEFAULT_FILTERS, view: "map" }).get("view")).toBe("map");
  });

  it("carries the attribute filters", () => {
    const qs = filtersToSearchParams({
      ...DEFAULT_FILTERS,
      attributes: {
        costTypes: ["free", "park_pass"],
        maxWalkMinutes: 5,
        accessibility: ["shade"],
        dogFriendlyOnly: true,
      },
    }).toString();
    expect(qs).toContain("cost=free%2Cpark_pass");
    expect(qs).toContain("walk=5");
    expect(qs).toContain("access=shade");
    expect(qs).toContain("dogs=1");
  });

  it("keeps the viewport when it differs from the default", () => {
    const qs = filtersToSearchParams({
      ...DEFAULT_FILTERS,
      viewport: { west: -86, south: 42, east: -85, north: 43 },
    }).toString();
    expect(qs).toContain("w=-86");
    expect(qs).toContain("n=43");
  });

  it("rounds coordinates so a share link is not 60 characters of float noise", () => {
    const qs = filtersToSearchParams({
      ...DEFAULT_FILTERS,
      viewport: {
        west: -85.72671234567,
        south: 42.92141234567,
        east: -85.60211234567,
        north: 42.98911234567,
      },
    }).toString();
    expect(qs).toContain("w=-85.72671");
    expect(qs).not.toContain("1234567");
  });
});
