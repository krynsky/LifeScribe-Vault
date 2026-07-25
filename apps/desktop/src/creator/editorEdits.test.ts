import { describe, expect, it } from "vitest";
import type { FieldDefinition, FormPack, PackSection } from "../domain/formModel";
import { validateModules } from "../domain/packValidation";
import { composePack } from "../domain/composePack";
import {
  addFieldToTarget,
  addModule,
  addModuleOption,
  addSectionToTarget,
  removeInTarget,
  removeModule,
  removeModuleOption,
  removeSectionInTarget,
  renameSectionInTarget,
  setModuleDefaultOption,
  updateFieldInTarget,
  updateModuleDetails,
  updateModuleOptionLabel,
  updateSectionInTarget,
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

  it("undoes the option's own addFields entry instead of recording a dead removeKeys entry", () => {
    // composePack/buildEditorView apply removeKeys BEFORE addFields within the
    // same option, so a removeKeys entry for a field this option itself added
    // would never take effect — it must splice the addFields entry instead.
    const withAdd = addFieldToTarget(base(), SECRETS_ON, "devices", "device", NEW_FIELD);
    const out = removeInTarget(withAdd, SECRETS_ON, "devices", "device", "note");
    expect(option(out, "secrets", "on").addFields ?? []).toHaveLength(0);
    expect(option(out, "secrets", "on").removeKeys ?? []).not.toContain("note");
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

  it("undoes the option's own addSections entry instead of recording a dead removeSectionKeys entry", () => {
    // composePack/buildEditorView apply removeSectionKeys BEFORE addSections
    // within the same option, so a removeSectionKeys entry for a section this
    // option itself added would never take effect — it must splice the
    // addSections entry instead.
    const withAdd = addSectionToTarget(base(), SECRETS_ON, NEW_SECTION);
    const out = removeSectionInTarget(withAdd, SECRETS_ON, "crypto");
    expect(option(out, "secrets", "on").addSections ?? []).toHaveLength(0);
    expect(option(out, "secrets", "on").removeSectionKeys ?? []).not.toContain("crypto");
  });
});

describe("renameSectionInTarget", () => {
  it("renames a base section directly when the target is base", () => {
    const out = renameSectionInTarget(base(), BASE_TARGET, "devices", "Gadgets");
    expect(out.sections.find((s) => s.sectionKey === "devices")!.title).toBe("Gadgets");
  });

  it("renames a module option's addSections entry when the target is a module option", () => {
    const withSection = addSectionToTarget(base(), SECRETS_ON, NEW_SECTION);
    const out = renameSectionInTarget(withSection, SECRETS_ON, "crypto", "Digital Assets");
    const added = option(out, "secrets", "on").addSections!;
    expect(added).toHaveLength(1);
    expect(added[0]!.section.title).toBe("Digital Assets");
    // The base pack's own sections are untouched.
    expect(out.sections.map((s) => s.sectionKey)).not.toContain("crypto");
  });

  it("is a no-op when the module option did not add a section by that key", () => {
    const out = renameSectionInTarget(base(), SECRETS_ON, "devices", "Gadgets");
    expect(option(out, "secrets", "on").addSections ?? []).toHaveLength(0);
    expect(out.sections.find((s) => s.sectionKey === "devices")!.title).toBe("Devices");
  });

  it("does not mutate the input pack", () => {
    const input = addSectionToTarget(base(), SECRETS_ON, NEW_SECTION);
    const snapshot = JSON.stringify(input);
    renameSectionInTarget(input, SECRETS_ON, "crypto", "Digital Assets");
    expect(JSON.stringify(input)).toBe(snapshot);
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

describe("updateSectionInTarget", () => {
  it("updates a base section's lede/multiRecord directly when the target is base", () => {
    const out = updateSectionInTarget(base(), BASE_TARGET, "devices", (s) => ({
      ...s,
      lede: "New lede",
      multiRecord: false,
    }));
    const section = out.sections.find((s) => s.sectionKey === "devices")!;
    expect(section.lede).toBe("New lede");
    expect(section.multiRecord).toBe(false);
  });

  it("updates a module option's addSections entry when the target is a module option", () => {
    const withSection = addSectionToTarget(base(), SECRETS_ON, NEW_SECTION);
    const out = updateSectionInTarget(withSection, SECRETS_ON, "crypto", (s) => ({ ...s, lede: "Vault lede" }));
    const added = option(out, "secrets", "on").addSections!;
    expect(added[0]!.section.lede).toBe("Vault lede");
    // The base pack's own sections are untouched.
    expect(out.sections.map((s) => s.sectionKey)).not.toContain("crypto");
  });

  it("is a no-op when the module option did not add a section by that key", () => {
    const out = updateSectionInTarget(base(), SECRETS_ON, "devices", (s) => ({ ...s, lede: "x" }));
    expect(option(out, "secrets", "on").addSections ?? []).toHaveLength(0);
    expect(out.sections.find((s) => s.sectionKey === "devices")!.lede).toBe("");
  });

  it("does not mutate the input pack", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    updateSectionInTarget(input, BASE_TARGET, "devices", (s) => ({ ...s, lede: "x" }));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("updateFieldInTarget", () => {
  it("updates a base field directly when the target is base", () => {
    const updated: FieldDefinition = {
      systemKey: "deviceName", label: "Device Nickname", type: "text", required: true, protected: true, order: 1,
    };
    const out = updateFieldInTarget(base(), BASE_TARGET, "devices", "device", "deviceName", updated);
    expect(group(out, "devices", "device").fields.find((f) => f.systemKey === "deviceName")!.label).toBe(
      "Device Nickname",
    );
  });

  it("updates a field in a module option's addFields when the target owns it via addFields", () => {
    const withAdd = addFieldToTarget(base(), SECRETS_ON, "devices", "device", NEW_FIELD);
    const updated: FieldDefinition = { ...NEW_FIELD, label: "Updated Note" };
    const out = updateFieldInTarget(withAdd, SECRETS_ON, "devices", "device", "note", updated);
    const added = option(out, "secrets", "on").addFields!;
    expect(added).toHaveLength(1);
    expect(added[0]!.field.label).toBe("Updated Note");
    // The base pack's own fields are untouched.
    expect(group(out, "devices", "device").fields.map((f) => f.systemKey)).not.toContain("note");
  });

  it("updates a field inside a module option's addSections entry", () => {
    const withSection = addSectionToTarget(base(), SECRETS_ON, NEW_SECTION);
    const updated: FieldDefinition = {
      systemKey: "walletName", label: "Wallet Nickname", type: "text", required: true, protected: true, order: 1,
    };
    const out = updateFieldInTarget(withSection, SECRETS_ON, "crypto", "wallet", "walletName", updated);
    const added = option(out, "secrets", "on").addSections!;
    expect(added[0]!.section.groups[0]!.fields[0]!.label).toBe("Wallet Nickname");
    expect(out.sections.map((s) => s.sectionKey)).not.toContain("crypto");
  });

  it("is a no-op when the module option does not own the field", () => {
    const updated: FieldDefinition = {
      systemKey: "deviceName", label: "Hijacked", type: "text", required: true, protected: true, order: 1,
    };
    const out = updateFieldInTarget(base(), SECRETS_ON, "devices", "device", "deviceName", updated);
    expect(group(out, "devices", "device").fields.find((f) => f.systemKey === "deviceName")!.label).toBe(
      "Device name",
    );
    expect(option(out, "secrets", "on").addFields ?? []).toHaveLength(0);
    expect(option(out, "secrets", "on").addSections ?? []).toHaveLength(0);
  });

  it("does not mutate the input pack", () => {
    const withAdd = addFieldToTarget(base(), SECRETS_ON, "devices", "device", NEW_FIELD);
    const snapshot = JSON.stringify(withAdd);
    const updated: FieldDefinition = { ...NEW_FIELD, label: "Updated Note" };
    updateFieldInTarget(withAdd, SECRETS_ON, "devices", "device", "note", updated);
    expect(JSON.stringify(withAdd)).toBe(snapshot);
  });
});

describe("addModule", () => {
  it("appends a valid module: unique moduleId, order past the max, >= 2 options, default among them", () => {
    const out = addModule(base());
    expect(out.modules).toHaveLength(2);
    const created = out.modules!.find((m) => m.moduleId !== "secrets")!;
    expect(created.order).toBeGreaterThan(base().modules![0]!.order);
    expect(created.options.length).toBeGreaterThanOrEqual(2);
    expect(created.options.map((o) => o.optionId)).toContain(created.defaultOptionId);
    // The pack as a whole stays valid, per validateModules.
    expect(validateModules(out, composePack).errors).toEqual([]);
  });

  it("does not mutate the input pack", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    addModule(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("assigns a fresh unique moduleId on repeated calls", () => {
    const once = addModule(base());
    const twice = addModule(once);
    const ids = twice.modules!.map((m) => m.moduleId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("removeModule", () => {
  it("removes the module by id, leaving other modules and the base untouched", () => {
    const twoModules = addModule(base());
    const otherId = twoModules.modules!.find((m) => m.moduleId !== "secrets")!.moduleId;
    const out = removeModule(twoModules, "secrets");
    expect(out.modules!.map((m) => m.moduleId)).toEqual([otherId]);
    expect(out.sections).toEqual(base().sections);
  });

  it("is a no-op for an unknown moduleId", () => {
    const out = removeModule(base(), "nope");
    expect(out.modules).toEqual(base().modules);
  });

  it("does not mutate the input pack", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    removeModule(input, "secrets");
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("updateModuleDetails", () => {
  it("patches title/question/helperText", () => {
    const out = updateModuleDetails(base(), "secrets", {
      title: "Secrets & PINs",
      question: "Do you keep secrets?",
      helperText: "Explain your setup.",
    });
    const module = out.modules!.find((m) => m.moduleId === "secrets")!;
    expect(module.title).toBe("Secrets & PINs");
    expect(module.question).toBe("Do you keep secrets?");
    expect(module.helperText).toBe("Explain your setup.");
  });

  it("is a no-op for an unknown moduleId", () => {
    const out = updateModuleDetails(base(), "nope", { title: "x" });
    expect(out.modules).toEqual(base().modules);
  });
});

describe("updateModuleOptionLabel", () => {
  it("renames one option's label without touching the others", () => {
    const out = updateModuleOptionLabel(base(), "secrets", "on", "Yes, I do");
    const module = out.modules!.find((m) => m.moduleId === "secrets")!;
    expect(module.options.find((o) => o.optionId === "on")!.label).toBe("Yes, I do");
    expect(module.options.find((o) => o.optionId === "off")!.label).toBeUndefined();
  });
});

describe("setModuleDefaultOption", () => {
  it("sets the default to an existing option", () => {
    const out = setModuleDefaultOption(base(), "secrets", "on");
    expect(out.modules!.find((m) => m.moduleId === "secrets")!.defaultOptionId).toBe("on");
  });

  it("is a no-op when optionId is not one of the module's options", () => {
    const out = setModuleDefaultOption(base(), "secrets", "nope");
    expect(out.modules!.find((m) => m.moduleId === "secrets")!.defaultOptionId).toBe("off");
  });
});

describe("addModuleOption", () => {
  it("appends a new option with a unique optionId", () => {
    const out = addModuleOption(base(), "secrets");
    const module = out.modules!.find((m) => m.moduleId === "secrets")!;
    expect(module.options).toHaveLength(3);
    const ids = module.options.map((o) => o.optionId);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("removeModuleOption", () => {
  it("removes a non-default option, leaving the default untouched", () => {
    const withThird = addModuleOption(base(), "secrets");
    const thirdId = withThird.modules!.find((m) => m.moduleId === "secrets")!.options[2]!.optionId;
    const out = removeModuleOption(withThird, "secrets", thirdId);
    const module = out.modules!.find((m) => m.moduleId === "secrets")!;
    expect(module.options.map((o) => o.optionId)).not.toContain(thirdId);
    expect(module.defaultOptionId).toBe("off");
  });

  it("auto-corrects the default when the removed option was the default", () => {
    const withThird = addModuleOption(base(), "secrets");
    const out = removeModuleOption(withThird, "secrets", "off");
    const module = out.modules!.find((m) => m.moduleId === "secrets")!;
    expect(module.options.map((o) => o.optionId)).not.toContain("off");
    expect(module.options.map((o) => o.optionId)).toContain(module.defaultOptionId);
  });

  it("refuses to drop below two options (no-op at exactly two)", () => {
    const out = removeModuleOption(base(), "secrets", "on");
    const module = out.modules!.find((m) => m.moduleId === "secrets")!;
    expect(module.options).toHaveLength(2);
    expect(module.options.map((o) => o.optionId)).toContain("on");
  });

  it("is a no-op for an unknown optionId", () => {
    const withThird = addModuleOption(base(), "secrets");
    const out = removeModuleOption(withThird, "secrets", "nope");
    expect(out.modules!.find((m) => m.moduleId === "secrets")!.options).toHaveLength(3);
  });
});
