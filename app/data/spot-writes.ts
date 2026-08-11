import type { SupabaseClient } from "@supabase/supabase-js";
import type { LatLng } from "../domain/geo/distance";
import { DUPLICATE_RADIUS_METERS } from "../domain/geo/distance";
import { slugCandidates } from "../domain/spots/slug";
import type { SubmissionInput } from "../domain/spots/submission";
import type { SpotKind } from "./spots";

export interface NearbySpot {
  id: string;
  name: string;
  slug: string;
  kind: SpotKind;
  locality: string | null;
  region: string | null;
  distanceMeters: number;
}

interface NearbyRow {
  id: string;
  name: string;
  slug: string;
  kind: SpotKind;
  locality: string | null;
  region: string | null;
  distance_meters: number;
}

/**
 * Spec §9.1: run before the form, not after. Catching a duplicate up front
 * turns a rejection into a contribution, because the user can be sent to the
 * existing spot instead.
 */
export async function findNearbyDuplicates(
  supabase: SupabaseClient,
  position: LatLng,
  kind: SpotKind,
  radiusMeters: number = DUPLICATE_RADIUS_METERS,
): Promise<NearbySpot[]> {
  const { data, error } = await supabase.rpc("spots_within_meters", {
    p_lng: position.lng,
    p_lat: position.lat,
    p_meters: radiusMeters,
    p_kind: kind,
  });
  if (error) throw error;

  return ((data ?? []) as NearbyRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    locality: row.locality,
    region: row.region,
    distanceMeters: row.distance_meters,
  }));
}

/**
 * First free candidate from `slugCandidates`.
 *
 * The last candidate always carries a random discriminator, so this cannot run
 * out — but the insert is still the authority, since another submission could
 * take the slug between this check and the write.
 */
export async function resolveSlug(
  supabase: SupabaseClient,
  name: string,
  locality: string | null,
  region: string | null,
): Promise<string> {
  for (const candidate of slugCandidates(name, locality, region)) {
    const { data, error } = await supabase.rpc("slug_exists", { p_slug: candidate });
    if (error) throw error;
    if (!data) return candidate;
  }
  // Unreachable: the final candidate is randomised. Belt and braces.
  return `${slugCandidates(name, locality, region)[0]}-${crypto.randomUUID().slice(0, 8)}`;
}

/** One transaction for the spot, its shoot types and its photos (spec §10). */
export async function createSpot(
  supabase: SupabaseClient,
  input: SubmissionInput,
  slug: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_spot", {
    p_name: input.name.trim(),
    p_kind: input.kind,
    p_lng: input.position.lng,
    p_lat: input.position.lat,
    p_slug: slug,
    p_description: input.description ?? "",
    p_locality: input.locality ?? "",
    p_region: input.region ?? "",
    p_shoot_type_ids: input.shootTypeIds,
    p_photos: input.photos.map((p) => ({
      storage_path: p.storagePath,
      kind: p.kind,
      rights_attested: p.rightsAttested,
      credit_name: p.creditName ?? "",
      credit_url: p.creditUrl ?? "",
      caption: p.caption ?? "",
    })),
    // `?? null` rather than `?? ""` for the arrays and the boolean: the RPC
    // stores these as given, and null is "nobody said" where an empty array is
    // "none of these apply". cost_type keeps the empty-string idiom the other
    // text arguments use, because the RPC nullifs it before the enum cast.
    p_cost_type: input.costType ?? "",
    p_walk_minutes: input.walkMinutes ?? null,
    p_accessibility: input.accessibility ?? null,
    p_terrain: input.terrain ?? null,
    p_dog_friendly: input.dogFriendly ?? null,
  });

  if (error) throw error;
  return data as string;
}

export async function addGalleryLink(
  supabase: SupabaseClient,
  spotId: string,
  url: string,
  title: string,
): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Must be signed in to add a gallery link.");

  const { error } = await supabase.from("spot_gallery_links").insert({
    spot_id: spotId,
    profile_id: user.user.id,
    url,
    title,
  });
  if (error) throw error;
}

/**
 * Editing is column-scoped by the grants in migration 5; `status`, `score` and
 * the counters are not writable here and attempting one is a 42501.
 *
 * Every field is optional and the `!== undefined` guard is what separates "not
 * on this form" from "cleared to null". That distinction is why the edit action
 * sends every attribute explicitly rather than only the non-empty ones —
 * without it an attribute could be set but never removed.
 *
 * Returns whether a row actually changed. RLS decides who may edit, and a
 * non-owner's update matches **zero rows without erroring** — so `error` being
 * null does not mean anything was saved. Without this the edit form redirects
 * to the spot page as though it worked and silently discards everything the
 * user typed. `.select("id")` is what turns that into an answer.
 */
export async function updateSpot(
  supabase: SupabaseClient,
  spotId: string,
  fields: {
    name?: string;
    description?: string | null;
    locality?: string | null;
    region?: string | null;
    walkMinutes?: number | null;
    parkingNotes?: string | null;
    costType?: string | null;
    accessibility?: string[] | null;
    terrain?: string[] | null;
    dogFriendly?: boolean | null;
  },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("spots")
    .update({
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.description !== undefined ? { description: fields.description } : {}),
      ...(fields.locality !== undefined ? { locality: fields.locality } : {}),
      ...(fields.region !== undefined ? { region: fields.region } : {}),
      ...(fields.walkMinutes !== undefined ? { walk_minutes: fields.walkMinutes } : {}),
      ...(fields.parkingNotes !== undefined ? { parking_notes: fields.parkingNotes } : {}),
      ...(fields.costType !== undefined ? { cost_type: fields.costType } : {}),
      ...(fields.accessibility !== undefined ? { accessibility: fields.accessibility } : {}),
      ...(fields.terrain !== undefined ? { terrain: fields.terrain } : {}),
      ...(fields.dogFriendly !== undefined ? { dog_friendly: fields.dogFriendly } : {}),
    })
    .eq("id", spotId)
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}
