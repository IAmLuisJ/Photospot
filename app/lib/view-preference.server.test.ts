import { describe, it, expect } from "vitest";
import { resolveView, viewPreferenceCookie } from "./view-preference.server";

describe("resolveView", () => {
  // The URL is what a shared link carries, so it has to win — otherwise
  // opening a friend's gallery link shows your own remembered split view.
  it("prefers the URL over the cookie", () => {
    expect(resolveView("gallery", "map")).toBe("gallery");
  });

  it("falls back to the cookie when the URL says nothing", () => {
    expect(resolveView(null, "map")).toBe("map");
  });

  it("falls back to split when neither says anything", () => {
    expect(resolveView(null, null)).toBe("split");
  });

  // The cookie is stored input and gets validated exactly like the URL does.
  it("ignores a nonsense cookie rather than trusting stored input", () => {
    expect(resolveView(null, "hologram")).toBe("split");
  });

  it("ignores a nonsense URL value but still honours the cookie", () => {
    expect(resolveView("hologram", "map")).toBe("map");
  });

  it("accepts every real view from either source", () => {
    for (const view of ["split", "map", "gallery"] as const) {
      expect(resolveView(view, null)).toBe(view);
      expect(resolveView(null, view)).toBe(view);
    }
  });
});

describe("viewPreferenceCookie", () => {
  it("round-trips a view through serialise and parse", async () => {
    const header = await viewPreferenceCookie.serialize("gallery");
    expect(await viewPreferenceCookie.parse(header)).toBe("gallery");
  });

  // A preference, not a credential — but it still has no business being sent
  // to third parties or read by scripts.
  it("is httpOnly, sameSite lax, and long-lived", async () => {
    const header = await viewPreferenceCookie.serialize("map");
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Max-Age=\d{7,}/);
  });

  it("returns null for a request with no cookie at all", async () => {
    expect(await viewPreferenceCookie.parse(null)).toBeNull();
  });
});
