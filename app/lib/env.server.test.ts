import { describe, it, expect } from "vitest";
import { readEnv, DEFAULT_MAP_STYLE_URL } from "./env.server";

const valid = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon-key",
};

describe("readEnv", () => {
  it("returns the parsed values", () => {
    expect(readEnv(valid)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "anon-key",
      mapStyleUrl: DEFAULT_MAP_STYLE_URL,
    });
  });

  it("names the missing variable so the failure is actionable", () => {
    expect(() => readEnv({ SUPABASE_URL: "http://x" })).toThrow(/SUPABASE_ANON_KEY/);
  });

  it("rejects a malformed URL", () => {
    expect(() => readEnv({ ...valid, SUPABASE_URL: "not-a-url" })).toThrow();
  });

  it("accepts a custom map style", () => {
    const env = readEnv({ ...valid, MAP_STYLE_URL: "https://tiles.example/style.json" });
    expect(env.mapStyleUrl).toBe("https://tiles.example/style.json");
  });

  it("rejects a malformed map style URL rather than silently falling back", () => {
    expect(() => readEnv({ ...valid, MAP_STYLE_URL: "nonsense" })).toThrow();
  });

  // Optional on purpose: readEnv runs in every loader, so requiring it would
  // take the whole site down where it is absent rather than only the paths
  // that write derived columns. createSupabaseAdminClient does the refusing.
  it("accepts a missing service role key, which only the write path needs", () => {
    expect(readEnv(valid).supabaseServiceRoleKey).toBeUndefined();
  });

  it("carries the service role key through when it is set", () => {
    const env = readEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "service" });
    expect(env.supabaseServiceRoleKey).toBe("service");
  });

  it("rejects an empty service role key instead of treating it as absent", () => {
    expect(() => readEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow();
  });
});
