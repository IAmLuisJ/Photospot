import { createAuth } from "../lib/auth.server";
import { runtimeContext } from "../lib/runtime-context";
import type { Route } from "./+types/api.auth";

export function loader({ request, context }: Route.LoaderArgs) {
  return createAuth(context.get(runtimeContext).env).handler(request);
}
export function action({ request, context }: Route.ActionArgs) {
  const env = context.get(runtimeContext).env;
  if (request.headers.get("Origin") !== new URL(env.AUTH_ORIGIN).origin) {
    return new Response("Invalid request origin", { status: 403 });
  }
  return createAuth(env).handler(request);
}
