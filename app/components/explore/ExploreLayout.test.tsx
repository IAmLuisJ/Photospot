import { describe, it, expect } from "vitest";
import { layoutClass, photoDepthFor, showsMap, showsResults } from "./ExploreLayout";

describe("layoutClass", () => {
  it("gives each view its own class", () => {
    const classes = [layoutClass("split"), layoutClass("map"), layoutClass("gallery")];
    expect(new Set(classes).size).toBe(3);
  });

  it("names the view in the class so CSS can target it", () => {
    expect(layoutClass("gallery")).toContain("gallery");
  });
});

describe("photoDepthFor", () => {
  // Gallery shows large images; split shows one thumbnail per row. Fetching the
  // same depth for both either starves the gallery or over-fetches the split.
  it("asks for more results in gallery than in split", () => {
    expect(photoDepthFor("gallery")).toBeGreaterThan(photoDepthFor("split"));
  });

  it("asks for the most in map view, where pins are cheap", () => {
    expect(photoDepthFor("map")).toBeGreaterThanOrEqual(photoDepthFor("split"));
  });

  it("never asks for more than the RPC will return", () => {
    for (const view of ["split", "map", "gallery"] as const) {
      expect(photoDepthFor(view)).toBeLessThanOrEqual(500);
    }
  });
});

describe("showsMap / showsResults", () => {
  // Gallery is the only view with a tab pair (spec §8: "a photo grid with the
  // map behind a tab"); split and map always show both panes.
  it("shows the map in split and map view regardless of the tab", () => {
    for (const tab of ["photos", "map"] as const) {
      expect(showsMap("split", tab)).toBe(true);
      expect(showsMap("map", tab)).toBe(true);
    }
  });

  it("shows the gallery map only on its map tab", () => {
    expect(showsMap("gallery", "photos")).toBe(false);
    expect(showsMap("gallery", "map")).toBe(true);
  });

  it("shows the gallery grid only on its photos tab", () => {
    expect(showsResults("gallery", "photos")).toBe(true);
    expect(showsResults("gallery", "map")).toBe(false);
  });

  // Never both hidden: whatever the tab, gallery shows one pane or the other.
  it("always shows exactly one gallery pane", () => {
    for (const tab of ["photos", "map"] as const) {
      expect(showsMap("gallery", tab) !== showsResults("gallery", tab)).toBe(true);
    }
  });
});
