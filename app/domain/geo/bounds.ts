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

/** Always expands outward, so the snapped box is a superset of the request. */
export function snapBoundsToGrid(bounds: Bounds, zoom: number): Bounds {
  const step = gridStepForZoom(zoom);
  return {
    west: Math.floor(bounds.west / step) * step,
    south: clampLat(Math.floor(bounds.south / step) * step),
    east: Math.ceil(bounds.east / step) * step,
    north: clampLat(Math.ceil(bounds.north / step) * step),
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
