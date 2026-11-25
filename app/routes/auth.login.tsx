import { Form, data, redirect, useActionData } from "react-router";
import { getRequestContext } from "~/lib/request-context.server";
import type { Route } from "./+types/auth.login";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, headers } = await getRequestContext(request, context);
  return data(
    {
      googleEnabled: Boolean(env.googleClientId),
      emailEnabled: Boolean(env.resendApiKey && env.emailFrom),
    },
    { headers },
  );
}
export async function action({ request, context }: Route.ActionArgs) {
  const { auth, headers, env } = await getRequestContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (!["google", "magic-link"].includes(intent))
    return data({ error: "Unknown sign-in method." }, { headers, status: 400 });
  const email = String(form.get("email") ?? "").trim();
  if (intent === "magic-link" && !email)
    return data({ error: "Enter an email address." }, { headers, status: 400 });
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.set("Content-Type", "application/json");
  forwardHeaders.delete("Content-Length");
  const endpoint =
    intent === "google" ? "sign-in/social" : "sign-in/magic-link";
  const body =
    intent === "google"
      ? { provider: "google", callbackURL: "/" }
      : { email, callbackURL: "/" };
  const response = await auth.handler(
    new Request(`${env.authOrigin}/api/auth/${endpoint}`, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify(body),
    }),
  );
  for (const cookie of response.headers.getSetCookie())
    headers.append("Set-Cookie", cookie);
  if (!response.ok)
    return data(
      { error: "Could not start sign-in. Please try again." },
      { headers, status: response.status },
    );
  if (intent === "google") {
    const result = (await response.json()) as { url?: string };
    if (!result.url)
      return data(
        { error: "Google sign-in is unavailable." },
        { headers, status: 503 },
      );
    return redirect(result.url, { headers });
  }
  return data({ sent: true }, { headers });
}
export default function Login({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  return (
    <main>
      <h1>Sign in to Photospots</h1>
      <p>
        Browsing is open to everyone. Signing in lets you add spots, vote, and
        comment.
      </p>
      {loaderData.googleEnabled && (
        <Form method="post">
          <button type="submit" name="intent" value="google">
            Continue with Google
          </button>
        </Form>
      )}
      {loaderData.emailEnabled && (
        <Form method="post">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
          />
          <button type="submit" name="intent" value="magic-link">
            Email me a sign-in link
          </button>
        </Form>
      )}
      {!loaderData.googleEnabled && !loaderData.emailEnabled && (
        <p>
          Sign-in is temporarily unavailable. You can still explore the map.
        </p>
      )}
      {result && "sent" in result && result.sent ? (
        <p role="status">Check your email for a sign-in link.</p>
      ) : null}
      {result && "error" in result && result.error ? (
        <p role="alert">{result.error}</p>
      ) : null}
    </main>
  );
}
