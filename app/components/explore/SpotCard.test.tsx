import { describe, it, expect } from "vitest";
import { cardSummaryLine } from "./SpotCard";
import type { SpotSummary } from "~/data/spots";

const spot = (over: Partial<SpotSummary> = {}): SpotSummary => ({
  id: "1",
  name: "Millennium Park Meadow",
  slug: "millennium-park-meadow",
  kind: "outdoor",
  position: { lat: 42.92, lng: -85.72 },
  locality: "Grand Rapids",
  region: "MI",
  score: 12.5,
  hotScore: 3,
  commentCount: 4,
  photoCount: 2,
  coverPhotoPath: null,
  coverCreditName: null,
  ...over,
});

describe("cardSummaryLine", () => {
  it("shows locality and region", () => {
    expect(cardSummaryLine(spot())).toContain("Grand Rapids, MI");
  });

  it("omits the location when it is unknown, without leaving a stray comma", () => {
    const line = cardSummaryLine(spot({ locality: null, region: null }));
    expect(line).not.toContain(",");
    expect(line.startsWith(" ")).toBe(false);
  });

  it("counts photos and comments", () => {
    const line = cardSummaryLine(spot({ photoCount: 3, commentCount: 1 }));
    expect(line).toContain("3 photos");
    expect(line).toContain("1 comment");
  });

  it("uses singular for one photo", () => {
    expect(cardSummaryLine(spot({ photoCount: 1 }))).toContain("1 photo");
    expect(cardSummaryLine(spot({ photoCount: 1 }))).not.toContain("1 photos");
  });

  it("omits zero counts rather than showing '0 comments'", () => {
    const line = cardSummaryLine(spot({ commentCount: 0, photoCount: 0 }));
    expect(line).not.toContain("0");
  });

  it("marks a studio", () => {
    expect(cardSummaryLine(spot({ kind: "studio" }))).toContain("Studio");
  });
});
