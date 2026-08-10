import { describe, it, expect } from "vitest";
import { validateComment, MAX_COMMENT_LENGTH } from "./comment";

describe("validateComment", () => {
  it("accepts an ordinary comment", () => {
    expect(validateComment("Golden hour here is unreal in October.").errors).toEqual([]);
  });

  it("rejects an empty body", () => {
    const { errors } = validateComment("");
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("body");
  });

  // JS `.trim()` strips all Unicode whitespace, which is stricter than the
  // database's `trim()` (Postgres strips spaces only, so `"\n\t"` alone
  // passes the database's check). This is testing that property of this
  // function, not parity with the database — see comment.ts for the gap.
  it("rejects text that is whitespace only, including tabs and newlines", () => {
    expect(validateComment("   \n\t ").errors).toHaveLength(1);
  });

  it(`accepts a comment of exactly ${MAX_COMMENT_LENGTH} characters`, () => {
    expect(validateComment("x".repeat(MAX_COMMENT_LENGTH)).errors).toEqual([]);
  });

  it("rejects one character past the limit, on the body field", () => {
    expect(validateComment("x".repeat(MAX_COMMENT_LENGTH + 1)).errors).toContainEqual({
      field: "body",
      message: expect.any(String),
    });
  });

  // The trim is what the data layer will store, so the limit has to be measured
  // on the same string. Otherwise padding a body with spaces changes whether it
  // is accepted without changing what gets saved.
  it("measures the length after trimming", () => {
    const padded = `  ${"x".repeat(MAX_COMMENT_LENGTH)}  `;
    expect(validateComment(padded).errors).toEqual([]);
  });
});
