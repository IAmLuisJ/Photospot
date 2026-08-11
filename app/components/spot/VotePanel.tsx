import { Link, useFetcher } from "react-router";
import {
  applyPendingUpvote,
  applyPendingShootAgain,
  type PendingUpvote,
  type PendingShootAgain,
  type ShootAgainState,
  type ShootTypeVoteState,
} from "~/domain/signals/vote-state";
import type { ShootTypeVotes } from "~/data/signals";

/**
 * The state a submission is asking for, read back out of the in-flight form.
 *
 * `fetcher.formData` rather than a `useState` mirror: React Router already
 * holds the pending submission, and a second copy of it is a second thing to
 * keep in sync — which is where optimistic UI usually goes wrong.
 */
export function pendingUpvoteFrom(formData: FormData | undefined): PendingUpvote | null {
  const intent = formData?.get("intent");
  if (intent !== "upvote" && intent !== "unvote") return null;

  // Number("") is 0, not NaN, so a missing field would read as a pending vote
  // on shoot type 0 rather than as nothing in flight.
  const raw = formData?.get("shootTypeId");
  if (typeof raw !== "string" || raw.trim() === "") return null;

  const shootTypeId = Number(raw);
  if (!Number.isInteger(shootTypeId)) return null;

  return { shootTypeId, upvoted: intent === "upvote" };
}

/** `undefined` is nothing in flight; `null` is an explicit retraction. */
export function pendingShootAgainFrom(formData: FormData | undefined): PendingShootAgain {
  if (formData?.get("intent") !== "shoot-again") return undefined;

  const answer = formData.get("answer");
  if (answer === "yes") return 1;
  if (answer === "no") return 0;
  if (answer === "retract") return null;
  return undefined;
}

export function upvoteLabel(row: ShootTypeVoteState): string {
  return row.viewerUpvoted ? `Remove your ${row.label} upvote` : `Upvote ${row.label}`;
}

/**
 * The lifetime totals above the breakdown. Separate from the panel's per-type
 * rows: this answers "how much has happened here at all", the rows answer
 * "what is it good for".
 *
 * Reads "1 upvote", not "1 upvotes" — the line was written when every count was
 * necessarily zero, so the plural was invisible until voting existed.
 */
export function voteTotalsLine(totals: {
  shootTypeUpvoteCount: number;
  shootAgainYesCount: number;
  shootAgainNoCount: number;
}): string {
  const upvotes = `${totals.shootTypeUpvoteCount} ${
    totals.shootTypeUpvoteCount === 1 ? "upvote" : "upvotes"
  }`;
  const parts = [upvotes, `${totals.shootAgainYesCount} would shoot here again`];
  if (totals.shootAgainNoCount > 0) parts.push(`${totals.shootAgainNoCount} would not`);
  return parts.join(" · ");
}

/**
 * Its own fetcher per row, so one pending vote does not freeze the others.
 *
 * Typed as `{ error?: string }` rather than `typeof action`: importing the
 * route's action type into a component the route imports is a cycle, and the
 * error is the only part of the response this reads.
 */
function ShootTypeRow({ row, signedIn }: { row: ShootTypeVotes; signedIn: boolean }) {
  const fetcher = useFetcher<{ error?: string }>();
  const [shown] = applyPendingUpvote([row], pendingUpvoteFrom(fetcher.formData));

  return (
    <li className="vote-panel__row">
      <span className="vote-panel__label">{shown.label}</span>
      <span className="vote-panel__count">{shown.upvoteCount}</span>
      {signedIn ? (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value={shown.viewerUpvoted ? "unvote" : "upvote"} />
          <input type="hidden" name="shootTypeId" value={row.shootTypeId} />
          <button type="submit" aria-pressed={shown.viewerUpvoted}>
            {upvoteLabel(shown)}
          </button>
        </fetcher.Form>
      ) : null}
      {fetcher.data?.error && <span role="alert">{fetcher.data.error}</span>}
    </li>
  );
}

export function VotePanel({
  rows,
  shootAgain,
  signedIn,
}: {
  rows: ShootTypeVotes[];
  shootAgain: ShootAgainState;
  signedIn: boolean;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const shown = applyPendingShootAgain(shootAgain, pendingShootAgainFrom(fetcher.formData));

  return (
    <section className="vote-panel">
      <h2>What is it good for?</h2>
      {rows.length === 0 ? (
        <p>No shoot types on this spot yet.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <ShootTypeRow key={row.shootTypeId} row={row} signedIn={signedIn} />
          ))}
        </ul>
      )}

      <h2>Would you shoot here again?</h2>
      <p className="vote-panel__again">
        {shown.yesCount} yes · {shown.noCount} no
      </p>

      {signedIn ? (
        <fetcher.Form method="post" className="vote-panel__again-form">
          <input type="hidden" name="intent" value="shoot-again" />
          <button type="submit" name="answer" value="yes" aria-pressed={shown.viewerAnswer === 1}>
            Yes
          </button>
          <button type="submit" name="answer" value="no" aria-pressed={shown.viewerAnswer === 0}>
            No
          </button>
          {shown.viewerAnswer !== null && (
            <button type="submit" name="answer" value="retract">
              Clear my answer
            </button>
          )}
          {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
        </fetcher.Form>
      ) : (
        <p>
          <Link to="/auth/login">Sign in</Link> to vote or comment.
        </p>
      )}
    </section>
  );
}
