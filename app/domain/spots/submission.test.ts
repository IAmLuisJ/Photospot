import { describe, it, expect } from "vitest";
import {
  validateSubmission,
  MAX_PHOTOS_PER_KIND,
  type SubmissionInput,
  type PhotoInput,
} from "./submission";

const photo = (over: Partial<PhotoInput> = {}): PhotoInput => ({
  storagePath: "user-id/abc.jpg",
  kind: "scouting",
  rightsAttested: false,
  creditName: null,
  creditUrl: null,
  caption: null,
  ...over,
});

const input = (over: Partial<SubmissionInput> = {}): SubmissionInput => ({
  name: "Millennium Park Meadow",
  kind: "outdoor",
  position: { lat: 42.92, lng: -85.72 },
  description: null,
  locality: "Grand Rapids",
  region: "MI",
  shootTypeIds: [1],
  photos: [photo()],
  ...over,
});

const errorsFor = (over: Partial<SubmissionInput>) => validateSubmission(input(over)).errors;

describe("validateSubmission", () => {
  it("accepts the minimum viable submission", () => {
    expect(validateSubmission(input()).errors).toEqual([]);
  });

  it("requires a name", () => {
    expect(errorsFor({ name: "   " })).toContainEqual({ field: "name", message: expect.any(String) });
  });

  it("rejects a name that is too long to render", () => {
    expect(errorsFor({ name: "x".repeat(121) }).some((e) => e.field === "name")).toBe(true);
  });

  it("requires at least one shoot type", () => {
    expect(errorsFor({ shootTypeIds: [] }).some((e) => e.field === "shootTypeIds")).toBe(true);
  });

  it("requires at least one photo", () => {
    expect(errorsFor({ photos: [] }).some((e) => e.field === "photos")).toBe(true);
  });

  // Spec §4.3, and the database enforces it too — but catching it in the form
  // means the user is told before uploading rather than after.
  it("requires a rights attestation on a session photo", () => {
    const errors = errorsFor({ photos: [photo({ kind: "session", rightsAttested: false })] });
    expect(errors.some((e) => e.field === "photos")).toBe(true);
  });

  it("accepts a session photo that is attested", () => {
    expect(errorsFor({ photos: [photo({ kind: "session", rightsAttested: true })] })).toEqual([]);
  });

  it("does not require an attestation on a scouting photo", () => {
    expect(errorsFor({ photos: [photo({ kind: "scouting", rightsAttested: false })] })).toEqual([]);
  });

  it("rejects more photos of one kind than the cap allows", () => {
    const tooMany = Array.from({ length: MAX_PHOTOS_PER_KIND + 1 }, (_, i) =>
      photo({ storagePath: `user-id/${i}.jpg` }),
    );
    expect(errorsFor({ photos: tooMany }).some((e) => e.field === "photos")).toBe(true);
  });

  it("counts the cap per kind, not across kinds", () => {
    const full = [
      ...Array.from({ length: MAX_PHOTOS_PER_KIND }, (_, i) =>
        photo({ storagePath: `s/${i}.jpg`, kind: "scouting" as const }),
      ),
      ...Array.from({ length: MAX_PHOTOS_PER_KIND }, (_, i) =>
        photo({ storagePath: `x/${i}.jpg`, kind: "session" as const, rightsAttested: true }),
      ),
    ];
    expect(errorsFor({ photos: full })).toEqual([]);
  });

  it("rejects a position outside the world", () => {
    expect(errorsFor({ position: { lat: 95, lng: 0 } }).some((e) => e.field === "position")).toBe(true);
    expect(errorsFor({ position: { lat: 0, lng: 200 } }).some((e) => e.field === "position")).toBe(true);
  });

  it("reports every problem at once rather than one at a time", () => {
    const errors = errorsFor({ name: "", shootTypeIds: [], photos: [] });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
