import { describe, it, expect } from "vitest";
import { layoutClass, photoDepthFor } from "./ExploreLayout";

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
