import { redirect } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import type { Route } from "./+types/auth.callback";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const { supabase, headers } = createSupabaseServerClient(request);

  if (!code) {
    return redirect("/auth/login?error=missing-code", { headers });
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirect("/auth/login?error=exchange-failed", { headers });
  }

  // Headers carry the session cookies; dropping them silently loses the login.
  return redirect("/", { headers });
}
