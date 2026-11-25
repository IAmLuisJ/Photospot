import { computeScore, type SpotCounters } from "../domain/scoring/score";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "../domain/scoring/weights";
export const COUNTER_COLUMNS =
  "shoot_type_upvote_count,shoot_again_yes_count,shoot_again_no_count,comment_count,scouting_photo_count,session_photo_count";
export interface CounterRow {
  shoot_type_upvote_count: number;
  shoot_again_yes_count: number;
  shoot_again_no_count: number;
  comment_count: number;
  scouting_photo_count: number;
  session_photo_count: number;
}
export const toCounters = (r: CounterRow): SpotCounters => ({
  shootTypeUpvoteCount: r.shoot_type_upvote_count,
  shootAgainYesCount: r.shoot_again_yes_count,
  shootAgainNoCount: r.shoot_again_no_count,
  commentCount: r.comment_count,
  scoutingPhotoCount: r.scouting_photo_count,
  sessionPhotoCount: r.session_photo_count,
});
export async function refreshSpotScore(
  db: D1Database,
  spotId: string,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): Promise<number> {
  // Compare the counters as well as the ID so a concurrent contribution cannot
  // be overwritten by a score computed from an older snapshot.
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db
      .prepare(`SELECT ${COUNTER_COLUMNS} FROM spots WHERE id=?`)
      .bind(spotId)
      .first<CounterRow>();
    if (!row) throw new Error("Spot not found.");
    const score = computeScore(toCounters(row), weights);
    const columns = COUNTER_COLUMNS.split(",") as (keyof CounterRow)[];
    const result = await db
      .prepare(
        `UPDATE spots SET score=? WHERE id=? AND ${columns.map((c) => `${c}=?`).join(" AND ")}`,
      )
      .bind(score, spotId, ...columns.map((c) => row[c]))
      .run();
    if (result.meta.changes) return score;
  }
  throw new Error(
    "Score changed concurrently; scheduled backfill will repair it.",
  );
}
