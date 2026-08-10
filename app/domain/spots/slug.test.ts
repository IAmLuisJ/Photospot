import { describe, it, expect } from "vitest";
import { slugify, slugCandidates } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Millennium Park Meadow")).toBe("millennium-park-meadow");
  });

  it("strips punctuation", () => {
    expect(slugify("Ah-Nab-Awen Park!")).toBe("ah-nab-awen-park");
  });

  it("collapses runs of separators", () => {
    expect(slugify("Blue   Bridge  --  North")).toBe("blue-bridge-north");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  -- Fish Ladder --  ")).toBe("fish-ladder");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(slugify("Café Élan")).toBe("cafe-elan");
  });

  it("returns an empty string for input with nothing usable", () => {
    expect(slugify("!!! ???")).toBe("");
  });
});

describe("slugCandidates", () => {
  it("offers the bare name first", () => {
    expect(slugCandidates("Millennium Park", "Grand Rapids", "MI")[0]).toBe("millennium-park");
  });

  it("falls back to name-plus-locality", () => {
    expect(slugCandidates("Millennium Park", "Grand Rapids", "MI")[1]).toBe(
      "millennium-park-grand-rapids",
    );
  });

  it("then adds the region", () => {
    expect(slugCandidates("Millennium Park", "Grand Rapids", "MI")[2]).toBe(
      "millennium-park-grand-rapids-mi",
    );
  });

  it("ends with a discriminated candidate that differs each call", () => {
    const a = slugCandidates("Millennium Park", "Grand Rapids", "MI").at(-1)!;
    const b = slugCandidates("Millennium Park", "Grand Rapids", "MI").at(-1)!;
    expect(a).not.toBe(b);
    expect(a.startsWith("millennium-park-")).toBe(true);
  });

  it("skips locality steps when there is no locality", () => {
    const candidates = slugCandidates("Millennium Park", null, null);
    expect(candidates[0]).toBe("millennium-park");
    expect(candidates).toHaveLength(2);
  });

  // A name of pure punctuation must still produce something insertable, since
  // slug is NOT NULL and unique.
  it("still produces a usable slug for an unusable name", () => {
    const candidates = slugCandidates("!!!", null, null);
    expect(candidates.every((c) => c.length > 0)).toBe(true);
  });
});
