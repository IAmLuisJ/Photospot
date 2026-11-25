import { describe, it, expect } from "vitest";
import { readEnv, DEFAULT_MAP_STYLE_URL } from "./env.server";
const valid = {
  AUTH_ORIGIN: "http://localhost:5173",
  BETTER_AUTH_SECRET: "test-secret-at-least-thirty-two-characters-long",
};
describe("Worker environment", () => {
  it("allows browsing without OAuth or mail credentials", () => {
    expect(readEnv(valid)).toMatchObject({
      authOrigin: "http://localhost:5173",
      mapStyleUrl: DEFAULT_MAP_STYLE_URL,
      googleClientId: undefined,
      resendApiKey: undefined,
    });
  });
  it("names a missing auth secret and rejects short secrets", () => {
    expect(() => readEnv({ AUTH_ORIGIN: valid.AUTH_ORIGIN })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
    expect(() => readEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });
  it("requires HTTPS for a deployed origin and forbids origin paths", () => {
    expect(() =>
      readEnv({ ...valid, AUTH_ORIGIN: "http://photos.example.com" }),
    ).toThrow(/HTTPS/);
    expect(() =>
      readEnv({ ...valid, AUTH_ORIGIN: "https://photos.example.com/path" }),
    ).toThrow(/origin/i);
    expect(
      readEnv({ ...valid, AUTH_ORIGIN: "https://photos.example.com/" })
        .authOrigin,
    ).toBe("https://photos.example.com");
  });
  it("requires OAuth client ID and secret together", () => {
    expect(() => readEnv({ ...valid, GOOGLE_CLIENT_ID: "id" })).toThrow(/both/);
    expect(
      readEnv({ ...valid, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" })
        .googleClientId,
    ).toBeUndefined();
  });
  it("accepts custom map styles and treats blank development values as absent", () => {
    expect(
      readEnv({
        ...valid,
        MAP_STYLE_URL: "https://tiles.example.com/style.json",
      }).mapStyleUrl,
    ).toBe("https://tiles.example.com/style.json");
    expect(readEnv({ ...valid, MAP_STYLE_URL: "" }).mapStyleUrl).toBe(
      DEFAULT_MAP_STYLE_URL,
    );
    expect(() => readEnv({ ...valid, MAP_STYLE_URL: "nonsense" })).toThrow(
      /MAP_STYLE_URL/,
    );
  });
});
