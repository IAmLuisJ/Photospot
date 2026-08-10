import { DEFAULT_WEIGHTS, type ScoreWeights } from "./weights";

/**
 * One activity event, before weighting.
 *
 * This mirrors the rows the hot-refresh job reads out of signals, comments and
 * photos — not the `signals` table alone, since comments and photo uploads
 * feed ranking without being signal rows (spec §4.4).
 */
export type WeightedActivity =
  | { kind: "shoot_type_upvote" }
  | { kind: "shoot_again"; value: 0 | 1 }
  | { kind: "comment" }
  | { kind: "photo"; photoKind: "scouting" | "session" };

/**
 * The single place activity becomes a weight.
 *
 * Spec §7 requires this to exist. `computeScore` applies weights internally
 * from the denormalised counters; `computeHotScore` takes events whose weights
 * the caller has already applied. Those are two code paths over one set of
 * rules, so the hot-refresh job must route through here rather than writing its
 * own `switch (kind)` — otherwise a re-weighting updates the lifetime ranking
 * and quietly leaves the hot ranking on the old numbers, with nothing failing.
 *
 * `signal-weight.test.ts` asserts the two paths agree, including under retuned
 * weights, which is what actually holds the invariant.
 */
export function weightForSignalKind(
  activity: WeightedActivity,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  switch (activity.kind) {
    case "shoot_type_upvote":
      return weights.shootTypeUpvote;
    case "shoot_again":
      return activity.value === 1 ? weights.shootAgainYes : weights.shootAgainNo;
    case "comment":
      return weights.comment;
    case "photo":
      return activity.photoKind === "session"
        ? weights.sessionPhoto
        : weights.scoutingPhoto;
  }
}
