import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  isPotentialDuplicate,
  DUPLICATE_RADIUS_METERS,
  type LatLng,
} from "./distance";

// Two real Grand Rapids landmarks, roughly 5 km apart.
const MILLENNIUM_PARK: LatLng = { lat: 42.9214, lng: -85.7267 };
const JOHN_BALL_PARK: LatLng = { lat: 42.9631, lng: -85.7011 };

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters(MILLENNIUM_PARK, MILLENNIUM_PARK)).toBe(0);
  });

  it("is symmetric", () => {
    const a = haversineMeters(MILLENNIUM_PARK, JOHN_BALL_PARK);
    const b = haversineMeters(JOHN_BALL_PARK, MILLENNIUM_PARK);
    expect(a).toBeCloseTo(b, 6);
  });

  it("measures one degree of latitude as about 111 km", () => {
    const result = haversineMeters({ lat: 42, lng: -85 }, { lat: 43, lng: -85 });
    expect(result).toBeGreaterThan(110_000);
    expect(result).toBeLessThan(112_000);
  });

  it("measures a known short distance within tolerance", () => {
    const result = haversineMeters(MILLENNIUM_PARK, JOHN_BALL_PARK);
    expect(result).toBeGreaterThan(4_000);
    expect(result).toBeLessThan(6_000);
  });
});

describe("isPotentialDuplicate", () => {
  const base: LatLng = { lat: 42.9214, lng: -85.7267 };
  // ~100 m north of base: 0.0009 degrees of latitude.
  const near: LatLng = { lat: 42.9223, lng: -85.7267 };

  it("flags two pins within the radius", () => {
    expect(isPotentialDuplicate(base, near)).toBe(true);
  });

  it("does not flag pins beyond the radius", () => {
    expect(isPotentialDuplicate(base, JOHN_BALL_PARK)).toBe(false);
  });

  it("uses a 200 metre default radius", () => {
    expect(DUPLICATE_RADIUS_METERS).toBe(200);
  });

  it("honours an overridden radius", () => {
    expect(isPotentialDuplicate(base, near, 50)).toBe(false);
  });
});
