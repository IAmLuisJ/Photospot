import type { RouterContextProvider } from "react-router";
import { createAuth } from "./auth.server";
import { readEnv, type AuthEnvironment } from "./env.server";
import { appRequestContext } from "./runtime-context";
import type { DataContext } from "../data/context";

export async function createRequestContext(
  request: Request,
  bindings: AuthEnvironment,
) {
  const env = readEnv(bindings);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.headers.get("Origin") !== env.authOrigin
  ) {
    throw new Response("Invalid request origin", { status: 403 });
  }
  const auth = createAuth(bindings);
  const { headers, response: session } = await auth.api.getSession({
    headers: request.headers,
    returnHeaders: true,
  });
  const profile = session
    ? await bindings.DB.prepare("SELECT role FROM profiles WHERE id=?")
        .bind(session.user.id)
        .first<{ role: "user" | "admin" }>()
    : null;
  const store: DataContext = {
    db: bindings.DB,
    viewer:
      session && profile
        ? {
            id: session.user.id,
            email: session.user.email,
            emailVerified: session.user.emailVerified,
            role: profile.role,
          }
        : null,
  };
  return { store, headers, env, auth };
}
export type AppRequestContext = Awaited<
  ReturnType<typeof createRequestContext>
>;
export function getRequestContext(
  _request: Request,
  context: Readonly<RouterContextProvider>,
) {
  return context.get(appRequestContext)();
}
