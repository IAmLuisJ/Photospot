import type { ShootTypeVoteState } from "../domain/signals/vote-state";
import {
  requirePublishedSpot,
  requireViewer,
  type DataContext,
} from "./context";
export type SignalKind = "shoot_type_upvote" | "shoot_again";
export interface SignalRef {
  spotId: string;
  kind: SignalKind;
  shootTypeId: number | null;
}
export interface ShootTypeVotes extends ShootTypeVoteState {
  slug: string;
}

export async function getShootTypeVotes(
  context: DataContext,
  spotId: string,
): Promise<ShootTypeVotes[]> {
  const { results } = await context.db
    .prepare(
      `SELECT t.id AS shootTypeId,t.slug,t.label,
    COUNT(v.id) AS upvoteCount,MAX(CASE WHEN v.profile_id=? THEN 1 ELSE 0 END) AS viewerUpvoted
    FROM shoot_types t LEFT JOIN signals v ON v.shoot_type_id=t.id AND v.spot_id=? AND v.kind='shoot_type_upvote'
    WHERE EXISTS(SELECT 1 FROM spots WHERE id=? AND status='published')
    GROUP BY t.id HAVING COUNT(v.id)>0 OR EXISTS(SELECT 1 FROM spot_shoot_types WHERE spot_id=? AND shoot_type_id=t.id)
    ORDER BY t.sort_order,t.id`,
    )
    .bind(context.viewer?.id ?? null, spotId, spotId, spotId)
    .all<{
      shootTypeId: number;
      slug: string;
      label: string;
      upvoteCount: number;
      viewerUpvoted: number;
    }>();
  return results.map((row) => ({
    ...row,
    viewerUpvoted: row.viewerUpvoted === 1,
  }));
}
export async function getViewerShootAgain(
  context: DataContext,
  spotId: string,
  profileId: string | null = context.viewer?.id ?? null,
): Promise<0 | 1 | null> {
  if (!context.viewer || context.viewer.id !== profileId) return null;
  return context.db
    .prepare(
      `SELECT v.value FROM signals v JOIN spots s ON s.id=v.spot_id
    WHERE v.spot_id=? AND v.profile_id=? AND v.kind='shoot_again' AND s.status='published'`,
    )
    .bind(spotId, context.viewer.id)
    .first<0 | 1>("value");
}
export async function castSignal(
  context: DataContext,
  ref: SignalRef,
  value: 0 | 1 = 1,
): Promise<void> {
  const viewer = requireViewer(context);
  await requirePublishedSpot(context, ref.spotId);
  if (!(
    (ref.kind === "shoot_type_upvote" &&
      Number.isInteger(ref.shootTypeId) &&
      value === 1) ||
    (ref.kind === "shoot_again" &&
      ref.shootTypeId === null &&
      (value === 0 || value === 1))
  ))
    throw new Error("Invalid signal.");
  await context.db
    .prepare(
      `INSERT INTO signals(id,spot_id,profile_id,kind,shoot_type_id,value)
    SELECT ?,id,?,?,?,? FROM spots WHERE id=? AND status='published'
    ON CONFLICT DO UPDATE SET value=excluded.value,created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE signals.value<>excluded.value`,
    )
    .bind(
      crypto.randomUUID(),
      viewer.id,
      ref.kind,
      ref.shootTypeId,
      value,
      ref.spotId,
    )
    .run();
}
export async function retractSignal(
  context: DataContext,
  ref: SignalRef,
): Promise<void> {
  const viewer = requireViewer(context);
  await context.db
    .prepare(
      "DELETE FROM signals WHERE spot_id=? AND profile_id=? AND kind=? AND shoot_type_id IS ?",
    )
    .bind(ref.spotId, viewer.id, ref.kind, ref.shootTypeId)
    .run();
}
