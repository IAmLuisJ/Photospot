import { describe, it, expect } from "vitest";
import { photoUrl, SPOT_PHOTO_BUCKET } from "./photo-url";

const BASE = "http://127.0.0.1:54321";

describe("photoUrl", () => {
  it("builds a public storage URL", () => {
    expect(photoUrl(BASE, "abc/scout.jpg")).toBe(
      `${BASE}/storage/v1/object/public/${SPOT_PHOTO_BUCKET}/abc/scout.jpg`,
    );
  });

  it("returns null for a missing path, so callers render a placeholder", () => {
    expect(photoUrl(BASE, null)).toBeNull();
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(photoUrl(`${BASE}/`, "abc/scout.jpg")).toBe(
      `${BASE}/storage/v1/object/public/${SPOT_PHOTO_BUCKET}/abc/scout.jpg`,
    );
  });

  it("encodes a path with spaces", () => {
    expect(photoUrl(BASE, "abc/my photo.jpg")).toContain("my%20photo.jpg");
  });
});
