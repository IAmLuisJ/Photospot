import { describe, it, expect } from "vitest";
import { markersFor, boundsFromMap, type MapLike } from "./SpotMap";
import type { SpotSummary } from "~/data/spots";

const spot = (over: Partial<SpotSummary> = {}): SpotSummary => ({
  id: "1",
  name: "A Spot",
  slug: "a-spot",
  kind: "outdoor",
  position: { lat: 42.95, lng: -85.68 },
  locality: "Grand Rapids",
  region: "MI",
  score: 3,
  hotScore: 1,
  commentCount: 0,
  photoCount: 2,
  coverPhotoPath: null,
  coverCreditName: null,
  ...over,
});

describe("markersFor", () => {
  it("gives one marker per spot", () => {
    expect(markersFor([spot({ id: "1" }), spot({ id: "2", slug: "b" })])).toHaveLength(2);
  });

  it("carries the slug so a click can navigate", () => {
    expect(markersFor([spot()])[0].slug).toBe("a-spot");
  });

  it("distinguishes studios from outdoor spots", () => {
    const [outdoor] = markersFor([spot({ kind: "outdoor" })]);
    const [studio] = markersFor([spot({ kind: "studio" })]);
    expect(outdoor.className).not.toBe(studio.className);
  });

  it("marks the selected spot so the map and list stay in sync", () => {
    const [m] = markersFor([spot({ slug: "a-spot" })], "a-spot");
    expect(m.selected).toBe(true);
  });

  it("returns nothing for no spots", () => {
    expect(markersFor([])).toEqual([]);
  });
});

describe("boundsFromMap", () => {
  const map: MapLike = {
    getBounds: () => ({ getWest: () => -86, getSouth: () => 42, getEast: () => -85, getNorth: () => 43 }),
    getZoom: () => 11.7,
  };

  it("reads the viewport in the app's Bounds shape", () => {
    expect(boundsFromMap(map).viewport).toEqual({ west: -86, south: 42, east: -85, north: 43 });
  });

  // Map libraries report fractional zoom during pinch. snapBoundsToGrid handles
  // that correctly, but the URL should carry a tidy integer.
  it("rounds the zoom", () => {
    expect(boundsFromMap(map).zoom).toBe(12);
  });
});
