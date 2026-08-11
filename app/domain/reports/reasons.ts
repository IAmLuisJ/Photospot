/** Mirrors the `public.report_target` enum. */
export type ReportTarget = "spot" | "photo" | "comment";

/** What an admin can do about a report. `hide` is spot-only — see actionsFor. */
export type ResolutionAction = "hide" | "remove" | "dismiss";

export interface ReportReason {
  value: string;
  label: string;
}

/**
 * `reports.reason` is free text in the schema, so this is the only vocabulary
 * there is — the same drift risk the accessibility columns had before plan 5
 * pinned them. Kept in the domain layer because the reason list is expected to
 * change from what people actually report, which is a poor fit for a migration.
 *
 * `rights` is not optional: spec §4.3 requires a working takedown path from day
 * one, and these are photographs of real families.
 */
export const REPORT_REASONS: readonly ReportReason[] = Object.freeze([
  { value: "rights", label: "It is my photo and I did not agree to this" },
  { value: "private_land", label: "This is private property" },
  { value: "unsafe", label: "Going here is unsafe" },
  { value: "wrong_place", label: "The pin or the details are wrong" },
  { value: "spam", label: "Spam or advertising" },
  { value: "abuse", label: "Abusive or offensive" },
]);

export const isReportReason = (value: string): boolean =>
  REPORT_REASONS.some((r) => r.value === value);

/** Falls back to the raw value so a renamed reason does not blank an old report. */
export const labelForReason = (value: string): string =>
  REPORT_REASONS.find((r) => r.value === value)?.label ?? value;

/**
 * `spots.status` is `spot_status` (published | hidden | removed) but
 * `photos.status` and `comments.status` are `content_status`
 * (published | removed). Hiding a comment is not a state the column can hold,
 * so the queue must not offer it.
 */
export function actionsFor(target: ReportTarget): ResolutionAction[] {
  return target === "spot" ? ["hide", "remove", "dismiss"] : ["remove", "dismiss"];
}
