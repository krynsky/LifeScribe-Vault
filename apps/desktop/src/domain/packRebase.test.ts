import { describe, expect, it } from "vitest";
import { makeField, makePlanPack } from "./testing/fixtures";
import { rebaseCustomPack } from "./packRebase";

describe("rebaseCustomPack", () => {
  it("keeps a user label while accepting a newly bundled field", () => {
    const oldBase = makePlanPack();
    const custom = structuredClone(oldBase);
    custom.sections[0].groups[0].fields[0].label = "My provider";
    const nextBase = structuredClone(oldBase);
    nextBase.packVersion = "1.1.0";
    nextBase.sections[0].groups[0].fields.push(makeField({ systemKey: "newBundledField" }));

    const rebased = rebaseCustomPack(oldBase, custom, nextBase);

    expect(rebased.sections[0].groups[0].fields[0].label).toBe("My provider");
    expect(rebased.sections[0].groups[0].fields.some((field) => field.systemKey === "newBundledField"))
      .toBe(true);
    expect(rebased.packVersion).toBe("1.1.0");
  });

  it("preserves user-added fields and intentional user deletions", () => {
    const oldBase = makePlanPack();
    const custom = structuredClone(oldBase);
    custom.sections[0].groups[0].fields = custom.sections[0].groups[0].fields
      .filter((field) => field.systemKey !== "notes");
    custom.sections[0].groups[0].fields.push(makeField({ systemKey: "custom.plan.extra" }));

    const rebased = rebaseCustomPack(oldBase, custom, structuredClone(oldBase));

    expect(rebased.sections[0].groups[0].fields.some((field) => field.systemKey === "notes")).toBe(false);
    expect(rebased.sections[0].groups[0].fields.some((field) => field.systemKey === "custom.plan.extra"))
      .toBe(true);
  });

  it("combines custom and bundled operations added to the same migration step", () => {
    const oldBase = makePlanPack();
    const custom = structuredClone(oldBase);
    custom.schemaVersion = 2;
    custom.migrations = [{
      fromVersion: 1,
      operations: [{ op: "retypeField", sectionKey: "plan", systemKey: "notes", toType: "text" }],
    }];
    const newBase = structuredClone(oldBase);
    newBase.schemaVersion = 2;
    newBase.migrations = [{
      fromVersion: 1,
      operations: [{ op: "mapValue", sectionKey: "plan", systemKey: "provider", mapping: { old: "new" } }],
    }];

    expect(rebaseCustomPack(oldBase, custom, newBase).migrations[0].operations).toHaveLength(2);
  });
});
