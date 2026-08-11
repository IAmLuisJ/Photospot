import { useFetcher } from "react-router";
import { actionsFor, labelForReason, type ResolutionAction } from "~/domain/reports/reasons";
import type { QueuedReport } from "~/data/reports";

const ACTION_LABELS: Record<ResolutionAction, string> = {
  hide: "Hide",
  remove: "Remove",
  dismiss: "Dismiss",
};

export function queueSummary(report: QueuedReport): string {
  const title = report.targetTitle ?? `(deleted ${report.targetType})`;
  const state =
    report.targetStatus && report.targetStatus !== "published"
      ? ` — already ${report.targetStatus}`
      : "";
  return `${report.targetType}: ${title} · ${labelForReason(report.reason)}${state}`;
}

/**
 * Whether the destructive actions apply. A closed report must not be
 * re-resolved, and a report whose target has been deleted cannot be hidden or
 * removed — but it must still be dismissable, or it sits in the queue forever
 * with no way to clear it. See availableActions, which encodes that.
 */
export function isActionable(report: QueuedReport): boolean {
  return report.status === "open" && report.targetTitle !== null;
}

/**
 * `reports.target_id` is polymorphic with no foreign key, so a deleted spot
 * leaves its reports pointing at nothing. Those keep exactly one action —
 * dismiss — because the queue has to be clearable even when the thing being
 * complained about is already gone.
 */
export function availableActions(report: QueuedReport): ResolutionAction[] {
  if (report.status !== "open") return [];
  if (report.targetTitle === null) return ["dismiss"];
  return actionsFor(report.targetType);
}

export function ReportRow({ report }: { report: QueuedReport }) {
  const fetcher = useFetcher<{ error?: string }>();
  const actions = availableActions(report);
  const busy = fetcher.state !== "idle";

  return (
    <li className="report-row" data-status={report.status}>
      <p className="report-row__summary">{queueSummary(report)}</p>
      {report.note && <p className="report-row__note">“{report.note}”</p>}
      <p className="report-row__meta">
        {report.status} · {report.createdAt.slice(0, 10)}
      </p>

      {actions.length > 0 && (
        <fetcher.Form method="post" className="report-row__actions">
          <input type="hidden" name="reportId" value={report.id} />
          {actions.map((action) => (
            <button key={action} type="submit" name="action" value={action} disabled={busy}>
              {ACTION_LABELS[action]}
            </button>
          ))}
        </fetcher.Form>
      )}

      {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
    </li>
  );
}
