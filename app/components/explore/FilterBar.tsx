import { ACCESSIBILITY_OPTIONS, COST_TYPE_OPTIONS } from "~/domain/spots/attributes";
import { NO_ATTRIBUTE_FILTERS, type AttributeFilters } from "~/domain/filters/attribute-filters";

export function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** Each selected value counts, so the badge matches the number of pills lit up. */
export function activeFilterCount(filters: AttributeFilters): number {
  return (
    filters.costTypes.length +
    filters.accessibility.length +
    // `!== null`, not truthiness: a zero-minute walk is a real filter.
    (filters.maxWalkMinutes === null ? 0 : 1) +
    (filters.dogFriendlyOnly ? 1 : 0)
  );
}

/**
 * Spec §14: the map is thin, so a filtered view emptying out needs explaining.
 *
 * The count is simply how many spots the filters removed, and it deliberately
 * does **not** claim why. Two very different things are in it — a spot whose
 * walk time is 25 minutes, and a spot whose walk time nobody recorded — and
 * distinguishing them needs the attribute values back from the query, which the
 * summary rows do not carry. Saying "nobody has filled this in" would be
 * flatly wrong for the first case, which is the common one.
 *
 * So the number is stated plainly and the missing-data case is mentioned as a
 * possibility rather than asserted as the cause.
 */
export function hiddenByFiltersMessage(hidden: number): string | null {
  if (hidden <= 0) return null;
  const spots = hidden === 1 ? "1 spot" : `${hidden} spots`;
  const verb = hidden === 1 ? "does" : "do";
  return `${spots} in view ${verb} not match — including any where nobody has filled that detail in yet.`;
}

/** Any is null rather than a large number, so it reads as "no filter" downstream. */
const WALK_CHOICES: readonly { value: number | null; label: string }[] = [
  { value: null, label: "Any walk" },
  { value: 5, label: "Under 5 min" },
  { value: 10, label: "Under 10 min" },
  { value: 20, label: "Under 20 min" },
];

/**
 * Every control hands the whole next filter object up to the route, which
 * writes it to the URL; the value comes back down through the loader. One
 * direction, so a control can never disagree with the address bar.
 */
export function FilterBar({
  filters,
  onChange,
}: {
  filters: AttributeFilters;
  onChange: (next: AttributeFilters) => void;
}) {
  const count = activeFilterCount(filters);

  return (
    <div className="filter-bar">
      <div className="filter-bar__group" role="group" aria-label="Cost">
        {COST_TYPE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={filters.costTypes.includes(o.value)}
            onClick={() =>
              onChange({ ...filters, costTypes: toggleValue(filters.costTypes, o.value) })
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      <label className="filter-bar__walk">
        Walk
        <select
          value={filters.maxWalkMinutes === null ? "" : String(filters.maxWalkMinutes)}
          onChange={(e) =>
            onChange({
              ...filters,
              maxWalkMinutes: e.currentTarget.value === "" ? null : Number(e.currentTarget.value),
            })
          }
        >
          {WALK_CHOICES.map((c) => (
            <option key={c.label} value={c.value === null ? "" : String(c.value)}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <div className="filter-bar__group" role="group" aria-label="Getting around">
        {ACCESSIBILITY_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={filters.accessibility.includes(o.value)}
            onClick={() =>
              onChange({ ...filters, accessibility: toggleValue(filters.accessibility, o.value) })
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-pressed={filters.dogFriendlyOnly}
        onClick={() => onChange({ ...filters, dogFriendlyOnly: !filters.dogFriendlyOnly })}
      >
        Dogs welcome
      </button>

      {count > 0 && (
        <button type="button" className="filter-bar__clear" onClick={() => onChange(NO_ATTRIBUTE_FILTERS)}>
          Clear {count} {count === 1 ? "filter" : "filters"}
        </button>
      )}
    </div>
  );
}
