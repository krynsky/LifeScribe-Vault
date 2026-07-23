import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FormModule, FormPack, PackSection } from "./formModel";
import { composePack } from "./composePack";
import { loadPack, validateModules, validatePack, validatePackUpgrade } from "./packValidation";
import { makeField, makeGroup, makePack, makePlanPack, makeSection } from "./testing/fixtures";

// Vitest runs with cwd = apps/desktop
const DEFAULT_PACK_PATH = resolve(process.cwd(), "src-tauri/resources/packs/default-pack.json");

const defaultPackJson = readFileSync(DEFAULT_PACK_PATH, "utf-8");

function mutatePack(mutate: (pack: Record<string, unknown>) => void): unknown {
  const pack = JSON.parse(defaultPackJson) as Record<string, unknown>;
  mutate(pack);
  return pack;
}

type JsonSection = {
  readinessRule: { requiredKeys: string[] };
  kitMapping: { entries: { heading: string; fields: string[] }[] };
  groups: { fields: Record<string, unknown>[] }[];
};

function mutateFirstField(mutate: (field: Record<string, unknown>) => void): unknown {
  return mutatePack((pack) => {
    const section = (pack.sections as JsonSection[])[0];
    mutate(section.groups[0].fields[0]);
  });
}

describe("validatePack", () => {
  it("accepts the bundled default pack", () => {
    const result = validatePack(JSON.parse(defaultPackJson));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.packId).toBe("lifescribe-default");
      expect(result.pack.schemaVersion).toBe(1);
    }
  });

  it("rejects non-object packs", () => {
    expect(validatePack("not a pack").errors).toEqual(["Pack must be a JSON object."]);
    expect(validatePack(null).ok).toBe(false);
  });

  it("requires packId, packVersion, schemaVersion and minAppVersion", () => {
    const result = validatePack({ sections: [], migrations: [] });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Pack must have a non-empty packId.",
        "Pack must have a non-empty packVersion.",
        "Pack schemaVersion must be a positive integer.",
        "Pack must have a non-empty minAppVersion.",
      ]),
    );
  });

  it("rejects a non-integer schemaVersion", () => {
    const result = validatePack(mutatePack((pack) => (pack.schemaVersion = 1.5)));
    expect(result.errors).toContain("Pack schemaVersion must be a positive integer.");
  });

  it("rejects unsupported field types with a type whitelist error", () => {
    const result = validatePack(mutateFirstField((field) => (field.type = "javascript")));
    expect(result.errors.join(" ")).toMatch(/unsupported type "javascript"/);
  });

  it("accepts a file field type", () => {
    const result = validatePack(
      mutatePack((pack) => {
        const fields = (pack.sections as JsonSection[])[0].groups[0].fields;
        fields.push({ systemKey: "willPdf", label: "Will", type: "file", required: false, protected: false, order: 99 });
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects options on a file field", () => {
    const result = validatePack(
      mutatePack((pack) => {
        const fields = (pack.sections as JsonSection[])[0].groups[0].fields;
        fields.push({ systemKey: "willPdf", label: "Will", type: "file", required: false, protected: false, order: 99, options: [{ value: "a", label: "A" }] });
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/file field .* must not declare options/i);
  });

  it("rejects select fields without options", () => {
    const result = validatePack(
      mutatePack((pack) => {
        const fields = (pack.sections as JsonSection[])[0].groups[0].fields;
        const select = fields.find((field) => field.type === "select") as Record<string, unknown>;
        select.options = [];
      }),
    );
    expect(result.errors.join(" ")).toMatch(/select field executorRole must include at least one option/);
  });

  it("rejects duplicate systemKeys within a section", () => {
    const result = validatePack(
      mutatePack((pack) => {
        const fields = (pack.sections as JsonSection[])[0].groups[0].fields;
        fields.push({ ...fields[0] });
      }),
    );
    expect(result.errors).toContain(
      "Section digital-executors: duplicate field systemKey executorName.",
    );
  });

  it("rejects expression-string conditionals — declarative objects only", () => {
    const result = validatePack(
      mutateFirstField((field) => (field.visibleWhen = "values.executorRole === 'backup'")),
    );
    expect(result.errors.join(" ")).toMatch(/declarative condition object, not an expression string/);
  });

  it("rejects conditionals with extra or unknown shapes", () => {
    const result = validatePack(
      mutateFirstField(
        (field) => (field.visibleWhen = { field: "executorRole", equals: "backup", script: "x()" }),
      ),
    );
    expect(result.errors.join(" ")).toMatch(/no other shapes are allowed/);
  });

  it("requires protected fields to also be required", () => {
    const result = validatePack(mutateFirstField((field) => (field.required = false)));
    expect(result.errors).toContain(
      "Section digital-executors: protected field executorName must also be required.",
    );
  });

  it("rejects readiness rules that reference unknown fields", () => {
    const result = validatePack(
      mutatePack((pack) => {
        (pack.sections as JsonSection[])[0].readinessRule.requiredKeys = ["ghostField"];
      }),
    );
    expect(result.errors).toContain(
      "Section digital-executors: readiness rule references unknown field ghostField.",
    );
  });

  it("rejects readiness rules that reference unprotected fields", () => {
    const result = validatePack(
      mutatePack((pack) => {
        (pack.sections as JsonSection[])[0].readinessRule.requiredKeys = ["executorRelationship"];
      }),
    );
    expect(result.errors).toContain(
      "Section digital-executors: readiness rule may only reference protected fields, but executorRelationship is not protected.",
    );
  });

  it("rejects kit mappings that reference unknown fields", () => {
    const result = validatePack(
      mutatePack((pack) => {
        (pack.sections as JsonSection[])[0].kitMapping.entries[0].fields = ["ghostField"];
      }),
    );
    expect(result.errors).toContain(
      "Section digital-executors: kit mapping references unknown field ghostField.",
    );
  });

  it("rejects custom-namespace systemKeys in default packs", () => {
    const result = validatePack(
      mutateFirstField((field) => (field.systemKey = "custom.digital-executors.sneaky")),
    );
    expect(result.errors).toContain(
      "Section digital-executors: default packs may not contain custom-namespace field custom.digital-executors.sneaky.",
    );
  });

  it("rejects unknown migration operations — migrations are data, not scripts", () => {
    const result = validatePack(
      mutatePack((pack) => {
        pack.migrations = [{ fromVersion: 1, operations: [{ op: "runScript", code: "x()" }] }];
      }),
    );
    expect(result.errors.join(" ")).toMatch(/unknown operation "runScript"/);
  });

  it("rejects malformed migration steps", () => {
    const result = validatePack(mutatePack((pack) => (pack.migrations = [{ operations: [] }])));
    expect(result.errors).toContain(
      "Each migration step must declare a positive integer fromVersion.",
    );
  });
});

describe("validatePackUpgrade", () => {
  const previous = makePlanPack();

  function packWithoutField(systemKey: string, extra?: Partial<FormPack>): FormPack {
    const base = makePlanPack({ schemaVersion: 2, packVersion: "2.0.0", ...extra });
    return {
      ...base,
      sections: base.sections.map((section) => ({
        ...section,
        groups: section.groups.map((group) => ({
          ...group,
          fields: group.fields.filter((field) => field.systemKey !== systemKey),
        })),
        readinessRule: {
          requiredKeys: section.readinessRule.requiredKeys.filter((key) => key !== systemKey),
        },
        kitMapping: {
          entries: section.kitMapping.entries.map((entry) => ({
            ...entry,
            fields: entry.fields.filter((key) => key !== systemKey),
          })),
        },
      })),
    };
  }

  it("rejects deleting a protected systemKey with a specific error", () => {
    const next = packWithoutField("provider");
    expect(validatePackUpgrade(previous, next).errors).toEqual([
      "Protected field plan.provider cannot be deleted; renames require an authored renameField migration to a field that still exists.",
    ]);
  });

  it("rejects retyping a protected systemKey with a specific error", () => {
    const next = makePlanPack({ schemaVersion: 2 });
    const field = next.sections[0].groups[0].fields[0];
    field.type = "text";
    delete field.options;
    expect(validatePackUpgrade(previous, next).errors).toEqual([
      "Protected field plan.provider cannot change type from select to text.",
    ]);
  });

  it("rejects demoting a protected field to unprotected", () => {
    const next = makePlanPack({ schemaVersion: 2 });
    const field = next.sections[0].groups[0].fields[0];
    field.protected = false;
    expect(validatePackUpgrade(previous, next).errors).toContain(
      "Protected field plan.provider must remain protected.",
    );
  });

  it("allows renaming a protected field when an authored migration covers it", () => {
    const next = packWithoutField("provider", {
      migrations: [
        {
          fromVersion: 1,
          operations: [{ op: "renameField", sectionKey: "plan", fromKey: "provider", toKey: "vaultProvider" }],
        },
      ],
    });
    next.sections[0].groups[0].fields.unshift(
      makeField({
        systemKey: "vaultProvider",
        label: "Vault provider",
        type: "select",
        required: true,
        protected: true,
        options: [{ value: "Other", label: "Other" }],
        order: 0,
      }),
    );
    next.sections[0].readinessRule.requiredKeys.push("vaultProvider");
    expect(validatePackUpgrade(previous, next).errors).toEqual([]);
  });

  it("rejects a schemaVersion decrease", () => {
    const next = makePlanPack({ schemaVersion: 0.5 as number });
    expect(validatePackUpgrade(previous, next).errors).toContain(
      "Pack schemaVersion may not decrease (was 1, incoming 0.5).",
    );
  });

  it("warns when an unprotected field is removed without an authored migration", () => {
    const next = packWithoutField("notes");
    const result = validatePackUpgrade(previous, next);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain(
      "Field plan.notes was removed without an authored migration; existing values will become archived answers.",
    );
  });

  it("warns when an unprotected field is retyped without an authored migration", () => {
    const next = makePlanPack({ schemaVersion: 2 });
    const notes = next.sections[0].groups[0].fields.find((field) => field.systemKey === "notes");
    notes!.type = "date";
    const result = validatePackUpgrade(previous, next);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain(
      "Field plan.notes changed type from textarea to date without an authored migration; non-conforming values will be archived.",
    );
  });

  it("does not warn for a retype covered by an authored retypeField migration", () => {
    const next = makePlanPack({
      schemaVersion: 2,
      migrations: [
        {
          fromVersion: 1,
          operations: [{ op: "retypeField", sectionKey: "plan", systemKey: "notes", toType: "date" }],
        },
      ],
    });
    next.sections[0].groups[0].fields.find((field) => field.systemKey === "notes")!.type = "date";
    expect(validatePackUpgrade(previous, next).warnings).toEqual([]);
  });

  it("warns when a repeatable group becomes single without an authored migration", () => {
    const next = makePlanPack({ schemaVersion: 2 });
    next.sections[0].groups[1].repeatable = false;
    const result = validatePackUpgrade(previous, next);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain(
      "Group plan.contact is no longer repeatable without an authored migration; records beyond the first will become archived answers.",
    );
  });

  it("warns when a multi-record section becomes a singleton without an authored migration", () => {
    const before = makePack({
      sections: [
        makeSection({
          sectionKey: "devices",
          multiRecord: true,
          groups: [makeGroup({ groupKey: "device", fields: [makeField({ systemKey: "deviceName" })] })],
        }),
      ],
    });
    const next = {
      ...before,
      schemaVersion: 2,
      sections: [{ ...before.sections[0], multiRecord: false }],
    };
    expect(validatePackUpgrade(before, next).warnings).toContain(
      "Section devices is no longer multi-record without an authored migration; records beyond the first will become archived answers.",
    );
  });

  it("promotes warnings to errors in strict mode (creator export)", () => {
    const next = packWithoutField("notes");
    const result = validatePackUpgrade(previous, next, { strict: true });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toContain(
      "Field plan.notes was removed without an authored migration; existing values will become archived answers.",
    );
  });
});

describe("loadPack", () => {
  const lastGood = makePlanPack();

  it("loads a valid pack without falling back", () => {
    const result = loadPack(defaultPackJson, { maxSupportedSchemaVersion: 1, lastGoodPack: lastGood });
    expect(result.usedFallback).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.pack?.packId).toBe("lifescribe-default");
  });

  it("falls back to the last-good pack on malformed JSON", () => {
    const result = loadPack("{ not json", { maxSupportedSchemaVersion: 1, lastGoodPack: lastGood });
    expect(result.usedFallback).toBe(true);
    expect(result.pack).toBe(lastGood);
    expect(result.errors[0]).toMatch(/^Pack JSON is malformed:/);
  });

  it("falls back to the last-good pack when validation fails", () => {
    const broken = JSON.stringify(mutateFirstField((field) => (field.type = "number")));
    const result = loadPack(broken, { maxSupportedSchemaVersion: 1, lastGoodPack: lastGood });
    expect(result.usedFallback).toBe(true);
    expect(result.pack).toBe(lastGood);
    expect(result.errors.join(" ")).toMatch(/unsupported type/);
  });

  it("refuses a pack whose schemaVersion is beyond the app's migration range", () => {
    const tooNew = JSON.stringify(mutatePack((pack) => (pack.schemaVersion = 99)));
    const result = loadPack(tooNew, { maxSupportedSchemaVersion: 3, lastGoodPack: lastGood });
    expect(result.usedFallback).toBe(true);
    expect(result.pack).toBe(lastGood);
    expect(result.errors).toEqual([
      "Pack schemaVersion 99 is newer than this app supports (max 3). Update the app to use this pack.",
    ]);
  });

  it("returns a null pack when there is no last-good fallback", () => {
    const result = loadPack("{ not json", { maxSupportedSchemaVersion: 1 });
    expect(result.usedFallback).toBe(true);
    expect(result.pack).toBeNull();
  });

  it("rejects an upgrade that violates protected-key rules and keeps the last-good pack", () => {
    const next = makePlanPack({ schemaVersion: 2 });
    next.sections[0].groups[0].fields = next.sections[0].groups[0].fields.filter(
      (field) => field.systemKey !== "provider",
    );
    next.sections[0].readinessRule.requiredKeys = [];
    next.sections[0].kitMapping.entries = [];
    const result = loadPack(JSON.stringify(next), {
      maxSupportedSchemaVersion: 3,
      lastGoodPack: lastGood,
      previousPack: lastGood,
    });
    expect(result.usedFallback).toBe(true);
    expect(result.pack).toBe(lastGood);
    expect(result.errors.join(" ")).toMatch(/Protected field plan\.provider cannot be deleted/);
  });
});

function moduleBasePack(): FormPack {
  return {
    packId: "base",
    packVersion: "1.0.0",
    schemaVersion: 1,
    minAppVersion: "0.0.0",
    migrations: [],
    sections: [
      {
        sectionKey: "devices",
        title: "Devices",
        lede: "",
        multiRecord: true,
        order: 1,
        readinessRule: { requiredKeys: ["deviceName"] },
        kitMapping: { entries: [{ heading: "Devices", fields: ["deviceName"] }] },
        groups: [
          {
            groupKey: "device",
            title: "Device",
            repeatable: false,
            order: 1,
            fields: [
              { systemKey: "deviceName", label: "Device name", type: "text", required: true, protected: true, order: 1 },
              { systemKey: "unlockHint", label: "Unlock hint", type: "text", required: false, protected: false, order: 2 },
            ],
          },
        ],
      },
    ],
  };
}

function addFieldModule(systemKey: string, order = 3): FormModule {
  return {
    moduleId: "secrets",
    title: "Secrets",
    question: "?",
    order: 1,
    defaultOptionId: "off",
    options: [
      { optionId: "off" },
      {
        optionId: "on",
        addFields: [
          {
            sectionKey: "devices",
            groupKey: "device",
            order,
            field: { systemKey, label: "PIN", type: "text", required: false, protected: false, order },
          },
        ],
      },
    ],
  };
}

describe("validateModules", () => {
  it("accepts a well-formed module that composes to a valid pack", () => {
    const pack = { ...moduleBasePack(), modules: [addFieldModule("devicePin")] };
    expect(validateModules(pack, composePack).errors).toEqual([]);
  });

  it("rejects a removeKeys that targets a protected field", () => {
    const remove: FormModule = {
      moduleId: "trim", title: "Trim", question: "?", order: 1, defaultOptionId: "keep",
      options: [{ optionId: "keep" }, { optionId: "drop", removeKeys: ["deviceName"] }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [remove] }, composePack);
    expect(errors.join(" ")).toMatch(/protected/i);
  });

  it("rejects a removeKeys that references an unknown field", () => {
    const remove: FormModule = {
      moduleId: "trim", title: "Trim", question: "?", order: 1, defaultOptionId: "keep",
      options: [{ optionId: "keep" }, { optionId: "drop", removeKeys: ["ghost"] }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [remove] }, composePack);
    expect(errors.join(" ")).toMatch(/unknown field/i);
  });

  it("rejects an added systemKey in the custom.* namespace", () => {
    const pack = { ...moduleBasePack(), modules: [addFieldModule("custom.devices.x")] };
    const { errors } = validateModules(pack, composePack);
    expect(errors.join(" ")).toMatch(/custom\./);
  });

  it("rejects the same systemKey added by two different modules", () => {
    const a = addFieldModule("dup");
    const b = { ...addFieldModule("dup"), moduleId: "other", order: 2 };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [a, b] }, composePack);
    expect(errors.join(" ")).toMatch(/added by more than one module/i);
  });

  it("rejects a module with fewer than two options", () => {
    const one: FormModule = {
      moduleId: "x", title: "X", question: "?", order: 1, defaultOptionId: "a",
      options: [{ optionId: "a" }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [one] }, composePack);
    expect(errors.join(" ")).toMatch(/at least two options/i);
  });

  it("rejects a defaultOptionId that is not one of the options", () => {
    const bad: FormModule = {
      moduleId: "x", title: "X", question: "?", order: 1, defaultOptionId: "missing",
      options: [{ optionId: "a" }, { optionId: "b" }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [bad] }, composePack);
    expect(errors.join(" ")).toMatch(/defaultOptionId/i);
  });

  it("reports a module option that fails to compose", () => {
    const bad: FormModule = {
      moduleId: "bad", title: "Bad", question: "?", order: 1, defaultOptionId: "on",
      options: [{ optionId: "on", addFields: [{ sectionKey: "devices", groupKey: "ghost", order: 1,
        field: { systemKey: "x", label: "X", type: "text", required: false, protected: false, order: 1 } }] }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [bad] }, composePack);
    expect(errors.join(" ")).toMatch(/failed to compose/i);
  });

  it("reports a module option whose composed pack is invalid", () => {
    const bad: FormModule = {
      moduleId: "bad", title: "Bad", question: "?", order: 1, defaultOptionId: "on",
      options: [{ optionId: "on", addFields: [{ sectionKey: "devices", groupKey: "device", order: 3,
        field: { systemKey: "blank", label: "", type: "text", required: false, protected: false, order: 3 } }] }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [bad] }, composePack);
    expect(errors.join(" ")).toMatch(/produces an invalid pack/i);
  });

  it("rejects removeSectionKeys that references an unknown section", () => {
    const mod: FormModule = {
      moduleId: "trim", title: "Trim", question: "?", order: 1, defaultOptionId: "keep",
      options: [{ optionId: "keep" }, { optionId: "drop", removeSectionKeys: ["ghost"] }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [mod] }, composePack);
    expect(errors.join(" ")).toMatch(/unknown section/i);
  });

  it("rejects an added section whose key collides with a base section", () => {
    const mod: FormModule = {
      moduleId: "dup", title: "Dup", question: "?", order: 1, defaultOptionId: "off",
      options: [
        { optionId: "off" },
        { optionId: "on", addSections: [{ order: 2, section: {
          sectionKey: "devices", title: "Dupe", lede: "", multiRecord: false, order: 2,
          readinessRule: { requiredKeys: [] }, kitMapping: { entries: [{ heading: "x", fields: [] }] },
          groups: [{ groupKey: "g", title: "G", repeatable: false, order: 1, fields: [
            { systemKey: "gf", label: "GF", type: "text", required: false, protected: false, order: 1 },
          ] }],
        } }] },
      ],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [mod] }, composePack);
    expect(errors.join(" ")).toMatch(/collides with a base section|already exists/i);
  });

  it("rejects the same section key added by two different modules", () => {
    const makeAdder = (moduleId: string, order: number): FormModule => ({
      moduleId, title: moduleId, question: "?", order, defaultOptionId: "off",
      options: [
        { optionId: "off" },
        { optionId: "on", addSections: [{ order: 2, section: {
          sectionKey: "extra", title: "Extra", lede: "", multiRecord: false, order: 2,
          readinessRule: { requiredKeys: [] }, kitMapping: { entries: [{ heading: "x", fields: [] }] },
          groups: [{ groupKey: "g", title: "G", repeatable: false, order: 1, fields: [
            { systemKey: "gf", label: "GF", type: "text", required: false, protected: false, order: 1 },
          ] }],
        } }] },
      ],
    });
    const { errors } = validateModules(
      { ...moduleBasePack(), modules: [makeAdder("a", 1), makeAdder("b", 2)] },
      composePack,
    );
    expect(errors.join(" ")).toMatch(/section .* added by more than one module/i);
  });

  it("rejects the same field systemKey nested in sections added by two modules", () => {
    const sectionWith = (sectionKey: string): PackSection => ({
      sectionKey, title: sectionKey, lede: "", multiRecord: false, order: 2,
      readinessRule: { requiredKeys: [] }, kitMapping: { entries: [{ heading: "x", fields: [] }] },
      groups: [{ groupKey: "g", title: "G", repeatable: false, order: 1, fields: [
        { systemKey: "dupField", label: "Dup", type: "text", required: false, protected: false, order: 1 },
      ] }],
    });
    const modA: FormModule = { moduleId: "a", title: "A", question: "?", order: 1, defaultOptionId: "off",
      options: [{ optionId: "off" }, { optionId: "on", addSections: [{ order: 2, section: sectionWith("secA") }] }] };
    const modB: FormModule = { moduleId: "b", title: "B", question: "?", order: 2, defaultOptionId: "off",
      options: [{ optionId: "off" }, { optionId: "on", addSections: [{ order: 3, section: sectionWith("secB") }] }] };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [modA, modB] }, composePack);
    expect(errors.join(" ")).toMatch(/added by more than one module/i);
  });

  it("accepts a well-formed section-adding module (protected readiness field allowed inside an added section)", () => {
    const mod: FormModule = {
      moduleId: "crypto", title: "Crypto", question: "?", order: 1, defaultOptionId: "off",
      options: [
        { optionId: "off" },
        { optionId: "on", addSections: [{ order: 2, section: {
          sectionKey: "crypto", title: "Crypto", lede: "", multiRecord: true, order: 2,
          readinessRule: { requiredKeys: ["walletName"] },
          kitMapping: { entries: [{ heading: "Crypto", fields: ["walletName"] }] },
          groups: [{ groupKey: "wallet", title: "Wallet", repeatable: false, order: 1, fields: [
            { systemKey: "walletName", label: "Wallet name", type: "text", required: true, protected: true, order: 1 },
          ] }],
        } }] },
      ],
    };
    expect(validateModules({ ...moduleBasePack(), modules: [mod] }, composePack).errors).toEqual([]);
  });

  it("does not raise a protected-field error when a module removes a whole section", () => {
    const mod: FormModule = {
      moduleId: "simple", title: "Simple", question: "?", order: 1, defaultOptionId: "keep",
      options: [{ optionId: "keep" }, { optionId: "drop", removeSectionKeys: ["devices"] }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [mod] }, composePack);
    // (removing the only section will fail validatePack for emptiness — that's fine;
    //  the point is that NO "protected" error is raised for the removal itself.)
    expect(errors.join(" ")).not.toMatch(/protected/i);
  });

  it("allows an option to replace a section (remove + re-add the same key)", () => {
    const mod: FormModule = {
      moduleId: "replace", title: "Replace", question: "?", order: 1, defaultOptionId: "keep",
      options: [
        { optionId: "keep" },
        { optionId: "on", removeSectionKeys: ["devices"], addSections: [{ order: 1, section: {
          sectionKey: "devices", title: "Devices v2", lede: "", multiRecord: false, order: 1,
          readinessRule: { requiredKeys: [] }, kitMapping: { entries: [{ heading: "x", fields: [] }] },
          groups: [{ groupKey: "g", title: "G", repeatable: false, order: 1, fields: [
            { systemKey: "dv2", label: "DV2", type: "text", required: false, protected: false, order: 1 },
          ] }],
        } }] },
      ],
    };
    expect(validateModules({ ...moduleBasePack(), modules: [mod] }, composePack).errors).toEqual([]);
  });
});

describe("validatePack wiring for modules", () => {
  it("accepts a valid module-bearing pack", () => {
    expect(validatePack({ ...moduleBasePack(), modules: [addFieldModule("devicePin")] }).ok).toBe(true);
  });

  it("rejects a pack with a structurally-bad module", () => {
    expect(
      validatePack({
        ...moduleBasePack(),
        modules: [{ moduleId: "x", title: "X", question: "?", order: 1, defaultOptionId: "a", options: [{ optionId: "a" }] }],
      }).ok,
    ).toBe(false);
  });

  it("rejects a non-array modules value", () => {
    const r = validatePack({ ...moduleBasePack(), modules: {} as never });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/modules must be an array/i);
  });

  it("still accepts a plain pack with no modules", () => {
    expect(validatePack(moduleBasePack()).ok).toBe(true);
  });

  it("does not throw when a malformed base pack carries modules", () => {
    const malformed = { ...moduleBasePack(), sections: "nope", modules: [addFieldModule("x")] } as never;
    expect(() => validatePack(malformed)).not.toThrow();
    expect(validatePack(malformed).ok).toBe(false);
  });
});
