/**
 * The controlled vocabularies for the array-valued spot attributes.
 *
 * These columns are `text[]` with no vocabulary of their own, so before this
 * existed nothing stopped one contributor writing "wheelchair" and the next
 * writing "Wheelchair accessible" — at which point a filter button matching an
 * exact string silently misses half the map.
 *
 * The values are what gets stored and what the database check constraint
 * enforces; the labels are what people read. Adding an option means adding it
 * here and widening the constraint in a migration — deliberately two steps, so
 * the form and the database cannot drift apart unnoticed.
 */
export interface AttributeOption {
  value: string;
  label: string;
}

export const ACCESSIBILITY_OPTIONS: readonly AttributeOption[] = Object.freeze([
  { value: "wheelchair", label: "Wheelchair accessible" },
  { value: "stroller", label: "Stroller friendly" },
  { value: "restrooms", label: "Restrooms nearby" },
  { value: "seating", label: "Somewhere to sit" },
  { value: "shade", label: "Shade" },
  { value: "paved_path", label: "Paved path" },
]);

export const TERRAIN_OPTIONS: readonly AttributeOption[] = Object.freeze([
  { value: "paved", label: "Paved" },
  { value: "grass", label: "Grass" },
  { value: "gravel", label: "Gravel" },
  { value: "sand", label: "Sand" },
  { value: "water", label: "Water" },
  { value: "wooded", label: "Wooded" },
  { value: "steep", label: "Steep" },
  { value: "stairs", label: "Stairs" },
]);

/** Mirrors the `public.cost_type` enum, in the order the enum declares. */
export const COST_TYPE_OPTIONS: readonly AttributeOption[] = Object.freeze([
  { value: "free", label: "Free" },
  { value: "park_pass", label: "Park pass" },
  { value: "permit_required", label: "Permit required" },
  { value: "hourly_rate", label: "Hourly rate" },
  { value: "negotiated", label: "Negotiated" },
]);

const labelFrom = (options: readonly AttributeOption[], value: string): string =>
  options.find((o) => o.value === value)?.label ?? value;

/**
 * Falls back to the raw value rather than hiding it. Rows written before this
 * vocabulary existed are still real data, and showing "mystery" is honest where
 * showing nothing would quietly lose it.
 */
export const labelForAccessibility = (value: string): string =>
  labelFrom(ACCESSIBILITY_OPTIONS, value);

export const labelForTerrain = (value: string): string => labelFrom(TERRAIN_OPTIONS, value);

export const isAccessibilityValue = (value: string): boolean =>
  ACCESSIBILITY_OPTIONS.some((o) => o.value === value);

export const isTerrainValue = (value: string): boolean =>
  TERRAIN_OPTIONS.some((o) => o.value === value);
