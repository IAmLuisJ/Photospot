import { redirect } from "react-router";
import { getRequestContext } from "~/lib/request-context.server";
import type { Route } from "./+types/auth.logout";
export async function action({ request, context }: Route.ActionArgs) {
  const { auth, env, headers } = await getRequestContext(request, context);
  const forward = new Headers(request.headers);
  forward.set("Content-Type", "application/json");
  forward.delete("Content-Length");
  const response = await auth.handler(
    new Request(`${env.authOrigin}/api/auth/sign-out`, {
      method: "POST",
      headers: forward,
      body: "{}",
    }),
  );
  for (const cookie of response.headers.getSetCookie())
    headers.append("Set-Cookie", cookie);
  if (!response.ok)
    throw new Response("Could not sign out", {
      status: response.status,
      headers,
    });
  return redirect("/", { headers });
}
export function loader() {
  return redirect("/");
}
