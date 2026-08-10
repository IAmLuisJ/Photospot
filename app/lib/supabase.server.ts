import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "./env.server";

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
