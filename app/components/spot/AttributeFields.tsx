import {
  ACCESSIBILITY_OPTIONS,
  TERRAIN_OPTIONS,
  COST_TYPE_OPTIONS,
  isAccessibilityValue,
  isTerrainValue,
} from "~/domain/spots/attributes";

const VALIDATORS: Record<string, (value: string) => boolean> = {
  accessibility: isAccessibilityValue,
  terrain: isTerrainValue,
};

/**
 * The checked boxes for one field, filtered to the vocabulary.
 *
 * The filter is not defensive noise: the form only renders valid boxes, but the
 * action is a public endpoint and the database constraint would reject the
 * whole write with a 23514 the user cannot act on. Dropping unknown values
 * turns a hand-crafted POST into a no-op instead of an error.
 */
export function checkedValuesFrom(form: FormData, field: string): string[] {
  const isValid = VALIDATORS[field] ?? (() => true);
  return form
    .getAll(field)
    .map(String)
    .filter(isValid);
}

/**
 * A tri-state read for an optional boolean.
 *
 * Deliberately not a checkbox. An unchecked box cannot say "I don't know" — it
 * collapses to false — so every contributor who simply ignored the control
 * would publish "Dog friendly: No" on the spot page, asserting something they
 * never said. Every other optional attribute treats null as "nobody said"
 * (spec §4.7), and the detail page omits a null rather than rendering it.
 */
export function parseOptionalBool(form: FormData, field: string): boolean | null {
  const raw = form.get(field);
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return null;
}

/**
 * An empty or missing field is null — "clear this" — not zero. Reading it as
 * zero would turn "I don't know the walk time" into "it is right there".
 */
export function parseOptionalInt(form: FormData, field: string): number | null {
  const raw = form.get(field);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export interface AttributeValues {
  costType: string | null;
  walkMinutes: number | null;
  accessibility: string[] | null;
  terrain: string[] | null;
  dogFriendly: boolean | null;
}

/** Shared by the submission form and the edit form, so the two cannot diverge. */
export function AttributeFields({ current }: { current: AttributeValues }) {
  const accessibility = current.accessibility ?? [];
  const terrain = current.terrain ?? [];

  return (
    <fieldset className="attribute-fields">
      <legend>Practical detail</legend>
      <p className="attribute-fields__hint">
        All optional — but these are what someone filters on, so anything you fill in makes the
        spot findable.
      </p>

      <label>
        Cost
        <select name="costType" defaultValue={current.costType ?? ""}>
          <option value="">Not sure</option>
          {COST_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Walk from parking (minutes)
        <input type="number" name="walkMinutes" min={0} defaultValue={current.walkMinutes ?? ""} />
      </label>

      <fieldset>
        <legend>Getting around</legend>
        {ACCESSIBILITY_OPTIONS.map((o) => (
          <label key={o.value}>
            <input
              type="checkbox"
              name="accessibility"
              value={o.value}
              defaultChecked={accessibility.includes(o.value)}
            />
            {o.label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Underfoot</legend>
        {TERRAIN_OPTIONS.map((o) => (
          <label key={o.value}>
            <input
              type="checkbox"
              name="terrain"
              value={o.value}
              defaultChecked={terrain.includes(o.value)}
            />
            {o.label}
          </label>
        ))}
      </fieldset>

      <label>
        Dogs
        <select
          name="dogFriendly"
          defaultValue={current.dogFriendly === null ? "" : current.dogFriendly ? "yes" : "no"}
        >
          <option value="">Not sure</option>
          <option value="yes">Welcome</option>
          <option value="no">Not allowed</option>
        </select>
      </label>
    </fieldset>
  );
}
