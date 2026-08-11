import { useFetcher } from "react-router";
import { REPORT_REASONS, isReportReason, type ReportTarget } from "~/domain/reports/reasons";

const TARGETS: readonly string[] = ["spot", "photo", "comment"];

export interface ReportIntent {
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  note: string | null;
}

/**
 * Reads a report submission out of the form, or null if this is not one.
 *
 * Validates the target type as well as the reason: `target_type` is a Postgres
 * enum, so a bad value is a 22P02 the user cannot act on, and `reason` is free
 * text, so a bad value is stored forever and renders as itself in the queue.
 * The action is a public endpoint, so neither can be taken on trust.
 */
export function reportIntentFrom(formData: FormData | undefined): ReportIntent | null {
  if (formData?.get("intent") !== "report") return null;

  const targetType = String(formData.get("targetType") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!TARGETS.includes(targetType) || targetId === "" || !isReportReason(reason)) return null;

  const note = String(formData.get("note") ?? "").trim();
  return {
    targetType: targetType as ReportTarget,
    targetId,
    reason,
    note: note === "" ? null : note,
  };
}

/**
 * Deliberately promises nothing. The reporter is told it arrived, not that
 * anything will happen — an admin may well dismiss it.
 */
export const reportConfirmation = (): string =>
  "Thank you — this has been logged for a moderator to look at.";

export function ReportButton({
  targetType,
  targetId,
  signedIn,
}: {
  targetType: ReportTarget;
  targetId: string;
  signedIn: boolean;
}) {
  const fetcher = useFetcher<{ error?: string; reported?: boolean }>();
  if (!signedIn) return null;

  if (fetcher.data?.reported) return <p className="report__done">{reportConfirmation()}</p>;

  return (
    <details className="report">
      <summary>Report</summary>
      <fetcher.Form method="post" className="report__form">
        <input type="hidden" name="intent" value="report" />
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="targetId" value={targetId} />
        <label>
          What is wrong?
          <select name="reason" required defaultValue="">
            <option value="" disabled>
              Pick a reason
            </option>
            {REPORT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Anything else? (optional)
          <textarea name="note" rows={2} />
        </label>
        {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
        <button type="submit">Send report</button>
      </fetcher.Form>
    </details>
  );
}
