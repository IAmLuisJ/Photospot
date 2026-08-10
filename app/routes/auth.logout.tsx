import { redirect } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import type { Route } from "./+types/auth.logout";

export async function action({ request }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  await supabase.auth.signOut();
  return redirect("/", { headers });
}

export async function loader() {
  return redirect("/");
}
