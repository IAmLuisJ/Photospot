import { Form, data, redirect, useActionData } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import type { Route } from "./+types/auth.login";

/**
 * Every return path carries `headers`.
 *
 * signInWithOtp starts a PKCE exchange and writes a code_verifier cookie
 * through the client's setAll. Returning a bare object drops those headers, the
 * verifier never reaches the browser, and /auth/callback then fails to exchange
 * the code — the login silently does nothing. Bare returns are only safe on
 * paths that touched no Supabase state at all.
 */
export async function action({ request }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const origin = new URL(request.url).origin;

  if (intent === "google") {
    const { data: oauth, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback` },
    });
    if (error) return data({ error: error.message }, { headers });
    return redirect(oauth.url, { headers });
  }

  if (intent === "magic-link") {
    const email = String(form.get("email") ?? "").trim();
    if (!email) return data({ error: "Enter an email address." }, { headers });

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) return data({ error: error.message }, { headers });
    return data({ sent: true }, { headers });
  }

  return data({ error: "Unknown sign-in method." }, { headers });
}

export default function Login() {
  const result = useActionData<typeof action>();

  return (
    <main>
      <h1>Sign in to Photospots</h1>
      <p>Browsing is open to everyone. Signing in lets you add spots, vote, and comment.</p>

      <Form method="post">
        <button type="submit" name="intent" value="google">
          Continue with Google
        </button>
      </Form>

      <Form method="post">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
        <button type="submit" name="intent" value="magic-link">
          Email me a sign-in link
        </button>
      </Form>

      {result && "sent" in result && result.sent ? (
        <p role="status">Check your email for a sign-in link.</p>
      ) : null}
      {result && "error" in result && result.error ? (
        <p role="alert">{result.error}</p>
      ) : null}
    </main>
  );
}
