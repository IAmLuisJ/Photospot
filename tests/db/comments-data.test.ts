import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { listComments, addComment } from "../../app/data/comments";
import { MAX_COMMENT_LENGTH } from "../../app/domain/comments/comment";

let author: TestUser;
let leaver: TestUser;
let spotId: string;

beforeAll(async () => {
  author = await createTestUser("Comment Author");
  leaver = await createTestUser("Departing Photographer");

  const { data, error } = await serviceClient()
    .from("spots")
    .insert({
      kind: "outdoor",
      name: "Comments Park",
      slug: `comments-${crypto.randomUUID().slice(0, 8)}`,
      location: "POINT(-85.66 42.93)",
      created_by: author.id,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw error;
  spotId = data.id;
});

afterAll(async () => {
  // Throws rather than discarding the error: a silent cleanup failure leaves a
  // published spot on the local map, the same reasoning as deleteTestUser.
  const { error } = await serviceClient().from("spots").delete().eq("id", spotId);
  if (error) throw error;
  await deleteTestUser(author.id);
});

describe("addComment / listComments", () => {
  it("stores a comment and lists it with its author", async () => {
    await addComment(author.client, spotId, "Best light is about an hour before sunset.", author.id);

    const comments = await listComments(anonClient(), spotId);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Best light is about an hour before sunset.");
    expect(comments[0].authorName).toBe("Comment Author");
    expect(comments[0].authorId).toBe(author.id);
  });

  it("trims the body it stores, so the database check sees what was validated", async () => {
    await addComment(author.client, spotId, "  Parking fills up by nine.  ", author.id);

    const comments = await listComments(anonClient(), spotId);
    expect(comments.map((c) => c.body)).toContain("Parking fills up by nine.");
  });

  it("orders oldest first", async () => {
    const comments = await listComments(anonClient(), spotId);
    const times = comments.map((c) => Date.parse(c.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("refuses a logged-out commenter", async () => {
    await expect(
      addComment(anonClient(), spotId, "Drive-by spam.", author.id),
    ).rejects.toMatchObject({ code: "42501" });
  });

  // Spec §9.4: moderation is not reversible by the author, and removed content
  // is not shown to anyone else.
  it("hides a removed comment from other visitors", async () => {
    const { data } = await serviceClient()
      .from("comments")
      .insert({ spot_id: spotId, profile_id: author.id, body: "Removed later." })
      .select("id")
      .single();

    await serviceClient().from("comments").update({ status: "removed" }).eq("id", data!.id);

    const comments = await listComments(anonClient(), spotId);
    expect(comments.map((c) => c.id)).not.toContain(data!.id);
  });

  // The test above passes with or without the query's `status` filter, because
  // RLS hides the row from anon either way. This is the one that makes the
  // filter load-bearing: comments_read deliberately lets authors see their own
  // removed comments, so listing as the author is the only way the filter is
  // what does the hiding. The page lists with the viewer's own client, so
  // without it an author would see their removed comment sitting in the thread
  // and believe it was still public.
  it("hides a removed comment from its own author too", async () => {
    const { data } = await serviceClient()
      .from("comments")
      .insert({ spot_id: spotId, profile_id: author.id, body: "Removed, seen by its author." })
      .select("id")
      .single();

    await serviceClient().from("comments").update({ status: "removed" }).eq("id", data!.id);

    const asAuthor = await listComments(author.client, spotId);
    expect(asAuthor.map((c) => c.id)).not.toContain(data!.id);

    // Guard against the test passing because RLS hid it from the author: it is
    // visible to them without the status filter.
    const { data: unfiltered } = await author.client
      .from("comments")
      .select("id")
      .eq("spot_id", spotId)
      .eq("id", data!.id);
    expect(unfiltered).toHaveLength(1);
  });

  it("returns only the comments on the spot it was asked about", async () => {
    const admin = serviceClient();
    const { data: elsewhere, error } = await admin
      .from("spots")
      .insert({
        kind: "outdoor",
        name: "Some Other Park",
        slug: `comments-other-${crypto.randomUUID().slice(0, 8)}`,
        location: "POINT(-85.65 42.92)",
        created_by: author.id,
        status: "published",
      })
      .select("id")
      .single();
    if (error) throw error;

    try {
      await addComment(author.client, elsewhere.id, "A comment on a different spot.", author.id);

      const here = await listComments(anonClient(), spotId);
      expect(here.map((c) => c.body)).not.toContain("A comment on a different spot.");
    } finally {
      const { error: cleanup } = await admin.from("spots").delete().eq("id", elsewhere.id);
      if (cleanup) throw cleanup;
    }
  });

  // Spec §4.6a: deleting an account must not destroy other people's context.
  // comments.profile_id is ON DELETE SET NULL, so the comment survives with no
  // author — and the embedded `profiles` resource comes back null, which the
  // mapping has to cope with.
  it("keeps a comment whose author deleted their account, with no name", async () => {
    await addComment(leaver.client, spotId, "I shot a maternity session here in May.", leaver.id);
    await deleteTestUser(leaver.id);

    const comments = await listComments(anonClient(), spotId);
    const orphan = comments.find((c) => c.body.startsWith("I shot a maternity session"));
    expect(orphan).toBeDefined();
    expect(orphan!.authorId).toBeNull();
    expect(orphan!.authorName).toBeNull();
  });

  // supabase-js returns errors, it does not throw. A mapper that ignores
  // `error` renders an empty thread for a query that actually failed.
  it("throws when the query fails rather than returning an empty thread", async () => {
    await expect(listComments(anonClient(), "not-a-uuid")).rejects.toMatchObject({
      code: "22P02",
    });
  });
});

// The constraints in migration 10. These are the database's own rules, tested
// through raw inserts rather than addComment, because the point is what holds
// for a caller that never goes through the application at all.
describe("comment constraints", () => {
  const insertRaw = (body: string) =>
    serviceClient().from("comments").insert({ spot_id: spotId, profile_id: null, body });

  it("refuses a body of only spaces", async () => {
    const { error } = await insertRaw("   ");
    expect(error?.code).toBe("23514");
  });

  // The original constraint was `length(trim(body)) > 0`, and Postgres trim()
  // strips spaces only — so this passed, and any signed-in user could POST a
  // newline straight to PostgREST for a blank comment that still bumped
  // comment_count and the spot's score.
  it("refuses a body of only tabs and newlines", async () => {
    const { error } = await insertRaw("\n\t\n");
    expect(error?.code).toBe("23514");
  });

  it("still accepts a body with real text in it, whitespace and all", async () => {
    const { error } = await insertRaw("  it is fine  ");
    expect(error).toBeNull();
  });

  // MAX_COMMENT_LENGTH is the product limit and lives in TypeScript. This is
  // the abuse ceiling and lives here, because a limit only the app enforces is
  // not a limit: `body` is unconstrained text and would otherwise take 1GB.
  it("refuses a body past the abuse ceiling", async () => {
    const { error } = await insertRaw("x".repeat(10_001));
    expect(error?.code).toBe("23514");
  });

  it("leaves comfortable room above the product limit", async () => {
    const { error } = await insertRaw("x".repeat(MAX_COMMENT_LENGTH + 1));
    expect(error).toBeNull();
  });
});
