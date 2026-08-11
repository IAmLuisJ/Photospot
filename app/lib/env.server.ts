import { z } from "zod";

/**
 * MapLibre's free demo tiles. Fine for development; production should set
 * MAP_STYLE_URL to a real provider (spec §5 prefers Protomaps or MapTiler,
 * both of which bill flat rather than per map load).
 */
export const DEFAULT_MAP_STYLE_URL = "https://demotiles.maplibre.org/style.json";

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  /**
   * Optional on purpose. readEnv() runs in every loader, so requiring this
   * would take the whole site down wherever it is absent rather than only the
   * paths that write derived columns — and production currently runs on
   * placeholder credentials (see docs/STATUS.md). `createSupabaseAdminClient`
   * is where a missing key becomes a loud failure, at the point it matters.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  MAP_STYLE_URL: z.string().url().optional(),
});

export interface Env {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Server-only. Absent in environments that never write derived columns. */
  supabaseServiceRoleKey: string | undefined;
  mapStyleUrl: string;
}

/** Fails loudly at boot rather than at the first request. */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${missing}`);
  }
  return {
    supabaseUrl: parsed.data.SUPABASE_URL,
    supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    mapStyleUrl: parsed.data.MAP_STYLE_URL ?? DEFAULT_MAP_STYLE_URL,
  };
}
