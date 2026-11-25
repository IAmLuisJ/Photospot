import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins/magic-link";
import { readEnv, type AuthEnvironment } from "./env.server";

export function createAuth(bindings: AuthEnvironment) {
  const env = readEnv(bindings);
  return betterAuth({
    appName: "Photospots",
    database: bindings.DB,
    baseURL: env.authOrigin,
    secret: env.authSecret,
    trustedOrigins: [env.authOrigin],
    telemetry: { enabled: false },
    advanced: {
      disableCSRFCheck: false,
      disableOriginCheck: false,
      database: { generateId: () => crypto.randomUUID() },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    socialProviders:
      env.googleClientId && env.googleClientSecret
        ? {
            google: {
              clientId: env.googleClientId,
              clientSecret: env.googleClientSecret,
            },
          }
        : {},
    // A persistent database limiter works across isolates. In-memory counters
    // on a Worker would reset whenever requests reach another isolate.
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        storeToken: "hashed",
        async sendMagicLink({ email, url }) {
          if (!env.resendApiKey || !env.emailFrom)
            throw new Error("Sign-in email is not configured.");
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: env.emailFrom,
              to: [email],
              subject: "Sign in to Photospots",
              text: `Sign in to Photospots:\n${url}\n\nThis link expires in 10 minutes. If you did not request it, you can ignore this email.`,
            }),
          });
          if (!response.ok)
            throw new Error(
              `Sign-in email delivery failed (${response.status}).`,
            );
          await response.body?.cancel();
        },
      }),
    ],
  });
}
