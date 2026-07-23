import { describe, expect, it } from "vitest";
import type { FormPack } from "../domain/formModel";
import { buildEditorView } from "./editorView";

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
          { systemKey: "unlockHint", label: "Unlock hint", type: "text", required: false, protected: false, order: 2 },
        ] }],
      },
    ],
    modules: [
      {
        moduleId: "secrets", title: "Secrets", question: "?", order: 1, defaultOptionId: "off",
        options: [
          { optionId: "off" },
          {
            optionId: "on",
            addFields: [{ sectionKey: "devices", groupKey: "device", order: 3, field: {
              systemKey: "devicePin", label: "PIN", type: "text", required: false, protected: false, order: 3 } }],
            removeKeys: ["unlockHint"],
          },
        ],
      },
      {
        moduleId: "crypto", title: "Crypto", question: "?", order: 2, defaultOptionId: "off",
        options: [
          { optionId: "off" },
          { optionId: "on", addSections: [{ order: 2, section: {
            sectionKey: "crypto", title: "Crypto", lede: "", multiRecord: true, order: 2,
            readinessRule: { requiredKeys: ["walletName"] },
            kitMapping: { entries: [{ heading: "Crypto", fields: ["walletName"] }] },
            groups: [{ groupKey: "wallet", title: "Wallet", repeatable: false, order: 1, fields: [
              { systemKey: "walletName", label: "Wallet name", type: "text", required: true, protected: true, order: 1 },
            ] }],
          } }], removeSectionKeys: ["devices"] },
        ],
      },
    ],
  };
}

function field(view: ReturnType<typeof buildEditorView>, sectionKey: string, systemKey: string) {
  return view.sections
    .find((s) => s.sectionKey === sectionKey)!
    .groups.flatMap((g) => g.fields)
    .find((f) => f.systemKey === systemKey);
}

describe("buildEditorView", () => {
  it("with no overlays returns the base tagged as source base, nothing removed", () => {
    const view = buildEditorView(base(), {});
    expect(view.sections.map((s) => s.sectionKey)).toEqual(["devices"]);
    expect(view.sections[0]!.source).toEqual({ kind: "base" });
    expect(view.sections[0]!.removed).toBe(false);
    expect(field(view, "devices", "deviceName")!.source).toEqual({ kind: "base" });
  });

  it("overlaying secrets:on tags devicePin as module-added and flags unlockHint removed (still present)", () => {
    const view = buildEditorView(base(), { secrets: "on" });
    const pin = field(view, "devices", "devicePin")!;
    expect(pin.source).toEqual({ kind: "module", moduleId: "secrets", optionId: "on" });
    expect(pin.removed).toBe(false);
    const hint = field(view, "devices", "unlockHint")!;
    expect(hint.removed).toBe(true);
    expect(hint.source).toEqual({ kind: "base" });
  });

  it("overlaying crypto:on appends the crypto section (module source) and flags devices removed", () => {
    const view = buildEditorView(base(), { crypto: "on" });
    expect(view.sections.map((s) => s.sectionKey)).toEqual(["devices", "crypto"]);
    const devices = view.sections.find((s) => s.sectionKey === "devices")!;
    expect(devices.removed).toBe(true);
    const crypto = view.sections.find((s) => s.sectionKey === "crypto")!;
    expect(crypto.source).toEqual({ kind: "module", moduleId: "crypto", optionId: "on" });
    expect(crypto.removed).toBe(false);
  });

  it("overlays multiple modules at once and orders sections by their order value", () => {
    const view = buildEditorView(base(), { secrets: "on", crypto: "on" });
    expect(view.sections.map((s) => s.sectionKey)).toEqual(["devices", "crypto"]);
    expect(field(view, "devices", "devicePin")).toBeDefined();
    expect(view.sections.find((s) => s.sectionKey === "devices")!.removed).toBe(true);
  });

  it("a null / absent selection is not overlaid", () => {
    const view = buildEditorView(base(), { secrets: null });
    expect(field(view, "devices", "devicePin")).toBeUndefined();
    expect(field(view, "devices", "unlockHint")!.removed).toBe(false);
  });
});
