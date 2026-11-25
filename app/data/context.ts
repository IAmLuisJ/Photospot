/** Only request-context.server may construct a viewer from an authenticated session. */
export interface Viewer {
  id: string;
  email: string;
  emailVerified: boolean;
  role: "user" | "admin";
}

export interface DataContext {
  db: D1Database;
  viewer: Viewer | null;
}

export class AccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404 = 403,
  ) {
    super(message);
  }
}

export function requireViewer(context: DataContext): Viewer {
  if (!context.viewer) throw new AccessError("Must be signed in.", 401);
  return context.viewer;
}

export function requireAdmin(context: DataContext): Viewer {
  const viewer = requireViewer(context);
  if (viewer.role !== "admin")
    throw new AccessError("Only an admin may do that.");
  return viewer;
}

export async function requirePublishedSpot(
  context: DataContext,
  spotId: string,
): Promise<void> {
  if (
    !(await context.db
      .prepare("SELECT id FROM spots WHERE id = ? AND status = 'published'")
      .bind(spotId)
      .first())
  ) {
    throw new AccessError("Spot not found.", 404);
  }
}

export function httpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Use an HTTP or HTTPS URL.");
  return url.toString();
}
