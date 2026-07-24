import { describe, expect, it } from "vitest";
import type { FieldDefinition, FormPack, PackSection } from "../domain/formModel";
import {
  addFieldToTarget,
  addSectionToTarget,
  removeInTarget,
  removeSectionInTarget,
  type EditTarget,
} from "./editorEdits";

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

  it("rejects removing a protected base field (delegates to removeField's guard)", () => {
    // deviceName is protected in the fixture.
    expect(() => removeInTarget(base(), BASE_TARGET, "devices", "device", "deviceName")).toThrow(
      /protected/i,
    );
  });

  it("does not mutate the input pack (module-target removal)", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    removeInTarget(input, SECRETS_ON, "devices", "device", "deviceName");
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

const NEW_SECTION: PackSection = {
  sectionKey: "crypto", title: "Crypto", lede: "", multiRecord: true, order: 5,
  readinessRule: { requiredKeys: ["walletName"] },
  kitMapping: { entries: [{ heading: "Crypto", fields: ["walletName"] }] },
  groups: [{ groupKey: "wallet", title: "Wallet", repeatable: false, order: 1, fields: [
    { systemKey: "walletName", label: "Wallet name", type: "text", required: true, protected: true, order: 1 },
  ] }],
};

describe("addSectionToTarget", () => {
  it("appends a section to the base pack when the target is base", () => {
    const out = addSectionToTarget(base(), BASE_TARGET, NEW_SECTION);
    expect(out.sections.map((s) => s.sectionKey)).toContain("crypto");
    expect(option(out, "secrets", "on").addSections ?? []).toHaveLength(0);
  });

  it("appends { order, section } to a module option's addSections when target is a module option", () => {
    const out = addSectionToTarget(base(), SECRETS_ON, NEW_SECTION);
    expect(out.sections.map((s) => s.sectionKey)).not.toContain("crypto");
    const added = option(out, "secrets", "on").addSections!;
    expect(added).toHaveLength(1);
    expect(added[0]!.section.sectionKey).toBe("crypto");
    expect(added[0]!.order).toBe(NEW_SECTION.order);
  });

  it("does not mutate the input pack", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    addSectionToTarget(input, SECRETS_ON, NEW_SECTION);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("removeSectionInTarget", () => {
  it("drops the section from the base pack when the target is base", () => {
    const withSection = addSectionToTarget(base(), BASE_TARGET, NEW_SECTION);
    const out = removeSectionInTarget(withSection, BASE_TARGET, "crypto");
    expect(out.sections.map((s) => s.sectionKey)).not.toContain("crypto");
  });

  it("adds the sectionKey to a module option's removeSectionKeys when target is a module option", () => {
    const out = removeSectionInTarget(base(), SECRETS_ON, "devices");
    expect(out.sections.map((s) => s.sectionKey)).toContain("devices");
    expect(option(out, "secrets", "on").removeSectionKeys).toEqual(["devices"]);
  });

  it("does not duplicate a key already in removeSectionKeys", () => {
    const once = removeSectionInTarget(base(), SECRETS_ON, "devices");
    const twice = removeSectionInTarget(once, SECRETS_ON, "devices");
    expect(option(twice, "secrets", "on").removeSectionKeys).toEqual(["devices"]);
  });
});

describe("unknown target", () => {
  it("is a no-op when the target names a module/option that does not exist", () => {
    const target: EditTarget = { kind: "module", moduleId: "nope", optionId: "x" };
    const out = addFieldToTarget(base(), target, "devices", "device", NEW_FIELD);
    // No module gained an addField; nothing threw.
    expect(option(out, "secrets", "on").addFields ?? []).toHaveLength(0);
    expect(out.modules).toHaveLength(1);
  });
});
