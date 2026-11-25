import type { DataContext } from "./context";
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
  /** Both null once the account is deleted (spec §4.6a). */
  createdBy: string | null;
  ownerProfileId: string | null;
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
  context: DataContext,
  filters: ExploreFilters,
  limit = 200,
): Promise<SpotSummary[]> {
  const { viewport: v, shootTypeId, sort, attributes: a } = filters;
  const conditions = [
    "s.status = 'published'",
    "s.lat BETWEEN ? AND ?",
    "s.lng BETWEEN ? AND ?",
  ];
  const args: (string | number)[] = [v.south, v.north, v.west, v.east];
  if (shootTypeId !== null) {
    conditions.push(
      "EXISTS(SELECT 1 FROM spot_shoot_types st WHERE st.spot_id=s.id AND st.shoot_type_id=?)",
    );
    args.push(shootTypeId);
  }
  if (a.costTypes.length) {
    conditions.push("s.cost_type IN (SELECT value FROM json_each(?))");
    args.push(JSON.stringify(a.costTypes));
  }
  if (a.maxWalkMinutes !== null) {
    conditions.push("s.walk_minutes <= ?");
    args.push(a.maxWalkMinutes);
  }
  if (a.accessibility.length) {
    conditions.push(
      "s.accessibility IS NOT NULL AND NOT EXISTS(SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS(SELECT 1 FROM json_each(s.accessibility) actual WHERE actual.value=wanted.value))",
    );
    args.push(JSON.stringify(a.accessibility));
  }
  if (a.dogFriendlyOnly) conditions.push("s.dog_friendly = 1");
  const order = sort === "hot" ? "hot_score" : "score";
  const { results } = await context.db
    .prepare(
      `SELECT s.*, p.storage_path AS cover_photo_path, p.credit_name AS cover_credit_name
    FROM spots s LEFT JOIN photos p ON p.id=(SELECT id FROM photos WHERE spot_id=s.id AND status='published'
      ORDER BY (kind='session') DESC, created_at, id LIMIT 1)
    WHERE ${conditions.join(" AND ")} ORDER BY s.${order} DESC,s.id LIMIT ?`,
    )
    .bind(...args, Math.min(500, Math.max(1, Math.trunc(limit))))
    .all<ViewportRow>();
  return results.map(toSummary);
}

interface DetailRow extends ViewportRow {
  description: string | null;
  created_by: string | null;
  owner_profile_id: string | null;
  shoot_type_upvote_count: number;
  shoot_again_yes_count: number;
  shoot_again_no_count: number;
  cost_type: string | null;
  cost_notes: string | null;
  permit_url: string | null;
  hours_notes: string | null;
  best_light: string | null;
  best_seasons: string | null;
  walk_minutes: number | null;
  parking_notes: string | null;
  terrain: string | null;
  accessibility: string | null;
  max_group_size: number | null;
  dog_friendly: number | null;
}

export async function getSpotBySlug(
  context: DataContext,
  slug: string,
): Promise<SpotDetail | null> {
  const row = await context.db
    .prepare("SELECT * FROM spots WHERE slug=? AND status='published'")
    .bind(slug)
    .first<DetailRow>();
  if (!row) return null;

  return {
    // spot_by_slug does not project a cover photo; the detail page loads the
    // full photo set separately in plan 3.
    ...toSummary({ ...row, cover_photo_path: null, cover_credit_name: null }),
    description: row.description,
    createdBy: row.created_by,
    ownerProfileId: row.owner_profile_id,
    shootTypeUpvoteCount: row.shoot_type_upvote_count,
    shootAgainYesCount: row.shoot_again_yes_count,
    shootAgainNoCount: row.shoot_again_no_count,
    costType: row.cost_type,
    costNotes: row.cost_notes,
    permitUrl: row.permit_url,
    hoursNotes: row.hours_notes,
    bestLight: row.best_light === null ? null : JSON.parse(row.best_light),
    bestSeasons:
      row.best_seasons === null ? null : JSON.parse(row.best_seasons),
    walkMinutes: row.walk_minutes,
    parkingNotes: row.parking_notes,
    terrain: row.terrain === null ? null : JSON.parse(row.terrain),
    accessibility:
      row.accessibility === null ? null : JSON.parse(row.accessibility),
    maxGroupSize: row.max_group_size,
    dogFriendly: row.dog_friendly === null ? null : row.dog_friendly === 1,
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
 * Every child query checks both the parent and child publication status.
 * D1 has no row-level security to supply an implicit visibility filter.
 */
export async function getSpotMedia(
  context: DataContext,
  spotId: string,
): Promise<SpotMedia> {
  const [photos, links] = await context.db.batch([
    context.db
      .prepare(
        `SELECT p.id,p.storage_path AS storagePath,p.kind,p.caption,p.credit_name AS creditName,p.credit_url AS creditUrl
      FROM photos p JOIN spots s ON s.id=p.spot_id WHERE p.spot_id=? AND p.status='published' AND s.status='published'
      ORDER BY (p.kind='session') DESC,p.created_at,p.id`,
      )
      .bind(spotId),
    context.db
      .prepare(
        `SELECT l.id,l.url,l.title FROM spot_gallery_links l JOIN spots s ON s.id=l.spot_id
      WHERE l.spot_id=? AND s.status='published' ORDER BY l.created_at,l.id`,
      )
      .bind(spotId),
  ]);
  return {
    photos: photos.results as unknown as SpotPhoto[],
    galleryLinks: links.results as unknown as SpotGalleryLink[],
  };
}

export async function listShootTypes(context: DataContext) {
  return (
    await context.db
      .prepare("SELECT id,slug,label FROM shoot_types ORDER BY sort_order,id")
      .all<{ id: number; slug: string; label: string }>()
  ).results;
}
