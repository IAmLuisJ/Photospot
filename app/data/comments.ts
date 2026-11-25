import { validateComment } from "../domain/comments/comment";
import {
  requirePublishedSpot,
  requireViewer,
  type DataContext,
} from "./context";
export interface SpotComment {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
}
export async function listComments(
  context: DataContext,
  spotId: string,
  limit = 200,
): Promise<SpotComment[]> {
  return (
    await context.db
      .prepare(
        `SELECT c.id,c.body,c.created_at AS createdAt,c.profile_id AS authorId,p.display_name AS authorName
    FROM comments c JOIN spots s ON s.id=c.spot_id LEFT JOIN profiles p ON p.id=c.profile_id
    WHERE c.spot_id=? AND c.status='published' AND s.status='published' ORDER BY c.created_at,c.id LIMIT ?`,
      )
      .bind(spotId, Math.min(500, Math.max(1, Math.trunc(limit))))
      .all<SpotComment>()
  ).results;
}
export async function addComment(
  context: DataContext,
  spotId: string,
  body: string,
  profileId?: string,
): Promise<void> {
  const viewer = requireViewer(context);
  if (profileId !== undefined && profileId !== viewer.id)
    throw new Error("Cannot comment as another user.");
  const { errors } = validateComment(body);
  if (errors.length) throw new Error(errors[0].message);
  await requirePublishedSpot(context, spotId);
  const result = await context.db
    .prepare(
      `INSERT INTO comments(id,spot_id,profile_id,body)
    SELECT ?,id,?,? FROM spots WHERE id=? AND status='published'`,
    )
    .bind(crypto.randomUUID(), viewer.id, body.trim(), spotId)
    .run();
  if (!result.meta.changes) throw new Error("Spot not found.");
}
