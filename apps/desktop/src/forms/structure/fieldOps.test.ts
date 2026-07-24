import { describe, expect, it } from "vitest";
import hintPack from "../../../src-tauri/resources/packs/default-pack.json";
import type { FormPack } from "../../domain/formModel";
import { duplicateField, reorderFields } from "./fieldOps";

const hint = hintPack as unknown as FormPack;

function group(pack: FormPack, sectionKey: string, groupKey: string) {
  return pack.sections
    .find((s) => s.sectionKey === sectionKey)!
    .groups.find((g) => g.groupKey === groupKey)!;
}

describe("reorderFields", () => {
  it("moves a field and renumbers order to sequential integers", () => {
    // Base pack "devices/device" group, in order: deviceName, deviceType,
    // deviceOwner, deviceUnlockHintLocation, deviceRecoveryNotes.
    const next = reorderFields(hint, "devices", "device", 1, 3);
    const keys = [...group(next, "devices", "device").fields]
      .sort((a, b) => a.order - b.order)
      .map((f) => f.systemKey);
    expect(keys).toEqual([
      "deviceName",
      "deviceOwner",
      "deviceUnlockHintLocation",
      "deviceType",
      "deviceRecoveryNotes",
    ]);
    expect(group(next, "devices", "device").fields.map((f) => f.order).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5]);
  });
});

describe("duplicateField", () => {
  it("inserts a distinct added clone right after the original", () => {
    const next = duplicateField(hint, "devices", "device", "deviceUnlockHintLocation");
    const fields = [...group(next, "devices", "device").fields].sort((a, b) => a.order - b.order);
    const idx = fields.findIndex((f) => f.systemKey === "deviceUnlockHintLocation");
    const clone = fields[idx + 1]!;
    expect(clone.systemKey).not.toBe("deviceUnlockHintLocation");
    expect(clone.label).toBe(fields[idx]!.label);
    expect(clone.protected).toBe(false);
    expect(clone.systemKey.startsWith("field_")).toBe(true);
  });
});
