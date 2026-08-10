import type { FieldError, ValidationResult } from "../spots/submission";

/**
 * Long enough for a paragraph of practical advice about a location, short
 * enough that the comment list stays readable. The database has no length
 * constraint, so this is the only limit — deliberately, since it is the kind of
 * number that gets tuned from feedback and a migration is a poor place for that.
 */
export const MAX_COMMENT_LENGTH = 2000;

/**
 * Deliberately stricter than the database's `check (length(trim(body)) > 0)`:
 * Postgres `trim()` strips spaces only, while this strips all Unicode
 * whitespace, so text such as `"\n\t"` passes the database check but is
 * rejected here. That gap means the database currently accepts blank-looking
 * comments through a direct API call that never goes through this function;
 * closing it is tracked as a schema fix in a later task. Until then, this
 * exists so a user going through the app is told what is wrong in words
 * rather than seeing a 23514 — it is not a mirror of the database check.
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
