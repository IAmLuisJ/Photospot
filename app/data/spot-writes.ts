import {
  DUPLICATE_RADIUS_METERS,
  haversineMeters,
  type LatLng,
} from "../domain/geo/distance";
import { slugCandidates } from "../domain/spots/slug";
import {
  validateSubmission,
  type SubmissionInput,
} from "../domain/spots/submission";
import type { SpotKind } from "./spots";
import {
  httpUrl,
  requirePublishedSpot,
  requireViewer,
  type DataContext,
} from "./context";

export interface NearbySpot {
  id: string;
  name: string;
  slug: string;
  kind: SpotKind;
  locality: string | null;
  region: string | null;
  distanceMeters: number;
}

export async function findNearbyDuplicates(
  context: DataContext,
  position: LatLng,
  kind: SpotKind,
  radiusMeters = DUPLICATE_RADIUS_METERS,
): Promise<NearbySpot[]> {
  if (
    !Number.isFinite(radiusMeters) ||
    radiusMeters < 0 ||
    !Number.isFinite(position.lat) ||
    !Number.isFinite(position.lng)
  )
    throw new Error("Invalid proximity query.");
  // A conservative rectangle selects candidates; the shared great-circle
  // calculation determines inclusion. No LIMIT is applied before that check.
  const dLat = radiusMeters / 110_000;
  const dLng = Math.min(
    180,
    dLat /
      Math.max(
        0.000001,
        Math.cos(((Math.abs(position.lat) + dLat) * Math.PI) / 180),
      ),
  );
  const { results } = await context.db
    .prepare(
      `SELECT id,name,slug,kind,locality,region,lat,lng FROM spots
    WHERE status='published' AND kind=? AND lat BETWEEN ? AND ?
    AND (abs(lng-?)<=? OR abs(lng-?)>=?)`,
    )
    .bind(
      kind,
      position.lat - dLat,
      position.lat + dLat,
      position.lng,
      dLng,
      position.lng,
      360 - dLng,
    )
    .all<{
      id: string;
      name: string;
      slug: string;
      kind: SpotKind;
      locality: string | null;
      region: string | null;
      lat: number;
      lng: number;
    }>();
  return results
    .map(({ lat, lng, ...row }) => ({
      ...row,
      distanceMeters: haversineMeters(position, { lat, lng }),
    }))
    .filter((s) => s.distanceMeters <= radiusMeters)
    .sort(
      (a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id),
    );
}

export async function resolveSlug(
  context: DataContext,
  name: string,
  locality: string | null,
  region: string | null,
): Promise<string> {
  for (const candidate of slugCandidates(name, locality, region)) {
    if (
      !(await context.db
        .prepare("SELECT id FROM spots WHERE slug=?")
        .bind(candidate)
        .first())
    )
      return candidate;
  }
  return `${slugCandidates(name, locality, region)[0]}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function createSpot(
  context: DataContext,
  input: SubmissionInput,
  slug: string,
): Promise<string> {
  const viewer = requireViewer(context);
  const { errors } = validateSubmission(input);
  if (errors.length) throw new Error(errors[0].message);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // The NOT NULL storage_path constraint makes a missing/expired/already-used
  // receipt abort the batch, including the parent spot and its shoot types.
  const statements = [
    context.db
      .prepare(
        `INSERT INTO spots
    (id,name,slug,kind,lat,lng,description,locality,region,created_by,cost_type,walk_minutes,accessibility,terrain,dog_friendly)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        input.name.trim(),
        slug,
        input.kind,
        input.position.lat,
        input.position.lng,
        input.description,
        input.locality,
        input.region,
        viewer.id,
        input.costType || null,
        input.walkMinutes ?? null,
        input.accessibility == null
          ? null
          : JSON.stringify(input.accessibility),
        input.terrain == null ? null : JSON.stringify(input.terrain),
        input.dogFriendly == null ? null : Number(input.dogFriendly),
      ),
  ];
  for (const type of new Set(input.shootTypeIds))
    statements.push(
      context.db
        .prepare(
          "INSERT INTO spot_shoot_types(spot_id,shoot_type_id) VALUES (?,?)",
        )
        .bind(id, type),
    );
  for (const photo of input.photos) {
    if (photo.creditUrl) httpUrl(photo.creditUrl);
    statements.push(
      context.db
        .prepare(
          `INSERT INTO photos(id,spot_id,profile_id,kind,storage_path,rights_attested,credit_name,credit_url,caption)
      VALUES (?,?,?,?,(SELECT storage_path FROM uploads WHERE storage_path=? AND profile_id=? AND state='ready' AND attached_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')),?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          viewer.id,
          photo.kind,
          photo.storagePath,
          viewer.id,
          Number(photo.rightsAttested),
          photo.creditName,
          photo.creditUrl,
          photo.caption,
        ),
    );
    statements.push(
      context.db
        .prepare(
          "UPDATE uploads SET attached_at=? WHERE storage_path=? AND profile_id=? AND attached_at IS NULL",
        )
        .bind(now, photo.storagePath, viewer.id),
    );
  }
  try {
    await context.db.batch(statements);
  } catch (error) {
    if (
      error instanceof Error &&
      /NOT NULL.*photos.storage_path/.test(error.message)
    )
      throw new Error(
        "A photo upload is missing, expired, or belongs to another user. Upload it again.",
      );
    throw error;
  }
  return id;
}

export async function addGalleryLink(
  context: DataContext,
  spotId: string,
  url: string,
  title: string,
): Promise<void> {
  const viewer = requireViewer(context);
  await requirePublishedSpot(context, spotId);
  const safeUrl = httpUrl(url);
  if (!title.trim()) throw new Error("Give the gallery a title.");
  const result = await context.db
    .prepare(
      `INSERT INTO spot_gallery_links(id,spot_id,profile_id,url,title)
    SELECT ?,id,?,?,? FROM spots WHERE id=? AND status='published'`,
    )
    .bind(crypto.randomUUID(), viewer.id, safeUrl, title.trim(), spotId)
    .run();
  if (!result.meta.changes) throw new Error("Spot not found.");
}

export interface SpotEdits {
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
}

export async function updateSpot(
  context: DataContext,
  spotId: string,
  fields: SpotEdits,
): Promise<boolean> {
  const viewer = requireViewer(context);
  const columns: Record<keyof SpotEdits, string> = {
    name: "name",
    description: "description",
    locality: "locality",
    region: "region",
    walkMinutes: "walk_minutes",
    parkingNotes: "parking_notes",
    costType: "cost_type",
    accessibility: "accessibility",
    terrain: "terrain",
    dogFriendly: "dog_friendly",
  };
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];
  for (const key of Object.keys(columns) as (keyof SpotEdits)[]) {
    const value = fields[key];
    if (value === undefined) continue;
    assignments.push(`${columns[key]}=?`);
    values.push(
      value === null
        ? null
        : Array.isArray(value)
          ? JSON.stringify(value)
          : typeof value === "boolean"
            ? Number(value)
            : value,
    );
  }
  if (!assignments.length) return false;
  const result = await context.db
    .prepare(
      `UPDATE spots SET ${assignments.join(",")} WHERE id=?
    AND ((status='published' AND (created_by=? OR owner_profile_id=?)) OR EXISTS(SELECT 1 FROM profiles WHERE id=? AND role='admin'))`,
    )
    .bind(...values, spotId, viewer.id, viewer.id, viewer.id)
    .run();
  return result.meta.changes > 0;
}
