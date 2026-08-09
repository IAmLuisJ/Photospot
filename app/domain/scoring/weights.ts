/**
 * Weights are configuration, not truth. Changing them requires running
 * scripts/backfill-scores.ts to recompute every stored spot score.
 */
export interface ScoreWeights {
  readonly shootTypeUpvote: number;
  readonly shootAgainYes: number;
  readonly shootAgainNo: number;
  readonly comment: number;
  readonly scoutingPhoto: number;
  readonly sessionPhoto: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = Object.freeze({
  shootTypeUpvote: 1.0,
  shootAgainYes: 2.0,
  shootAgainNo: -1.5,
  comment: 0.5,
  scoutingPhoto: 1.0,
  sessionPhoto: 1.5,
});
