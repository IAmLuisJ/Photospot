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

  // The database has `check (length(trim(body)) > 0)`, so whitespace-only text
  // fails there too — but as a 23514 the user never sees explained.
  it("rejects whitespace-only text, matching the database check", () => {
    expect(validateComment("   \n\t ").errors).toHaveLength(1);
  });

  it(`accepts a comment of exactly ${MAX_COMMENT_LENGTH} characters`, () => {
    expect(validateComment("x".repeat(MAX_COMMENT_LENGTH)).errors).toEqual([]);
  });

  it("rejects one character past the limit", () => {
    expect(validateComment("x".repeat(MAX_COMMENT_LENGTH + 1)).errors).toHaveLength(1);
  });

  // The trim is what the data layer will store, so the limit has to be measured
  // on the same string. Otherwise padding a body with spaces changes whether it
  // is accepted without changing what gets saved.
  it("measures the length after trimming", () => {
    const padded = `  ${"x".repeat(MAX_COMMENT_LENGTH)}  `;
    expect(validateComment(padded).errors).toEqual([]);
  });
});
