import type { Bounds } from "../geo/bounds";
import {
  parseAttributeFilters,
  attributeFiltersToParams,
  NO_ATTRIBUTE_FILTERS,
  type AttributeFilters,
} from "./attribute-filters";

export type ExploreView = "split" | "map" | "gallery";
export type ExploreSort = "score" | "hot";

export interface ExploreFilters {
  viewport: Bounds;
  zoom: number;
  shootTypeId: number | null;
  sort: ExploreSort;
  view: ExploreView;
  attributes: AttributeFilters;
}

/**
 * Grand Rapids — the launch market (spec §2).
 *
 * Wide enough to contain every seeded spot, including Riverside Park at
 * lat 43.0123. A tighter downtown box left a first-time visitor looking at
 * five of six spots with no indication the sixth existed.
 */
export const DEFAULT_VIEWPORT: Bounds = Object.freeze({
  west: -85.7500,
  south: 42.9100,
  east: -85.5900,
  north: 43.0300,
});

export const DEFAULT_FILTERS: ExploreFilters = Object.freeze({
  viewport: DEFAULT_VIEWPORT,
  zoom: 12,
  shootTypeId: null,
  sort: "score",
  view: "split",
  attributes: NO_ATTRIBUTE_FILTERS,
});

const VIEWS: readonly string[] = ["split", "map", "gallery"];
const SORTS: readonly string[] = ["score", "hot"];

/** Six decimals is about 10 cm — far finer than a hand-dropped pin. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

const num = (params: URLSearchParams, key: string): number | null => {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const readViewport = (params: URLSearchParams): Bounds => {
  const west = num(params, "w");
  const south = num(params, "s");
  const east = num(params, "e");
  const north = num(params, "n");

  // All four or none — a partial box would silently query the wrong region.
  if (west === null || south === null || east === null || north === null) {
    return DEFAULT_VIEWPORT;
  }
  const inRange =
    west >= -180 && east <= 180 && south >= -90 && north <= 90 && west < east && south < north;

  return inRange ? { west, south, east, north } : DEFAULT_VIEWPORT;
};

/**
 * Search params are user-editable and arrive from other people's links, so
 * every field falls back to a default rather than throwing. A bad URL should
 * show Grand Rapids, not an error page.
 */
export function parseExploreFilters(params: URLSearchParams): ExploreFilters {
  const zoomRaw = num(params, "z");
  const typeRaw = num(params, "type");
  const view = params.get("view");
  const sort = params.get("sort");

  return {
    viewport: readViewport(params),
    zoom: zoomRaw === null ? DEFAULT_FILTERS.zoom : Math.min(22, Math.max(0, zoomRaw)),
    shootTypeId: typeRaw !== null && Number.isInteger(typeRaw) ? typeRaw : null,
    sort: sort !== null && SORTS.includes(sort) ? (sort as ExploreSort) : "score",
    view: view !== null && VIEWS.includes(view) ? (view as ExploreView) : "split",
    attributes: parseAttributeFilters(params),
  };
}

/** Only non-default values are written, so a share link stays readable. */
export function filtersToSearchParams(filters: ExploreFilters): URLSearchParams {
  const params = new URLSearchParams();
  const { viewport: v } = filters;

  if (
    v.west !== DEFAULT_VIEWPORT.west ||
    v.south !== DEFAULT_VIEWPORT.south ||
    v.east !== DEFAULT_VIEWPORT.east ||
    v.north !== DEFAULT_VIEWPORT.north
  ) {
    params.set("w", String(round6(v.west)));
    params.set("s", String(round6(v.south)));
    params.set("e", String(round6(v.east)));
    params.set("n", String(round6(v.north)));
  }
  if (filters.zoom !== DEFAULT_FILTERS.zoom) params.set("z", String(filters.zoom));
  if (filters.shootTypeId !== null) params.set("type", String(filters.shootTypeId));
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);

  // `view` is written unconditionally, unlike everything else here. Once a
  // cookie remembers the view, omitting `view=split` means clicking "split"
  // produces a URL with no view at all, the loader falls back to the
  // remembered gallery, and the click silently does nothing. One extra query
  // parameter removes the whole class of bug.
  params.set("view", filters.view);

  for (const [key, value] of attributeFiltersToParams(filters.attributes)) {
    params.set(key, value);
  }

  return params;
}
