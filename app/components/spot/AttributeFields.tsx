import { useState } from "react";
import {
  ACCESSIBILITY_OPTIONS,
  TERRAIN_OPTIONS,
  COST_TYPE_OPTIONS,
  isAccessibilityValue,
  isTerrainValue,
  type AttributeOption,
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
  return form.getAll(field).map(String).filter(isValid);
}

/** Unknown, explicitly none, and a missing control group have different meanings. */
export function optionalChoicesFrom(
  form: FormData,
  field: string,
  fallback: string[] | null = null,
): string[] | null {
  const state = form.get(`${field}State`);
  if (state === "unknown") return null;
  if (state === "known" || form.has(field))
    return checkedValuesFrom(form, field);
  return fallback;
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
export function parseOptionalBool(
  form: FormData,
  field: string,
): boolean | null {
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

function OptionalChoices({
  field,
  legend,
  options,
  current,
}: {
  field: string;
  legend: string;
  options: readonly AttributeOption[];
  current: string[] | null;
}) {
  const [known, setKnown] = useState(current !== null);
  return (
    <fieldset>
      <legend>{legend}</legend>
      <label>
        What do you know?
        <select
          name={`${field}State`}
          value={known ? "known" : "unknown"}
          onChange={(event) => setKnown(event.target.value === "known")}
        >
          <option value="unknown">Not sure yet</option>
          <option value="known">I know which options apply</option>
        </select>
      </label>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            name={field}
            value={option.value}
            defaultChecked={current?.includes(option.value) ?? false}
            disabled={!known}
          />
          {option.label}
        </label>
      ))}
      {known && (
        <p className="attribute-fields__hint">
          Leave all options unchecked if none apply.
        </p>
      )}
    </fieldset>
  );
}

/** Shared by the submission form and the edit form, so the two cannot diverge. */
export function AttributeFields({ current }: { current: AttributeValues }) {
  return (
    <fieldset className="attribute-fields">
      <legend>Practical detail</legend>
      <p className="attribute-fields__hint">
        All optional — but these are what someone filters on, so anything you
        fill in makes the spot findable.
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
        <input
          type="number"
          name="walkMinutes"
          min={0}
          defaultValue={current.walkMinutes ?? ""}
        />
      </label>

      <OptionalChoices
        key={`accessibility:${JSON.stringify(current.accessibility)}`}
        field="accessibility"
        legend="Getting around"
        options={ACCESSIBILITY_OPTIONS}
        current={current.accessibility}
      />
      <OptionalChoices
        key={`terrain:${JSON.stringify(current.terrain)}`}
        field="terrain"
        legend="Underfoot"
        options={TERRAIN_OPTIONS}
        current={current.terrain}
      />

      <label>
        Dogs
        <select
          name="dogFriendly"
          defaultValue={
            current.dogFriendly === null
              ? ""
              : current.dogFriendly
                ? "yes"
                : "no"
          }
        >
          <option value="">Not sure</option>
          <option value="yes">Welcome</option>
          <option value="no">Not allowed</option>
        </select>
      </label>
    </fieldset>
  );
}
