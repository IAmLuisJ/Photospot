import { describe, it, expect } from "vitest";
import {
  ACCESSIBILITY_OPTIONS,
  TERRAIN_OPTIONS,
  COST_TYPE_OPTIONS,
  labelForAccessibility,
  isAccessibilityValue,
} from "./attributes";

describe("vocabularies", () => {
  it("offers the accessibility values the seed already uses", () => {
    const values = ACCESSIBILITY_OPTIONS.map((o) => o.value);
    for (const seeded of ["wheelchair", "stroller", "restrooms", "shade"]) {
      expect(values).toContain(seeded);
    }
  });

  it("offers the terrain values the seed already uses", () => {
    const values = TERRAIN_OPTIONS.map((o) => o.value);
    for (const seeded of ["paved", "grass", "gravel", "steep", "stairs"]) {
      expect(values).toContain(seeded);
    }
  });

  it("covers every cost_type in the database enum", () => {
    expect(COST_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      "free",
      "park_pass",
      "permit_required",
      "hourly_rate",
      "negotiated",
    ]);
  });

  // Values are stored, labels are shown. A value that reads like a label is how
  // a vocabulary starts drifting into free text.
  it("keeps values machine-shaped and labels human-shaped", () => {
    for (const option of [...ACCESSIBILITY_OPTIONS, ...TERRAIN_OPTIONS, ...COST_TYPE_OPTIONS]) {
      expect(option.value).toMatch(/^[a-z][a-z_]*$/);
      expect(option.label[0]).toMatch(/[A-Z]/);
    }
  });

  it("has no duplicate values", () => {
    const values = ACCESSIBILITY_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("labels a known value and falls back to the raw value for an unknown one", () => {
    expect(labelForAccessibility("wheelchair")).toBe("Wheelchair accessible");
    // Rows written before the vocabulary existed must still render.
    expect(labelForAccessibility("mystery")).toBe("mystery");
  });

  it("recognises which strings are in the vocabulary", () => {
    expect(isAccessibilityValue("stroller")).toBe(true);
    expect(isAccessibilityValue("Stroller")).toBe(false);
    expect(isAccessibilityValue("")).toBe(false);
  });
});
