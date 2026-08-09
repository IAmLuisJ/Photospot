import type { LatLng } from "./distance";

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Grid cell size in degrees for a zoom level, about an eighth of the
 * visible span. Coarse enough that nudging the map reuses a query,
 * fine enough that the over-fetch stays small.
 *
 * Antimeridian crossing is not handled: the product is US-only (spec §2).
 */
export function gridStepForZoom(zoom: number): number {
  return 360 / Math.pow(2, zoom) / 8;
}

const clampLat = (value: number): number => Math.min(90, Math.max(-90, value));

/**
 * `i * step / step` does not always give back exactly `i`. At zoom 7.7 a
 * snapped east edge divides back to 648.0000000000001, so a second snap ceils
 * it to 649 and the box grows — snapping stops being idempotent for ~18% of
 * fractional zooms, and map libraries send fractional zoom whenever the user
 * pinches or scroll-zooms.
 *
 * That matters because the whole point of snapping is a stable query key: an
 * unstable one silently defeats the reuse this function exists to provide.
 * So pull a quotient that is within a few ULPs of an integer back onto it.
 * The correction is ~1e-13 of a cell — far below any distance that can matter.
 */
const GRID_TOLERANCE_ULPS = 8;

const gridQuotient = (value: number, step: number): number => {
  const quotient = value / step;
  const nearest = Math.round(quotient);
  const tolerance =
    Math.max(Math.abs(quotient), 1) * GRID_TOLERANCE_ULPS * Number.EPSILON;
  return Math.abs(quotient - nearest) <= tolerance ? nearest : quotient;
};

/** Always expands outward, so the snapped box is a superset of the request. */
export function snapBoundsToGrid(bounds: Bounds, zoom: number): Bounds {
  const step = gridStepForZoom(zoom);
  return {
    west: Math.floor(gridQuotient(bounds.west, step)) * step,
    south: clampLat(Math.floor(gridQuotient(bounds.south, step)) * step),
    east: Math.ceil(gridQuotient(bounds.east, step)) * step,
    north: clampLat(Math.ceil(gridQuotient(bounds.north, step)) * step),
  };
}

export function boundsContain(bounds: Bounds, point: LatLng): boolean {
  return (
    point.lng >= bounds.west &&
    point.lng <= bounds.east &&
    point.lat >= bounds.south &&
    point.lat <= bounds.north
  );
}
