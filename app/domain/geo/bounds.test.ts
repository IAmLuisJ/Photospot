import { describe, it, expect } from "vitest";
import {
  gridStepForZoom,
  snapBoundsToGrid,
  boundsContain,
  type Bounds,
} from "./bounds";

const GR_VIEW: Bounds = {
  west: -85.7267,
  south: 42.9214,
  east: -85.6021,
  north: 42.9891,
};

describe("gridStepForZoom", () => {
  it("shrinks the grid as zoom increases", () => {
    expect(gridStepForZoom(14)).toBeLessThan(gridStepForZoom(10));
  });

  it("is always positive", () => {
    for (const zoom of [0, 5, 10, 18, 22]) {
      expect(gridStepForZoom(zoom)).toBeGreaterThan(0);
    }
  });
});

describe("snapBoundsToGrid", () => {
  it("expands outward so the snapped box always covers the request", () => {
    const snapped = snapBoundsToGrid(GR_VIEW, 12);
    expect(snapped.west).toBeLessThanOrEqual(GR_VIEW.west);
    expect(snapped.south).toBeLessThanOrEqual(GR_VIEW.south);
    expect(snapped.east).toBeGreaterThanOrEqual(GR_VIEW.east);
    expect(snapped.north).toBeGreaterThanOrEqual(GR_VIEW.north);
  });

  it("is idempotent — snapping a snapped box changes nothing", () => {
    const once = snapBoundsToGrid(GR_VIEW, 12);
    const twice = snapBoundsToGrid(once, 12);
    expect(twice).toEqual(once);
  });

  // Integer zoom alone does not prove this: `i * step / step` can come back as
  // i + 1e-13, which ceils to the next cell and grows the box. Zoom 7.7 with
  // this east edge is a concrete case (the quotient returns 648.0000000000001).
  // Map libraries send fractional zoom on every pinch, so this is the common
  // path rather than an edge case, and an unstable snapped box silently defeats
  // the query reuse this function exists to provide.
  it("is idempotent at fractional zoom too", () => {
    const box: Bounds = {
      west: -85.7267,
      south: 42.9214,
      east: 140.235,
      north: 42.9891,
    };
    for (const zoom of [0.5, 3.3, 7.7, 12.4, 18.9]) {
      const once = snapBoundsToGrid(box, zoom);
      expect(snapBoundsToGrid(once, zoom)).toEqual(once);
    }
  });

  it("gives the same box for a small pan, so the query can be reused", () => {
    const step = gridStepForZoom(12);
    // GR_VIEW's west and north edges happen to sit within ~3.7% of a grid
    // line at zoom 12 (verified numerically), so a step/20 (5%) nudge as
    // originally drafted crosses that boundary and defeats the point of
    // this test. step/100 keeps the nudge comfortably inside the same
    // cell on all four edges while still being a nonzero perturbation.
    const nudge = step / 100;
    const nudged: Bounds = {
      west: GR_VIEW.west + nudge,
      south: GR_VIEW.south + nudge,
      east: GR_VIEW.east + nudge,
      north: GR_VIEW.north + nudge,
    };
    expect(snapBoundsToGrid(nudged, 12)).toEqual(snapBoundsToGrid(GR_VIEW, 12));
  });

  it("gives a different box for a large pan", () => {
    const step = gridStepForZoom(12);
    const moved: Bounds = {
      west: GR_VIEW.west + step * 3,
      south: GR_VIEW.south + step * 3,
      east: GR_VIEW.east + step * 3,
      north: GR_VIEW.north + step * 3,
    };
    expect(snapBoundsToGrid(moved, 12)).not.toEqual(snapBoundsToGrid(GR_VIEW, 12));
  });

  // At every INTEGER zoom, 90 / step is exactly 2^(z+1), so ±90 are always grid
  // lines and the clamp never fires — this case would pass with clampLat
  // deleted. It is kept because it documents the invariant; the test below is
  // the one that actually exercises the clamp.
  it("clamps latitude to the valid range", () => {
    const polar: Bounds = { west: -10, south: -89.9, east: 10, north: 89.9 };
    const snapped = snapBoundsToGrid(polar, 3);
    expect(snapped.south).toBeGreaterThanOrEqual(-90);
    expect(snapped.north).toBeLessThanOrEqual(90);
  });

  // Map libraries send fractional zoom during pinch and smooth zoom, and `zoom`
  // is typed `number`, so this is reachable. At z=0.5 the raw ceil lands at
  // 95.46 — an invalid latitude PostGIS would reject — so the clamp is
  // load-bearing here even though it is inert at every integer zoom.
  it("clamps at fractional zoom, where the grid does not align to the poles", () => {
    const polar: Bounds = { west: -10, south: -89.9, east: 10, north: 89.9 };
    const snapped = snapBoundsToGrid(polar, 0.5);
    expect(snapped.north).toBe(90);
    expect(snapped.south).toBe(-90);
  });
});

describe("boundsContain", () => {
  it("accepts a point inside", () => {
    expect(boundsContain(GR_VIEW, { lat: 42.95, lng: -85.65 })).toBe(true);
  });

  it("rejects a point outside", () => {
    expect(boundsContain(GR_VIEW, { lat: 41.0, lng: -85.65 })).toBe(false);
  });
});
