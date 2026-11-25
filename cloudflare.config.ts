import { bindings, defineConfig, triggers } from "cf/config";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// Public build configuration. Worker secrets are read from .dev.vars locally
// and secret bindings in production, never inlined into this configuration.
if (existsSync(".env")) loadEnvFile(".env");
export const LOCAL_D1_ID = "00000000-0000-4000-8000-000000000001";

export default defineConfig({
  worker: {
    name: "photospots",
    entrypoint: "./workers/app.ts",
    // Latest date supported by the pinned local workerd binary.
    compatibilityDate: "2026-11-24",
    compatibilityFlags: ["nodejs_compat"],
    env: {
      DB: bindings.d1({
        name: "photospots",
        id: process.env.D1_DATABASE_ID || LOCAL_D1_ID,
      }),
      PHOTOS: bindings.r2({
        name: process.env.PHOTOS_BUCKET_NAME || "photospots-photos",
      }),
      AUTH_ORIGIN: bindings.text(
        process.env.AUTH_ORIGIN || "http://localhost:5173",
      ),
      MAP_STYLE_URL: bindings.text(
        process.env.MAP_STYLE_URL ||
          "https://demotiles.maplibre.org/style.json",
      ),
      BETTER_AUTH_SECRET: bindings.secret(),
      GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
      RESEND_API_KEY: bindings.secret(),
      AUTH_EMAIL_FROM: bindings.text(process.env.AUTH_EMAIL_FROM || ""),
    },
    triggers: [triggers.scheduled({ schedule: "17 * * * *" })],
    observability: {
      enabled: true,
      redactQueryString: true,
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
  },
});
