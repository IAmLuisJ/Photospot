import { DEFAULT_WEIGHTS, type ScoreWeights } from "./weights";

/** Mirrors the trigger-maintained counter columns on `spots`. */
export interface SpotCounters {
  readonly shootTypeUpvoteCount: number;
  readonly shootAgainYesCount: number;
  readonly shootAgainNoCount: number;
  readonly commentCount: number;
  readonly scoutingPhotoCount: number;
  readonly sessionPhotoCount: number;
}

// Frozen because `{ ...ZERO_COUNTERS, ...overrides }` is the idiom for building
// a counter set, so a mutation here would propagate into every set built after it.
export const ZERO_COUNTERS: SpotCounters = Object.freeze({
  shootTypeUpvoteCount: 0,
  shootAgainYesCount: 0,
  shootAgainNoCount: 0,
  commentCount: 0,
  scoutingPhotoCount: 0,
  sessionPhotoCount: 0,
});

export function computeScore(
  counters: SpotCounters,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  const total =
    counters.shootTypeUpvoteCount * weights.shootTypeUpvote +
    counters.shootAgainYesCount * weights.shootAgainYes +
    counters.shootAgainNoCount * weights.shootAgainNo +
    counters.commentCount * weights.comment +
    counters.scoutingPhotoCount * weights.scoutingPhoto +
    counters.sessionPhotoCount * weights.sessionPhoto;

  return Math.round(total * 1000) / 1000;
}
