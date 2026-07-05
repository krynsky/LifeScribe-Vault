import { describe, expect, it } from "vitest";
import hintPack from "../src-tauri/resources/packs/default-pack.json";
import overlay from "../scripts/credential-overlay.json";
import { buildCredentialPack } from "../scripts/lib/credential-pack.mjs";
import { deriveOverlay } from "../scripts/lib/derive-overlay.mjs";
import type { FormPack } from "../src/domain/formModel";
import { duplicateField, reorderFields } from "./fieldOps";

const hint = hintPack as unknown as Record<string, unknown>;

function group(pack: FormPack, sectionKey: string, groupKey: string) {
  return pack.sections
    .find((s) => s.sectionKey === sectionKey)!
    .groups.find((g) => g.groupKey === groupKey)!;
}

describe("reorderFields", () => {
  it("moves a field and renumbers order to sequential integers", () => {
    const pack = buildCredentialPack(hint, overlay) as FormPack;
    const next = reorderFields(pack, "devices", "device", 1, 3);
    const keys = [...group(next, "devices", "device").fields]
      .sort((a, b) => a.order - b.order)
      .map((f) => f.systemKey);
    expect(keys.slice(0, 4)).toEqual([
      "deviceName",
      "deviceOwner",
      "devicePin",
      "deviceType",
    ]);
    expect(group(next, "devices", "device").fields.map((f) => f.order).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("round-trips through derive + generate", () => {
    const pack = buildCredentialPack(hint, overlay) as FormPack;
    const next = reorderFields(pack, "devices", "device", 1, 2);
    expect(buildCredentialPack(hint, deriveOverlay(hint, next))).toEqual(next);
  });
});

describe("duplicateField", () => {
  it("inserts a distinct added clone right after the original", () => {
    const pack = buildCredentialPack(hint, overlay) as FormPack;
    const next = duplicateField(pack, "password-manager", "plan", "passwordManagerMasterPassword");
    const fields = [...group(next, "password-manager", "plan").fields].sort((a, b) => a.order - b.order);
    const idx = fields.findIndex((f) => f.systemKey === "passwordManagerMasterPassword");
    const clone = fields[idx + 1]!;
    expect(clone.systemKey).not.toBe("passwordManagerMasterPassword");
    expect(clone.label).toBe("Master password");
    expect(clone.protected).toBe(false);
    expect(clone.systemKey.startsWith("field_")).toBe(true);
  });

  it("round-trips through derive + generate", () => {
    const pack = buildCredentialPack(hint, overlay) as FormPack;
    const next = duplicateField(pack, "devices", "device", "devicePin");
    expect(buildCredentialPack(hint, deriveOverlay(hint, next))).toEqual(next);
  });
});
