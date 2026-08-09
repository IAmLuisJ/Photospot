import { DEFAULT_WEIGHTS, type ScoreWeights } from "./weights";

/** Mirrors the trigger-maintained counter columns on `spots`. */
export interface SpotCounters {
  shootTypeUpvoteCount: number;
  shootAgainYesCount: number;
  shootAgainNoCount: number;
  commentCount: number;
  scoutingPhotoCount: number;
  sessionPhotoCount: number;
}

export const ZERO_COUNTERS: SpotCounters = {
  shootTypeUpvoteCount: 0,
  shootAgainYesCount: 0,
  shootAgainNoCount: 0,
  commentCount: 0,
  scoutingPhotoCount: 0,
  sessionPhotoCount: 0,
};

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
