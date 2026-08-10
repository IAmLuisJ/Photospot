import { describe, it, expect, beforeAll } from "vitest";
import { createSupabaseServerClient } from "./supabase.server";

// readEnv() runs inside createSupabaseServerClient, so these must be present.
// The db test project loads them from .env; the unit project does not, and
// this file only needs them to be syntactically valid.
beforeAll(() => {
  process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
  process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
});

const request = (cookie?: string) =>
  new Request("http://localhost/", cookie ? { headers: { Cookie: cookie } } : undefined);

describe("createSupabaseServerClient", () => {
  it("builds a client and a headers object for a request with no cookies", () => {
    const { supabase, headers } = createSupabaseServerClient(request());
    expect(supabase).toBeDefined();
    expect(headers).toBeInstanceOf(Headers);
  });

  it("parses a Cookie header without throwing", () => {
    // @supabase/ssr's parseCookieHeader has changed shape across versions —
    // it can yield { name, value?: string | undefined }. If the mapping in
    // supabase.server.ts stops handling that, this is where it surfaces,
    // rather than as a broken login in task 14.
    expect(() =>
      createSupabaseServerClient(request("sb-access-token=abc; sb-refresh-token=def")),
    ).not.toThrow();
  });

  it("tolerates a malformed cookie header", () => {
    expect(() => createSupabaseServerClient(request("=; ;;garbage"))).not.toThrow();
  });

  it("gives each request its own headers object, so responses cannot bleed", () => {
    const a = createSupabaseServerClient(request());
    const b = createSupabaseServerClient(request());
    a.headers.append("Set-Cookie", "one=1");
    expect(b.headers.get("Set-Cookie")).toBeNull();
  });
});
