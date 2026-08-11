import { useFetcher } from "react-router";
import type { SpotComment } from "~/data/comments";
import { MAX_COMMENT_LENGTH } from "~/domain/comments/comment";

/**
 * ISO date, sliced, not `toLocaleDateString`: a locale-formatted byline renders
 * differently for the reader than for the test, and that is the kind of thing
 * that only fails on somebody else's machine.
 */
export function commentByline(comment: SpotComment): string {
  const day = comment.createdAt.slice(0, 10);
  return `${comment.authorName ?? "Anonymous"} · ${day}`;
}

export function CommentThread({
  comments,
  signedIn,
}: {
  comments: SpotComment[];
  signedIn: boolean;
}) {
  // `{ error?: string }` rather than `typeof action`, which would be a cycle:
  // the route imports this component.
  const fetcher = useFetcher<{ error?: string }>();
  const posting = fetcher.state !== "idle";

  return (
    <section className="comments">
      <h2>Comments</h2>

      {comments.length === 0 ? (
        <p>Nobody has said anything about this spot yet.</p>
      ) : (
        <ul className="comments__list">
          {comments.map((c) => (
            <li key={c.id}>
              <p className="comments__byline">{commentByline(c)}</p>
              <p className="comments__body">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {signedIn && (
        <fetcher.Form method="post" className="comments__form">
          <input type="hidden" name="intent" value="comment" />
          <label>
            Add a comment
            <textarea name="body" rows={3} maxLength={MAX_COMMENT_LENGTH} required />
          </label>
          {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
          <button type="submit" disabled={posting}>
            {posting ? "Posting…" : "Post comment"}
          </button>
        </fetcher.Form>
      )}
    </section>
  );
}
