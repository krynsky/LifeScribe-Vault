import { describe, expect, it } from "vitest";
import type { FormModule, FormPack } from "./formModel";
import { composePack } from "./composePack";

function basePack(): FormPack {
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

const secretsModule: FormModule = {
  moduleId: "secrets",
  title: "Secrets",
  question: "Store the actual secrets?",
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
          order: 3,
          field: { systemKey: "devicePin", label: "PIN", type: "text", required: false, protected: false, order: 3 },
        },
      ],
      kitAdditions: { devices: ["devicePin"] },
    },
  ],
};

describe("composePack", () => {
  it("returns a clone of the base when the default option is a no-op", () => {
    const out = composePack(basePack(), [secretsModule], {});
    expect(out).not.toBe(basePack());
    expect(out.sections[0]!.groups[0]!.fields.map((f) => f.systemKey)).toEqual([
      "deviceName",
      "unlockHint",
    ]);
  });

  it("adds a field and its kit mapping when the option is selected", () => {
    const out = composePack(basePack(), [secretsModule], { secrets: "on" });
    const fields = out.sections[0]!.groups[0]!.fields;
    expect(fields.map((f) => f.systemKey)).toEqual(["deviceName", "unlockHint", "devicePin"]);
    expect(fields.map((f) => f.order)).toEqual([1, 2, 3]);
    expect(out.sections[0]!.kitMapping.entries[0]!.fields).toEqual(["deviceName", "devicePin"]);
  });

  it("removes a field when an option's removeKeys names it", () => {
    const removeModule: FormModule = {
      moduleId: "trim",
      title: "Trim",
      question: "?",
      order: 1,
      defaultOptionId: "keep",
      options: [{ optionId: "keep" }, { optionId: "drop", removeKeys: ["unlockHint"] }],
    };
    const out = composePack(basePack(), [removeModule], { trim: "drop" });
    expect(out.sections[0]!.groups[0]!.fields.map((f) => f.systemKey)).toEqual(["deviceName"]);
  });

  it("applies modules in ascending order (remove before add within an option)", () => {
    const swap: FormModule = {
      moduleId: "swap",
      title: "Swap",
      question: "?",
      order: 1,
      defaultOptionId: "b",
      options: [
        {
          optionId: "b",
          removeKeys: ["unlockHint"],
          addFields: [
            {
              sectionKey: "devices",
              groupKey: "device",
              order: 2,
              field: { systemKey: "unlockNote", label: "Note", type: "textarea", required: false, protected: false, order: 2 },
            },
          ],
        },
      ],
    };
    const out = composePack(basePack(), [swap], { swap: "b" });
    expect(out.sections[0]!.groups[0]!.fields.map((f) => f.systemKey)).toEqual([
      "deviceName",
      "unlockNote",
    ]);
  });

  it("is deterministic: same inputs produce deep-equal output", () => {
    const a = composePack(basePack(), [secretsModule], { secrets: "on" });
    const b = composePack(basePack(), [secretsModule], { secrets: "on" });
    expect(a).toEqual(b);
  });

  it("throws on an addField that references an unknown group", () => {
    const bad: FormModule = {
      moduleId: "bad",
      title: "Bad",
      question: "?",
      order: 1,
      defaultOptionId: "on",
      options: [
        {
          optionId: "on",
          addFields: [
            {
              sectionKey: "devices",
              groupKey: "nope",
              order: 1,
              field: { systemKey: "x", label: "X", type: "text", required: false, protected: false, order: 1 },
            },
          ],
        },
      ],
    };
    expect(() => composePack(basePack(), [bad], { bad: "on" })).toThrow(/unknown group/);
  });
});
