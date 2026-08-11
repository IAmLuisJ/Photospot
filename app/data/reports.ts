import type { SupabaseClient } from "@supabase/supabase-js";
import { isReportReason, type ReportTarget, type ResolutionAction } from "../domain/reports/reasons";

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
  /** Null when the target has been deleted — the report is still dismissable. */
  targetTitle: string | null;
  targetStatus: string | null;
  reason: string;
  note: string | null;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
}

/**
 * `profile_id` is checked by RLS (`reports_insert with check (profile_id =
 * auth.uid())`), so passing someone else's id fails at the database rather
 * than being trusted here.
 *
 * The reason is validated before the insert because `reports.reason` is free
 * text in the schema — the database will happily store anything, and an
 * unrecognised value renders as itself in the queue forever.
 */
export async function fileReport(supabase: SupabaseClient, report: NewReport): Promise<void> {
  if (!isReportReason(report.reason)) {
    throw new Error(`Unknown report reason: ${report.reason}`);
  }

  const { error } = await supabase.from("reports").insert({
    target_type: report.targetType,
    target_id: report.targetId,
    profile_id: report.profileId,
    reason: report.reason,
    // A whitespace-only note is no note, not an empty string to store.
    note: report.note?.trim() || null,
  });

  if (error) throw error;
}

interface QueueRow {
  id: string;
  target_type: ReportTarget;
  target_id: string;
  target_title: string | null;
  target_status: string | null;
  reason: string;
  note: string | null;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
}

/**
 * Throws for a non-admin rather than returning an empty list: an empty queue
 * and a forbidden one look identical to a caller, and the difference is what
 * decides whether to render an admin surface at all.
 */
export async function listReportQueue(supabase: SupabaseClient): Promise<QueuedReport[]> {
  const { data, error } = await supabase.rpc("admin_report_queue");
  if (error) throw error;

  return ((data ?? []) as QueueRow[]).map((row) => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: row.target_title,
    targetStatus: row.target_status,
    reason: row.reason,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/** Target status and report closure move together — see migration 14. */
export async function resolveReport(
  supabase: SupabaseClient,
  reportId: string,
  action: ResolutionAction,
): Promise<void> {
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: reportId,
    p_action: action,
  });
  if (error) throw error;
}
