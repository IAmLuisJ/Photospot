import type { LatLng } from "../geo/distance";
import { isAccessibilityValue, isTerrainValue } from "./attributes";

/** Spec §4.2. The database enforces the same number in a trigger. */
export const MAX_PHOTOS_PER_KIND = 6;

const MAX_NAME_LENGTH = 120;

export type PhotoKind = "scouting" | "session";

export interface PhotoInput {
  storagePath: string;
  kind: PhotoKind;
  rightsAttested: boolean;
  creditName: string | null;
  creditUrl: string | null;
  caption: string | null;
}

export interface SubmissionInput {
  name: string;
  kind: "outdoor" | "studio";
  position: LatLng;
  description: string | null;
  locality: string | null;
  region: string | null;
  shootTypeIds: number[];
  photos: PhotoInput[];
  /** All optional (spec §4.7); absent and null both mean "nobody said". */
  costType?: string | null;
  walkMinutes?: number | null;
  accessibility?: string[];
  terrain?: string[];
  dogFriendly?: boolean | null;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationResult {
  errors: FieldError[];
}

/**
 * Collects every problem rather than stopping at the first, so the form can
 * show them all at once instead of making the user resubmit repeatedly.
 *
 * This duplicates rules the database also enforces. That is deliberate: the
 * database is the authority, but a user should be told what is wrong before
 * uploading photos, not after.
 */
export function validateSubmission(input: SubmissionInput): ValidationResult {
  const errors: FieldError[] = [];

  if (input.name.trim().length === 0) {
    errors.push({ field: "name", message: "Give the spot a name." });
  } else if (input.name.trim().length > MAX_NAME_LENGTH) {
    errors.push({ field: "name", message: `Keep the name under ${MAX_NAME_LENGTH} characters.` });
  }

  const { lat, lng } = input.position;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    errors.push({ field: "position", message: "Drop the pin on the map." });
  }

  if (input.shootTypeIds.length === 0) {
    errors.push({ field: "shootTypeIds", message: "Pick at least one kind of shoot." });
  }

  if (input.photos.length === 0) {
    errors.push({ field: "photos", message: "Add at least one photo." });
  }

  const unattested = input.photos.filter((p) => p.kind === "session" && !p.rightsAttested);
  if (unattested.length > 0) {
    errors.push({
      field: "photos",
      message: "Confirm you shot each session photo and have the right to post it.",
    });
  }

  for (const kind of ["scouting", "session"] as const) {
    if (input.photos.filter((p) => p.kind === kind).length > MAX_PHOTOS_PER_KIND) {
      errors.push({
        field: "photos",
        message: `At most ${MAX_PHOTOS_PER_KIND} ${kind} photos. Link a full gallery instead.`,
      });
    }
  }

  // The check constraints are the authority; these exist so the user is told
  // which value is wrong instead of seeing a 23514 that names the whole array.
  for (const value of input.accessibility ?? []) {
    if (!isAccessibilityValue(value)) {
      errors.push({ field: "accessibility", message: `"${value}" is not an option.` });
    }
  }
  for (const value of input.terrain ?? []) {
    if (!isTerrainValue(value)) {
      errors.push({ field: "terrain", message: `"${value}" is not an option.` });
    }
  }

  // `!= null` covers both undefined and null in one check; zero is a real
  // answer — you park at the spot — and must not be swept up as missing.
  if (input.walkMinutes != null && input.walkMinutes < 0) {
    errors.push({ field: "walkMinutes", message: "Walk time cannot be negative." });
  }

  return { errors };
}
