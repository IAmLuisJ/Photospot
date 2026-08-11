import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnv, type Env } from "./env.server";

export interface SupabaseContext {
  supabase: SupabaseClient;
  /** Must be spread onto the response so refreshed session cookies persist. */
  headers: Headers;
}

/**
 * One client per request. Supabase refreshes the session during a request,
 * so the returned headers have to reach the response or users are silently
 * logged out when their access token expires.
 */
export function createSupabaseServerClient(request: Request): SupabaseContext {
  const { supabaseUrl, supabaseAnonKey } = readEnv();
  const headers = new Headers();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "").map((cookie) => ({
          name: cookie.name,
          value: cookie.value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          headers.append("Set-Cookie", serializeCookieHeader(name, value, options));
        }
      },
    },
  });

  return { supabase, headers };
}

/**
 * Bypasses RLS. Only for writing columns the application roles deliberately
 * cannot write — `spots.score` is the whole reason this exists, because score
 * is the default sort order and a user-writable rank is rank manipulation.
 *
 * This file is `.server.ts`, so the key can never reach the browser bundle.
 * Takes its environment as an argument so the missing-key path is testable
 * without mutating `process.env`.
 *
 * Throws rather than returning null: a missing key means votes keep landing
 * while scores quietly stop moving, and nothing else in the system would
 * notice. The caller decides whether that failure should reach the user — for
 * a vote that already succeeded, it should not.
 */
export function createSupabaseAdminClient(env: Env = readEnv()): SupabaseClient {
  if (!env.supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required to update derived columns such as spots.score.",
    );
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}
