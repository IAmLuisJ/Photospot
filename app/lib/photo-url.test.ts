import { describe, it, expect } from "vitest";
import { photoUrl } from "./photo-url";
const BASE = "https://photos.example.com";
describe("photoUrl", () => {
  it("uses the same-origin moderated media endpoint", () => {
    expect(photoUrl(BASE, "abc/scout.jpg")).toBe(`${BASE}/media/abc/scout.jpg`);
  });
  it("returns null for a missing photo", () => {
    expect(photoUrl(BASE, null)).toBeNull();
  });
  it("tolerates a trailing slash", () => {
    expect(photoUrl(`${BASE}/`, "abc/scout.jpg")).toBe(
      `${BASE}/media/abc/scout.jpg`,
    );
  });
  it("encodes reserved characters within each key segment", () => {
    expect(photoUrl(BASE, "abc/my photo?.jpg")).toBe(
      `${BASE}/media/abc/my%20photo%3F.jpg`,
    );
  });
  it("rejects path traversal segments", () => {
    expect(photoUrl(BASE, "../secret.jpg")).toBeNull();
  });
});
