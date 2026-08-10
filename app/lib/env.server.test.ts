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
});
