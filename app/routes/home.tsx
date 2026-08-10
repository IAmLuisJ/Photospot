import { Form, Link } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { getCurrentProfile } from "~/data/profiles";
import type { Route } from "./+types/home";

export async function loader({ request }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const profile = await getCurrentProfile(supabase);
  return Response.json({ profile }, { headers });
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { profile } = loaderData as { profile: { displayName: string } | null };

  return (
    <main>
      <h1>Photospots</h1>
      {profile ? (
        <>
          <p>Signed in as {profile.displayName}.</p>
          <Form method="post" action="/auth/logout">
            <button type="submit">Sign out</button>
          </Form>
        </>
      ) : (
        <Link to="/auth/login">Sign in</Link>
      )}
    </main>
  );
}
