import type { FieldError, ValidationResult } from "../spots/submission";

/**
 * Long enough for a paragraph of practical advice about a location, short
 * enough that the comment list stays readable. The database has no length
 * constraint, so this is the only limit — deliberately, since it is the kind of
 * number that gets tuned from feedback and a migration is a poor place for that.
 */
export const MAX_COMMENT_LENGTH = 2000;

/**
 * The blank check here and `comments_body_not_blank` in migration 10 agree:
 * both mean "contains at least one non-whitespace character". They are two
 * expressions of one rule rather than one guarding the other — the database is
 * the authority, and this exists so a user going through the app is told what
 * is wrong in words instead of seeing a 23514.
 *
 * They agree on every character anyone will type, and disagree on exactly two,
 * measured code point by code point rather than assumed: a body of only U+FEFF
 * is rejected here and accepted there, and a body of only U+0085 is accepted
 * here and rejected there. Migration 10 has the detail and the reasoning.
 *
 * The length limit is deliberately *not* mirrored. MAX_COMMENT_LENGTH is a
 * product number that feedback will move; the database carries a much larger
 * abuse ceiling instead, so the two cannot disagree in a way a user notices.
 */
export function validateComment(body: string): ValidationResult {
  const errors: FieldError[] = [];
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    errors.push({ field: "body", message: "Write something first." });
  } else if (trimmed.length > MAX_COMMENT_LENGTH) {
    errors.push({
      field: "body",
      message: `Keep it under ${MAX_COMMENT_LENGTH} characters.`,
    });
  }

  return { errors };
}
