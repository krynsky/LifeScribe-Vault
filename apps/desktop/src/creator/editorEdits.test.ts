import { describe, expect, it } from "vitest";
import type { FieldDefinition, FormPack } from "../domain/formModel";
import { addFieldToTarget, removeInTarget, type EditTarget } from "./editorEdits";

const NEW_FIELD: FieldDefinition = {
  systemKey: "note", label: "Note", type: "text", required: false, protected: false, order: 99,
};

function base(): FormPack {
  return {
    packId: "b", packVersion: "1.0.0", schemaVersion: 1, minAppVersion: "0.0.0", migrations: [],
    sections: [
      {
        sectionKey: "devices", title: "Devices", lede: "", multiRecord: true, order: 1,
        readinessRule: { requiredKeys: ["deviceName"] },
        kitMapping: { entries: [{ heading: "Devices", fields: ["deviceName"] }] },
        groups: [{ groupKey: "device", title: "Device", repeatable: false, order: 1, fields: [
          { systemKey: "deviceName", label: "Device name", type: "text", required: true, protected: true, order: 1 },
        ] }],
      },
    ],
    modules: [
      { moduleId: "secrets", title: "Secrets", question: "?", order: 1, defaultOptionId: "off",
        options: [{ optionId: "off" }, { optionId: "on" }] },
    ],
  };
}

const BASE_TARGET: EditTarget = { kind: "base" };
const SECRETS_ON: EditTarget = { kind: "module", moduleId: "secrets", optionId: "on" };

function group(pack: FormPack, sectionKey: string, groupKey: string) {
  return pack.sections.find((s) => s.sectionKey === sectionKey)!.groups.find((g) => g.groupKey === groupKey)!;
}
function option(pack: FormPack, moduleId: string, optionId: string) {
  return pack.modules!.find((m) => m.moduleId === moduleId)!.options.find((o) => o.optionId === optionId)!;
}

describe("addFieldToTarget", () => {
  it("adds a field into a base group when the target is base", () => {
    const out = addFieldToTarget(base(), BASE_TARGET, "devices", "device", NEW_FIELD);
    expect(group(out, "devices", "device").fields.map((f) => f.systemKey)).toContain("note");
    expect(option(out, "secrets", "on").addFields ?? []).toHaveLength(0);
  });

  it("adds a field into a module option's addFields when the target is a module option", () => {
    const out = addFieldToTarget(base(), SECRETS_ON, "devices", "device", NEW_FIELD);
    expect(group(out, "devices", "device").fields.map((f) => f.systemKey)).not.toContain("note");
    const added = option(out, "secrets", "on").addFields!;
    expect(added).toHaveLength(1);
    expect(added[0]!.sectionKey).toBe("devices");
    expect(added[0]!.groupKey).toBe("device");
    expect(added[0]!.field.systemKey).toBe("note");
  });

  it("does not mutate the input pack", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    addFieldToTarget(input, SECRETS_ON, "devices", "device", NEW_FIELD);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("removeInTarget", () => {
  it("deletes an unprotected base field outright when the target is base", () => {
    const withField = addFieldToTarget(base(), BASE_TARGET, "devices", "device", NEW_FIELD);
    const out = removeInTarget(withField, BASE_TARGET, "devices", "device", "note");
    expect(group(out, "devices", "device").fields.map((f) => f.systemKey)).not.toContain("note");
  });

  it("adds the key to a module option's removeKeys when the target is a module option", () => {
    const out = removeInTarget(base(), SECRETS_ON, "devices", "device", "deviceName");
    expect(group(out, "devices", "device").fields.map((f) => f.systemKey)).toContain("deviceName");
    expect(option(out, "secrets", "on").removeKeys).toEqual(["deviceName"]);
  });

  it("does not duplicate a key already in the option's removeKeys", () => {
    const once = removeInTarget(base(), SECRETS_ON, "devices", "device", "deviceName");
    const twice = removeInTarget(once, SECRETS_ON, "devices", "device", "deviceName");
    expect(option(twice, "secrets", "on").removeKeys).toEqual(["deviceName"]);
  });
});
