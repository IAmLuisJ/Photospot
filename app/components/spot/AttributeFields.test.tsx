import { describe, it, expect } from "vitest";
import { checkedValuesFrom, parseOptionalInt, parseOptionalBool } from "./AttributeFields";

const form = (entries: [string, string][]): FormData => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
};

describe("checkedValuesFrom", () => {
  it("collects every checked box for a field", () => {
    const data = form([
      ["accessibility", "wheelchair"],
      ["accessibility", "restrooms"],
      ["terrain", "grass"],
    ]);
    expect(checkedValuesFrom(data, "accessibility")).toEqual(["wheelchair", "restrooms"]);
  });

  // Unchecking everything must mean "none of these", not "leave it alone" —
  // otherwise an attribute can be added but never removed.
  it("returns an empty array when nothing is checked", () => {
    expect(checkedValuesFrom(form([["terrain", "grass"]]), "accessibility")).toEqual([]);
  });

  // The vocabulary is the authority; a hand-crafted POST does not get to widen it.
  it("drops values outside the vocabulary", () => {
    const data = form([
      ["accessibility", "wheelchair"],
      ["accessibility", "teleporter"],
    ]);
    expect(checkedValuesFrom(data, "accessibility")).toEqual(["wheelchair"]);
  });

  it("validates terrain against its own vocabulary, not accessibility's", () => {
    const data = form([
      ["terrain", "grass"],
      ["terrain", "wheelchair"],
    ]);
    expect(checkedValuesFrom(data, "terrain")).toEqual(["grass"]);
  });
});

describe("parseOptionalInt", () => {
  it("reads a number", () => {
    expect(parseOptionalInt(form([["walkMinutes", "12"]]), "walkMinutes")).toBe(12);
  });

  // An empty field means "clear this", which is a null write, not a zero.
  it("reads an empty field as null, not zero", () => {
    expect(parseOptionalInt(form([["walkMinutes", ""]]), "walkMinutes")).toBeNull();
  });

  it("reads a missing field as null", () => {
    expect(parseOptionalInt(form([]), "walkMinutes")).toBeNull();
  });

  it("rejects nonsense rather than storing NaN", () => {
    expect(parseOptionalInt(form([["walkMinutes", "soon"]]), "walkMinutes")).toBeNull();
  });

  it("rejects a negative walk time", () => {
    expect(parseOptionalInt(form([["walkMinutes", "-3"]]), "walkMinutes")).toBeNull();
  });

  // Zero is a real answer — you park at the spot — and must survive.
  it("keeps a zero", () => {
    expect(parseOptionalInt(form([["walkMinutes", "0"]]), "walkMinutes")).toBe(0);
  });
});

describe("parseOptionalBool", () => {
  it("reads yes and no", () => {
    expect(parseOptionalBool(form([["dogFriendly", "yes"]]), "dogFriendly")).toBe(true);
    expect(parseOptionalBool(form([["dogFriendly", "no"]]), "dogFriendly")).toBe(false);
  });

  // The reason this is a select and not a checkbox: an unchecked box collapses
  // to false, so anyone who ignored the control would publish "Dog friendly:
  // No" — asserting something they never said.
  it("reads an unanswered field as null, not false", () => {
    expect(parseOptionalBool(form([["dogFriendly", ""]]), "dogFriendly")).toBeNull();
    expect(parseOptionalBool(form([]), "dogFriendly")).toBeNull();
  });

  it("treats anything unrecognised as unanswered", () => {
    expect(parseOptionalBool(form([["dogFriendly", "maybe"]]), "dogFriendly")).toBeNull();
  });
});
