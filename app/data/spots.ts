import type { SupabaseClient } from "@supabase/supabase-js";
import type { LatLng } from "../domain/geo/distance";
import type { ExploreFilters } from "../domain/filters/explore-filters";

export type SpotKind = "outdoor" | "studio";

/** A spot as the map and result list need it. */
export interface SpotSummary {
  id: string;
  name: string;
  slug: string;
  kind: SpotKind;
  position: LatLng;
  locality: string | null;
  region: string | null;
  score: number;
  hotScore: number;
  commentCount: number;
  photoCount: number;
  coverPhotoPath: string | null;
  coverCreditName: string | null;
}

/** Everything the detail page shows. */
export interface SpotDetail extends SpotSummary {
  description: string | null;
  shootTypeUpvoteCount: number;
  shootAgainYesCount: number;
  shootAgainNoCount: number;
  costType: string | null;
  costNotes: string | null;
  permitUrl: string | null;
  hoursNotes: string | null;
  bestLight: string[] | null;
  bestSeasons: string[] | null;
  walkMinutes: number | null;
  parkingNotes: string | null;
  terrain: string[] | null;
  accessibility: string[] | null;
  maxGroupSize: number | null;
  dogFriendly: boolean | null;
}

/**
 * PostgREST sends `numeric` as a string to avoid precision loss in JSON, so
 * every score would otherwise sort and render as text.
 */
const toNumber = (value: unknown): number => Number(value ?? 0);

interface ViewportRow {
  id: string;
  name: string;
  slug: string;
  kind: SpotKind;
  lat: number;
  lng: number;
  locality: string | null;
  region: string | null;
  score: string | number;
  hot_score: string | number;
  comment_count: number;
  scouting_photo_count: number;
  session_photo_count: number;
  cover_photo_path: string | null;
  cover_credit_name: string | null;
}

const toSummary = (row: ViewportRow): SpotSummary => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  kind: row.kind,
  position: { lat: row.lat, lng: row.lng },
  locality: row.locality,
  region: row.region,
  score: toNumber(row.score),
  hotScore: toNumber(row.hot_score),
  commentCount: row.comment_count,
  photoCount: row.scouting_photo_count + row.session_photo_count,
  coverPhotoPath: row.cover_photo_path,
  coverCreditName: row.cover_credit_name,
});

export async function listSpotsInViewport(
  supabase: SupabaseClient,
  filters: ExploreFilters,
  limit = 200,
): Promise<SpotSummary[]> {
  const { viewport, shootTypeId, sort, attributes } = filters;
  const { data, error } = await supabase.rpc("spots_in_viewport", {
    p_west: viewport.west,
    p_south: viewport.south,
    p_east: viewport.east,
    p_north: viewport.north,
    p_shoot_type_id: shootTypeId,
    p_sort: sort,
    p_limit: limit,
    p_cost_types: attributes.costTypes,
    p_max_walk_minutes: attributes.maxWalkMinutes,
    p_accessibility: attributes.accessibility,
    // `? true : null`, not the boolean itself: false would read as "show me
    // spots that ban dogs", which nobody asked for and the UI cannot express.
    p_dog_friendly: attributes.dogFriendlyOnly ? true : null,
  });

  if (error) throw error;
  return ((data ?? []) as ViewportRow[]).map(toSummary);
}

interface DetailRow extends ViewportRow {
  description: string | null;
  shoot_type_upvote_count: number;
  shoot_again_yes_count: number;
  shoot_again_no_count: number;
  cost_type: string | null;
  cost_notes: string | null;
  permit_url: string | null;
  hours_notes: string | null;
  best_light: string[] | null;
  best_seasons: string[] | null;
  walk_minutes: number | null;
  parking_notes: string | null;
  terrain: string[] | null;
  accessibility: string[] | null;
  max_group_size: number | null;
  dog_friendly: boolean | null;
}

export async function getSpotBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<SpotDetail | null> {
  const { data, error } = await supabase.rpc("spot_by_slug", { p_slug: slug });
  if (error) throw error;

  const rows = (data ?? []) as DetailRow[];
  if (rows.length === 0) return null;
  const row = rows[0];

  return {
    // spot_by_slug does not project a cover photo; the detail page loads the
    // full photo set separately in plan 3.
    ...toSummary({ ...row, cover_photo_path: null, cover_credit_name: null }),
    description: row.description,
    shootTypeUpvoteCount: row.shoot_type_upvote_count,
    shootAgainYesCount: row.shoot_again_yes_count,
    shootAgainNoCount: row.shoot_again_no_count,
    costType: row.cost_type,
    costNotes: row.cost_notes,
    permitUrl: row.permit_url,
    hoursNotes: row.hours_notes,
    bestLight: row.best_light,
    bestSeasons: row.best_seasons,
    walkMinutes: row.walk_minutes,
    parkingNotes: row.parking_notes,
    terrain: row.terrain,
    accessibility: row.accessibility,
    maxGroupSize: row.max_group_size,
    dogFriendly: row.dog_friendly,
  };
}

export interface SpotPhoto {
  id: string;
  storagePath: string;
  kind: "scouting" | "session";
  caption: string | null;
  creditName: string | null;
  creditUrl: string | null;
}

export interface SpotGalleryLink {
  id: string;
  url: string;
  title: string;
}

export interface SpotMedia {
  photos: SpotPhoto[];
  galleryLinks: SpotGalleryLink[];
}

/**
 * `status = 'published'` is written explicitly even though RLS enforces it —
 * the RLS predicate is a disjunction and would leave a partial index unused.
 */
export async function getSpotMedia(
  supabase: SupabaseClient,
  spotId: string,
): Promise<SpotMedia> {
  const [photos, links] = await Promise.all([
    supabase
      .from("photos")
      .select("id, storage_path, kind, caption, credit_name, credit_url")
      .eq("spot_id", spotId)
      .eq("status", "published")
      .order("kind", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("spot_gallery_links")
      .select("id, url, title")
      .eq("spot_id", spotId)
      .order("created_at", { ascending: true }),
  ]);

  if (photos.error) throw photos.error;
  if (links.error) throw links.error;

  return {
    photos: (photos.data ?? []).map((p) => ({
      id: p.id as string,
      storagePath: p.storage_path as string,
      kind: p.kind as "scouting" | "session",
      caption: p.caption as string | null,
      creditName: p.credit_name as string | null,
      creditUrl: p.credit_url as string | null,
    })),
    galleryLinks: (links.data ?? []).map((l) => ({
      id: l.id as string,
      url: l.url as string,
      title: l.title as string,
    })),
  };
}
