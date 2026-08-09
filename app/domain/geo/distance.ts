export interface LatLng {
  lat: number;
  lng: number;
}

/** Spec §9.1. Configurable; this is the MVP default. */
export const DUPLICATE_RADIUS_METERS = 200;

const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance. Used for client-side duplicate hinting; the
 * authoritative check is PostGIS ST_DWithin on the server.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isPotentialDuplicate(
  a: LatLng,
  b: LatLng,
  radiusMeters: number = DUPLICATE_RADIUS_METERS,
): boolean {
  return haversineMeters(a, b) <= radiusMeters;
}
