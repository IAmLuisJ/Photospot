import { describe, it, expect } from "vitest";
import { targetDimensions, uploadPathFor, MAX_IMAGE_EDGE } from "./photo-upload.client";

describe("targetDimensions", () => {
  it("leaves a small image alone", () => {
    expect(targetDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a wide image down by its longest edge", () => {
    const { width, height } = targetDimensions(4000, 3000);
    expect(width).toBe(MAX_IMAGE_EDGE);
    expect(height).toBe(Math.round((3000 / 4000) * MAX_IMAGE_EDGE));
  });

  it("scales a tall image down by its longest edge", () => {
    const { width, height } = targetDimensions(3000, 4000);
    expect(height).toBe(MAX_IMAGE_EDGE);
    expect(width).toBe(Math.round((3000 / 4000) * MAX_IMAGE_EDGE));
  });

  it("preserves aspect ratio", () => {
    const { width, height } = targetDimensions(4000, 2000);
    expect(width / height).toBeCloseTo(2, 5);
  });

  it("never returns a zero dimension", () => {
    const { width, height } = targetDimensions(10000, 1);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});

describe("uploadPathFor", () => {
  // The storage policy requires the first folder to be the uploader's id, and
  // the spot does not exist yet at upload time (spec §10).
  it("puts the file under the uploader's id", () => {
    expect(uploadPathFor("user-123", "photo.JPG").startsWith("user-123/")).toBe(true);
  });

  it("keeps the extension, lowercased", () => {
    expect(uploadPathFor("user-123", "photo.JPG").endsWith(".jpg")).toBe(true);
  });

  it("gives a different path each time, so uploads cannot collide", () => {
    expect(uploadPathFor("u", "a.jpg")).not.toBe(uploadPathFor("u", "a.jpg"));
  });

  it("falls back to .jpg when the name has no extension", () => {
    expect(uploadPathFor("u", "screenshot").endsWith(".jpg")).toBe(true);
  });

  it("does not carry the original filename through", () => {
    expect(uploadPathFor("u", "my holiday photo.jpg")).not.toContain("holiday");
  });
});
