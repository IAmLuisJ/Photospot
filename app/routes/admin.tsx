import { loginPath } from "~/lib/navigation";
import { Link, redirect, data as routeData } from "react-router";
import { getRequestContext } from "~/lib/request-context.server";
import { getCurrentProfile } from "~/data/profiles";
import {
  listReportQueue,
  resolveReport,
  ReportConflictError,
} from "~/data/reports";
import { ReportRow } from "~/components/admin/ReportRow";
import type { ResolutionAction } from "~/domain/reports/reasons";
import type { Route } from "./+types/admin";

export function meta() {
  return [{ title: "Reports — Photospots" }];
}

const ACTIONS: readonly string[] = ["hide", "remove", "dismiss"];

export async function loader({ request, context, url }: Route.LoaderArgs) {
  const { store, headers, env } = await getRequestContext(request, context);
  const profile = await getCurrentProfile(store);
  if (!profile) {
    throw redirect(loginPath(url.pathname + url.search), { headers });
  }

  try {
    const reports = await listReportQueue(store);
    return routeData({ reports, profile }, { headers });
  } catch {
    // admin_report_queue raises for a non-admin rather than returning nothing,
    // which is the whole reason it is a function and not a view: an empty
    // queue and a forbidden one would otherwise look identical.
    throw new Response("Not an admin", { status: 403, headers });
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const { store, headers, env } = await getRequestContext(request, context);
  const profile = await getCurrentProfile(store);
  if (!profile) {
    return routeData({ error: "Sign in first." }, { headers, status: 401 });
  }

  const form = await request.formData();
  const reportId = String(form.get("reportId") ?? "");
  const action = String(form.get("action") ?? "");

  if (reportId === "" || !ACTIONS.includes(action)) {
    return routeData(
      { error: "That action was not understood." },
      { headers, status: 400 },
    );
  }

  try {
    // The command rechecks admin role and report state in the mutation.
    await resolveReport(store, reportId, action as ResolutionAction);
  } catch (err) {
    return routeData(
      {
        error:
          err instanceof Error ? err.message : "Could not resolve that report.",
      },
      { headers, status: err instanceof ReportConflictError ? 409 : 403 },
    );
  }

  return routeData({ ok: true }, { headers });
}

export default function AdminQueue({ loaderData }: Route.ComponentProps) {
  const { reports } = loaderData;
  const open = reports.filter((r) => r.status === "open");

  return (
    <main id="main-content" className="admin">
      <p>
        <Link to="/">← Back to the map</Link>
      </p>
      <h1>Reports</h1>
      <p className="admin__count">
        {open.length === 0
          ? "Nothing open."
          : `${open.length} open ${open.length === 1 ? "report" : "reports"}.`}
      </p>

      {reports.length === 0 ? (
        <p>No reports have ever been filed.</p>
      ) : (
        <ul className="admin__list">
          {reports.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </ul>
      )}
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main id="main-content" className="admin">
      <h1>Not available</h1>
      <p>This page is for moderators.</p>
      <p>
        <Link to="/">← Back to the map</Link>
      </p>
    </main>
  );
}
