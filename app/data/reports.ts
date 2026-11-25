import {
  isReportReason,
  type ReportTarget,
  type ResolutionAction,
} from "../domain/reports/reasons";
import { requireAdmin, requireViewer, type DataContext } from "./context";
export interface NewReport {
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  note: string | null;
  profileId: string;
}
export interface QueuedReport {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  targetTitle: string | null;
  targetStatus: string | null;
  reason: string;
  note: string | null;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
}
const TARGET_TABLES = {
  spot: "spots",
  photo: "photos",
  comment: "comments",
} as const;

export class ReportConflictError extends Error {
  constructor() {
    super(
      "This report has already changed. Reload the queue before resolving it.",
    );
  }
}
export async function fileReport(
  context: DataContext,
  report: NewReport,
): Promise<void> {
  const viewer = requireViewer(context);
  if (report.profileId !== viewer.id)
    throw new Error("Cannot file a report as another user.");
  if (
    !isReportReason(report.reason) ||
    !Object.hasOwn(TARGET_TABLES, report.targetType)
  )
    throw new Error("Unknown report reason or target.");
  const targetTable = TARGET_TABLES[report.targetType];
  const visible =
    report.targetType === "spot"
      ? "target.status='published'"
      : "target.status='published' AND EXISTS(SELECT 1 FROM spots WHERE id=target.spot_id AND status='published')";
  const result = await context.db
    .prepare(
      `INSERT INTO reports(id,target_type,target_id,profile_id,reason,note)
    SELECT ?,?,id,?,?,? FROM ${targetTable} target WHERE id=? AND ${visible}`,
    )
    .bind(
      crypto.randomUUID(),
      report.targetType,
      viewer.id,
      report.reason,
      report.note?.trim() || null,
      report.targetId,
    )
    .run();
  if (!result.meta.changes) throw new Error("Report target not found.");
}
export async function listReportQueue(
  context: DataContext,
): Promise<QueuedReport[]> {
  const viewer = requireAdmin(context);
  return (
    await context.db
      .prepare(
        `SELECT r.id,r.target_type AS targetType,r.target_id AS targetId,r.reason,r.note,r.status,r.created_at AS createdAt,
    CASE r.target_type WHEN 'spot' THEN s.name WHEN 'photo' THEN p.storage_path WHEN 'comment' THEN substr(c.body,1,120) END AS targetTitle,
    CASE r.target_type WHEN 'spot' THEN s.status WHEN 'photo' THEN p.status WHEN 'comment' THEN c.status END AS targetStatus
    FROM reports r LEFT JOIN spots s ON r.target_type='spot' AND s.id=r.target_id
    LEFT JOIN photos p ON r.target_type='photo' AND p.id=r.target_id LEFT JOIN comments c ON r.target_type='comment' AND c.id=r.target_id
    WHERE EXISTS(SELECT 1 FROM profiles WHERE id=? AND role='admin') ORDER BY (r.status='open') DESC,r.created_at DESC,r.id`,
      )
      .bind(viewer.id)
      .all<QueuedReport>()
  ).results;
}
export async function resolveReport(
  context: DataContext,
  reportId: string,
  action: ResolutionAction,
): Promise<void> {
  const viewer = requireAdmin(context);
  if (!["hide", "remove", "dismiss"].includes(action))
    throw new Error("Unknown resolution action.");
  const report = await context.db
    .prepare("SELECT target_type,target_id,status FROM reports WHERE id=?")
    .bind(reportId)
    .first<{ target_type: ReportTarget; target_id: string; status: string }>();
  if (!report) throw new Error("No such report.");
  if (report.status !== "open") throw new ReportConflictError();
  if (action === "hide" && report.target_type !== "spot")
    throw new Error("Only a spot can be hidden.");
  const adminGuard =
    "EXISTS(SELECT 1 FROM profiles WHERE id=? AND role='admin')";
  if (action === "dismiss") {
    const result = await context.db
      .prepare(
        `UPDATE reports SET status='dismissed',resolved_by=? WHERE id=? AND status='open' AND ${adminGuard}`,
      )
      .bind(viewer.id, reportId, viewer.id)
      .run();
    if (!result.meta.changes) throw new ReportConflictError();
    return;
  }
  const table = TARGET_TABLES[report.target_type];
  const status = action === "hide" ? "hidden" : "removed";
  const target = await context.db
    .prepare(`SELECT id FROM ${table} WHERE id=?`)
    .bind(report.target_id)
    .first();
  if (!target) throw new Error("Target deleted; dismiss this report instead.");
  const [, resolved] = await context.db.batch([
    context.db
      .prepare(
        `UPDATE ${table} SET status=? WHERE id=? AND ${adminGuard} AND EXISTS(SELECT 1 FROM reports WHERE id=? AND status='open')`,
      )
      .bind(status, report.target_id, viewer.id, reportId),
    context.db
      .prepare(
        `UPDATE reports SET status='resolved',resolved_by=? WHERE id=? AND status='open' AND ${adminGuard}
      AND EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status=?)`,
      )
      .bind(viewer.id, reportId, viewer.id, report.target_id, status),
  ]);
  if (!resolved.meta.changes) throw new ReportConflictError();
}
