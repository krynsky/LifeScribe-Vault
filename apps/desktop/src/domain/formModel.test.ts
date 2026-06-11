import { describe, expect, it } from "vitest";
import {
  customFieldKey,
  findSectionField,
  isConditionSatisfied,
  isCustomFieldKey,
  sectionFields,
} from "./formModel";
import { makeField, makeGroup, makeSection } from "./testing/fixtures";

describe("custom field namespace", () => {
  it("builds custom field keys as custom.<sectionKey>.<id>", () => {
    expect(customFieldKey("devices", "warranty-note")).toBe("custom.devices.warranty-note");
  });

  it("recognizes custom keys for a specific section", () => {
    expect(isCustomFieldKey("custom.devices.warranty-note", "devices")).toBe(true);
    expect(isCustomFieldKey("custom.devices.warranty-note", "plan")).toBe(false);
  });

  it("recognizes custom keys regardless of section when none is given", () => {
    expect(isCustomFieldKey("custom.devices.warranty-note")).toBe(true);
    expect(isCustomFieldKey("deviceName")).toBe(false);
  });
});

describe("isConditionSatisfied", () => {
  it("treats an absent condition as always visible", () => {
    expect(isConditionSatisfied(undefined, {})).toBe(true);
  });

  it("matches equals conditions against the record value", () => {
    expect(isConditionSatisfied({ field: "provider", equals: "Other" }, { provider: "Other" })).toBe(true);
    expect(isConditionSatisfied({ field: "provider", equals: "Other" }, { provider: "1Password" })).toBe(false);
  });

  it("matches oneOf conditions against the record value", () => {
    const condition = { field: "kind", oneOf: ["nas", "cloud"] };
    expect(isConditionSatisfied(condition, { kind: "cloud" })).toBe(true);
    expect(isConditionSatisfied(condition, { kind: "local" })).toBe(false);
  });

  it("treats a missing value as the empty string", () => {
    expect(isConditionSatisfied({ field: "provider", equals: "" }, {})).toBe(true);
    expect(isConditionSatisfied({ field: "provider", equals: "Other" }, {})).toBe(false);
  });
});

describe("section field helpers", () => {
  const section = makeSection({
    sectionKey: "plan",
    groups: [
      makeGroup({
        groupKey: "second",
        order: 2,
        fields: [makeField({ systemKey: "c", order: 1 })],
      }),
      makeGroup({
        groupKey: "first",
        order: 1,
        fields: [makeField({ systemKey: "b", order: 2 }), makeField({ systemKey: "a", order: 1 })],
      }),
    ],
  });

  it("flattens section fields in group order then field order", () => {
    expect(sectionFields(section).map((field) => field.systemKey)).toEqual(["a", "b", "c"]);
  });

  it("finds a field by systemKey across groups", () => {
    expect(findSectionField(section, "c")?.systemKey).toBe("c");
    expect(findSectionField(section, "missing")).toBeUndefined();
  });
});
