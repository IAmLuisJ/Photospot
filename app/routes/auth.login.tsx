import {
  Form,
  Link,
  data,
  redirect,
  useActionData,
  useNavigation,
} from "react-router";
import { getRequestContext } from "~/lib/request-context.server";
import { getCurrentProfile } from "~/data/profiles";
import { exploreReturnTo, loginPath, safeReturnTo } from "~/lib/navigation";
import { Icon } from "~/components/Icon";
import type { Route } from "./+types/auth.login";

export async function loader({ request, context, url }: Route.LoaderArgs) {
  const { env, headers, store } = await getRequestContext(request, context);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const profile = await getCurrentProfile(store);
  if (profile) throw redirect(returnTo, { headers });
  return data(
    {
      googleEnabled: Boolean(env.googleClientId),
      emailEnabled: Boolean(env.resendApiKey && env.emailFrom),
      returnTo,
      profile,
    },
    { headers },
  );
}
export async function action({ request, context, url }: Route.ActionArgs) {
  const { auth, headers, env } = await getRequestContext(request, context);
  const form = await request.formData();
  const returnTo = safeReturnTo(
    form.get("returnTo") ?? url.searchParams.get("returnTo"),
  );
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
      ? { provider: "google", callbackURL: returnTo }
      : { email, callbackURL: returnTo };
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
  return data({ sent: true, email }, { headers });
}
export function meta() {
  return [{ title: "Sign in — Photospots" }];
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  const sent = result && "sent" in result && result.sent;
  const contribution = loaderData.returnTo.startsWith("/submit");
  const back = exploreReturnTo(
    loaderData.returnTo === "/" || loaderData.returnTo.startsWith("/?")
      ? loaderData.returnTo
      : new URL(
          loaderData.returnTo,
          "https://photospots.invalid",
        ).searchParams.get("from"),
  );
  return (
    <main id="main-content" className="auth-page">
      <Link className="back-link" to={back}>
        <Icon name="back" />
        Back to exploring
      </Link>
      <div className="auth-page__layout">
        <div className="auth-page__intro">
          <p className="eyebrow">Out there is better, together.</p>
          <h2 className="auth-page__title">
            Good places.
            <br />
            <em>Shared by you.</em>
          </h2>
          <p>
            Share a favorite location, swap field notes, and help the next
            photographer find their spot.
          </p>
          <p className="auth-page__open">
            Just looking?{" "}
            <Link to={back}>
              Explore without an account
              <Icon name="arrow" />
            </Link>
          </p>
        </div>
        <section className="auth-panel" aria-labelledby="signin-title">
          {sent ? (
            <div role="status">
              <Icon name="mail" />
              <h1 id="signin-title">Check your inbox.</h1>
              <p>
                We sent a sign-in link to{" "}
                <strong>
                  {"email" in result ? result.email : "your email"}
                </strong>
                . Open it to pick up where you left off.
              </p>
              <Link
                className="text-button"
                reloadDocument
                to={loginPath(loaderData.returnTo)}
              >
                Use another email
              </Link>
            </div>
          ) : (
            <>
              <p className="eyebrow">Welcome to Photospots</p>
              <h1 id="signin-title">
                {contribution
                  ? "Sign in to share this spot."
                  : "A little hello. Then you’re in."}
              </h1>
              <p>
                {contribution
                  ? "Your chosen pin will be waiting."
                  : "No password to remember. We’ll send you a sign-in link."}
              </p>
              {loaderData.googleEnabled && (
                <Form method="post">
                  <input
                    type="hidden"
                    name="returnTo"
                    value={loaderData.returnTo}
                  />
                  <button
                    className="button button--secondary"
                    type="submit"
                    name="intent"
                    value="google"
                    disabled={pending}
                  >
                    Continue with Google
                  </button>
                </Form>
              )}
              {loaderData.googleEnabled && loaderData.emailEnabled && (
                <div className="auth-divider">or use email</div>
              )}
              {loaderData.emailEnabled && (
                <Form method="post" className="auth-form">
                  <input
                    type="hidden"
                    name="returnTo"
                    value={loaderData.returnTo}
                  />
                  <label htmlFor="email">
                    Your email
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                    />
                  </label>
                  <button
                    className="button"
                    type="submit"
                    name="intent"
                    value="magic-link"
                    disabled={pending}
                  >
                    {pending ? "Sending your link…" : "Send sign-in link"}
                    <Icon name="arrow" />
                  </button>
                </Form>
              )}
              {!loaderData.googleEnabled && !loaderData.emailEnabled && (
                <p role="status">
                  Sign-in is temporarily unavailable.{" "}
                  <Link to={back}>You can still explore locations.</Link>
                </p>
              )}
              {result && "error" in result && result.error && (
                <p className="auth-error" role="alert">
                  {result.error}
                </p>
              )}
              {loaderData.emailEnabled && (
                <p className="auth-panel__note">
                  New here? Your first sign-in creates your account.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
