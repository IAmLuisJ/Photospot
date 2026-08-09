/**
 * Weights are configuration, not truth. Changing them requires running
 * scripts/backfill-scores.ts to recompute every stored spot score.
 */
export interface ScoreWeights {
  shootTypeUpvote: number;
  shootAgainYes: number;
  shootAgainNo: number;
  comment: number;
  scoutingPhoto: number;
  sessionPhoto: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  shootTypeUpvote: 1.0,
  shootAgainYes: 2.0,
  shootAgainNo: -1.5,
  comment: 0.5,
  scoutingPhoto: 1.0,
  sessionPhoto: 1.5,
};
