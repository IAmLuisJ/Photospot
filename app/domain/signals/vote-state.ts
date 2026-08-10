/** One shoot type as the detail page draws it. */
export interface ShootTypeVoteState {
  shootTypeId: number;
  label: string;
  upvoteCount: number;
  viewerUpvoted: boolean;
}

/** The state the viewer just asked for, while the request is in flight. */
export interface PendingUpvote {
  shootTypeId: number;
  upvoted: boolean;
}

export interface ShootAgainState {
  yesCount: number;
  noCount: number;
  /** 1 yes, 0 no, null for no answer yet. */
  viewerAnswer: 0 | 1 | null;
}

/** `null` retracts; `undefined` means nothing is in flight. */
export type PendingShootAgain = 0 | 1 | null | undefined;

const clamp = (n: number) => (n < 0 ? 0 : n);

/**
 * What to draw while an upvote is in flight.
 *
 * Idempotent by construction: the server treats a duplicate vote as success
 * (spec §9.2), so a double click submits the same intent twice, and an
 * unconditional +1 would jump the count by two before snapping back on
 * revalidation. Rollback itself needs no code — when the fetcher settles the
 * loader revalidates and the server's numbers replace these.
 */
export function applyPendingUpvote(
  rows: readonly ShootTypeVoteState[],
  pending: PendingUpvote | null,
): ShootTypeVoteState[] {
  return rows.map((row) => {
    // Copy even on the unchanged paths. Without it these rows would be the
    // exact objects from the input array, so a caller that mutates the
    // returned rows would silently mutate the input too. Copying makes the
    // function safe by construction rather than by convention.
    if (!pending || pending.shootTypeId !== row.shootTypeId) return { ...row };
    if (pending.upvoted === row.viewerUpvoted) return { ...row };

    return {
      ...row,
      viewerUpvoted: pending.upvoted,
      upvoteCount: pending.upvoted ? row.upvoteCount + 1 : clamp(row.upvoteCount - 1),
    };
  });
}

/**
 * What to draw while a "would you shoot here again?" answer is in flight.
 *
 * Flipping moves the vote rather than adding one: `cast_signal` deletes the old
 * row and inserts the new one in a single transaction, so both counters move
 * together and the display has to match.
 */
export function applyPendingShootAgain(
  state: ShootAgainState,
  pending: PendingShootAgain,
): ShootAgainState {
  if (pending === undefined || pending === state.viewerAnswer) return { ...state };

  let { yesCount, noCount } = state;
  if (state.viewerAnswer === 1) yesCount = clamp(yesCount - 1);
  if (state.viewerAnswer === 0) noCount = clamp(noCount - 1);
  if (pending === 1) yesCount += 1;
  if (pending === 0) noCount += 1;

  return { yesCount, noCount, viewerAnswer: pending };
}
