import { z } from "zod";
export const DEFAULT_MAP_STYLE_URL =
  "https://demotiles.maplibre.org/style.json";
const optional = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const schema = z.object({
  AUTH_ORIGIN: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  RESEND_API_KEY: optional,
  AUTH_EMAIL_FROM: optional,
  MAP_STYLE_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),
});
export type AuthEnvironment = {
  DB: D1Database;
  AUTH_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  MAP_STYLE_URL?: string;
};
export function readEnv(source: Record<string, unknown>) {
  const parsed = schema.safeParse(source);
  if (!parsed.success)
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  const p = parsed.data;
  const origin = new URL(p.AUTH_ORIGIN);
  if (origin.origin !== p.AUTH_ORIGIN.replace(/\/$/, ""))
    throw new Error("AUTH_ORIGIN must be an origin without a path.");
  if (
    origin.protocol !== "https:" &&
    !(
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
    )
  )
    throw new Error("AUTH_ORIGIN requires HTTPS outside localhost.");
  if (Boolean(p.GOOGLE_CLIENT_ID) !== Boolean(p.GOOGLE_CLIENT_SECRET))
    throw new Error(
      "Configure both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  return {
    authOrigin: origin.origin,
    authSecret: p.BETTER_AUTH_SECRET,
    googleClientId: p.GOOGLE_CLIENT_ID,
    googleClientSecret: p.GOOGLE_CLIENT_SECRET,
    resendApiKey: p.RESEND_API_KEY,
    emailFrom: p.AUTH_EMAIL_FROM,
    mapStyleUrl: p.MAP_STYLE_URL ?? DEFAULT_MAP_STYLE_URL,
  };
}
