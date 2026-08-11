import { COST_TYPE_OPTIONS, isAccessibilityValue } from "../spots/attributes";

export interface AttributeFilters {
  /** Any-of. Empty means no cost filter. */
  costTypes: string[];
  /** Inclusive upper bound. Null means no walk filter. */
  maxWalkMinutes: number | null;
  /** All-of: these are requirements, not preferences. */
  accessibility: string[];
  dogFriendlyOnly: boolean;
}

export const NO_ATTRIBUTE_FILTERS: AttributeFilters = Object.freeze({
  costTypes: [],
  maxWalkMinutes: null,
  accessibility: [],
  dogFriendlyOnly: false,
});

const isCostType = (value: string) => COST_TYPE_OPTIONS.some((o) => o.value === value);

/** Splits on commas, drops blanks, and keeps only values the vocabulary knows. */
const list = (params: URLSearchParams, key: string, isValid: (v: string) => boolean): string[] => {
  const raw = params.get(key);
  if (raw === null) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    // `v !== ""` is redundant against today's validators — both reject the
    // empty string already, and a mutation test confirms no case reaches it.
    // It stays for the next filter field, whose validator may be permissive.
    .filter((v) => v !== "" && isValid(v));
};

/**
 * Search params arrive from other people's links and from hand editing, so a
 * bad value is dropped rather than thrown on — a broken URL should show an
 * unfiltered map, not an error page.
 *
 * Dropping also matters for correctness, not just resilience: passing an
 * unknown string through to the query would filter on something no row can
 * match, which renders identically to "no results" and is not the same thing.
 */
export function parseAttributeFilters(params: URLSearchParams): AttributeFilters {
  const walkRaw = params.get("walk");
  const walk = walkRaw === null || walkRaw.trim() === "" ? NaN : Number(walkRaw);

  return {
    costTypes: list(params, "cost", isCostType),
    maxWalkMinutes: Number.isInteger(walk) && walk >= 0 ? walk : null,
    accessibility: list(params, "access", isAccessibilityValue),
    dogFriendlyOnly: params.get("dogs") === "1",
  };
}

export function attributeFiltersToParams(filters: AttributeFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.costTypes.length > 0) params.set("cost", filters.costTypes.join(","));
  // `!== null`, not truthiness: zero is a real filter and would vanish.
  if (filters.maxWalkMinutes !== null) params.set("walk", String(filters.maxWalkMinutes));
  if (filters.accessibility.length > 0) params.set("access", filters.accessibility.join(","));
  if (filters.dogFriendlyOnly) params.set("dogs", "1");
  return params;
}

/**
 * Checks `maxWalkMinutes !== null` rather than its truthiness: zero is a real
 * filter meaning "you can park at the spot", and a truthiness check would treat
 * it as no filter at all.
 */
export function hasAnyAttributeFilter(filters: AttributeFilters): boolean {
  return (
    filters.costTypes.length > 0 ||
    filters.maxWalkMinutes !== null ||
    filters.accessibility.length > 0 ||
    filters.dogFriendlyOnly
  );
}
