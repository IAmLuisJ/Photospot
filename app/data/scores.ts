import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScore, type SpotCounters } from "../domain/scoring/score";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "../domain/scoring/weights";

/**
 * The trigger-maintained columns, in one place so the batch path
 * (`scripts/backfill-scores.ts`) and the request path cannot drift on what a
 * counter means.
 */
export const COUNTER_COLUMNS =
  "shoot_type_upvote_count, shoot_again_yes_count, shoot_again_no_count, comment_count, scouting_photo_count, session_photo_count";

export interface CounterRow {
  shoot_type_upvote_count: number;
  shoot_again_yes_count: number;
  shoot_again_no_count: number;
  comment_count: number;
  scouting_photo_count: number;
  session_photo_count: number;
}

export const toCounters = (row: CounterRow): SpotCounters => ({
  shootTypeUpvoteCount: row.shoot_type_upvote_count,
  shootAgainYesCount: row.shoot_again_yes_count,
  shootAgainNoCount: row.shoot_again_no_count,
  commentCount: row.comment_count,
  scoutingPhotoCount: row.scouting_photo_count,
  sessionPhotoCount: row.session_photo_count,
});

/**
 * Recompute and store one spot's score. Spec §7: the counters are dumb and
 * live in Postgres, the weights are testable and live in TypeScript, and this
 * is the seam where they meet.
 *
 * Requires a service-role client. `authenticated` has no UPDATE privilege on
 * `spots.score` and must not have one — score is the default sort order, so a
 * writable column is rank manipulation.
 *
 * Read-then-write, not one atomic statement: two votes landing together can
 * both read the same counters and write the same score, leaving it one vote
 * behind. The counters themselves are never wrong — the recount trigger is
 * statement-level and runs inside the vote's own transaction — so this is a
 * stale derived number, not lost data, and `npm run backfill:scores` repairs
 * it. Making it atomic would mean doing the arithmetic in SQL, which is a
 * second copy of the weights in a second language: precisely the drift spec §7
 * exists to prevent.
 */
export async function refreshSpotScore(
  admin: SupabaseClient,
  spotId: string,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): Promise<number> {
  const { data, error } = await admin
    .from("spots")
    .select(COUNTER_COLUMNS)
    .eq("id", spotId)
    .single();

  if (error) throw error;

  const score = computeScore(toCounters(data as unknown as CounterRow), weights);

  const { error: writeError } = await admin.from("spots").update({ score }).eq("id", spotId);
  if (writeError) throw writeError;

  return score;
}
