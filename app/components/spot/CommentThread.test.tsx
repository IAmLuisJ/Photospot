import { describe, it, expect } from "vitest";
import { commentByline } from "./CommentThread";
import type { SpotComment } from "~/data/comments";

const comment = (over: Partial<SpotComment> = {}): SpotComment => ({
  id: "c1",
  body: "Parking fills up by nine.",
  createdAt: "2026-08-10T17:30:00.000Z",
  authorId: "p1",
  authorName: "Dana",
  ...over,
});

describe("commentByline", () => {
  it("names the author and the day", () => {
    expect(commentByline(comment())).toBe("Dana · 2026-08-10");
  });

  // Spec §4.6a: the comment outlives the account that wrote it.
  it("says Anonymous when the author's account is gone", () => {
    expect(commentByline(comment({ authorId: null, authorName: null }))).toBe(
      "Anonymous · 2026-08-10",
    );
  });

  // A locale-formatted date would render differently for the reader than for
  // the test, which is the kind of thing that only fails on someone else's
  // machine. This one is fixed in UTC — late-evening UTC must not roll forward.
  it("formats the date in UTC, so the byline does not move with the reader", () => {
    expect(commentByline(comment({ createdAt: "2026-08-10T23:30:00.000Z" }))).toBe(
      "Dana · 2026-08-10",
    );
  });
});
