import { describe, expect, it } from "vitest";
import hintPack from "../../src-tauri/resources/packs/default-pack.json";
import credentialPack from "../../src-tauri/resources/packs/default-pack-credential.json";
import type { FormPack } from "./formModel";
import { validatePack } from "./packValidation";

function systemKeys(pack: FormPack): Set<string> {
  const keys = new Set<string>();
  for (const section of pack.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        keys.add(`${section.sectionKey}.${field.systemKey}`);
      }
    }
  }
  return keys;
}

describe("credential pack", () => {
  it("passes the same validation as the default pack", () => {
    expect(validatePack(credentialPack).ok).toBe(true);
  });

  it("is a superset of the hint pack (every hint key exists in credential)", () => {
    const hintKeys = systemKeys(hintPack as unknown as FormPack);
    const credKeys = systemKeys(credentialPack as unknown as FormPack);
    for (const key of hintKeys) {
      expect(credKeys.has(key)).toBe(true);
    }
  });

  it("shares schemaVersion with the hint pack (lockstep)", () => {
    expect((credentialPack as unknown as FormPack).schemaVersion).toBe(
      (hintPack as unknown as FormPack).schemaVersion,
    );
  });

  it("adds the secret fields", () => {
    const credKeys = systemKeys(credentialPack as unknown as FormPack);
    expect(credKeys.has("password-manager.passwordManagerMasterPassword")).toBe(true);
    expect(credKeys.has("devices.devicePin")).toBe(true);
  });

  it("includes the secret fields in the Recovery Kit mapping", () => {
    const pack = credentialPack as unknown as FormPack;
    const pm = pack.sections.find((s) => s.sectionKey === "password-manager");
    const devices = pack.sections.find((s) => s.sectionKey === "devices");
    const pmKitFields = pm!.kitMapping.entries.flatMap((e) => e.fields);
    const deviceKitFields = devices!.kitMapping.entries.flatMap((e) => e.fields);
    expect(pmKitFields).toContain("passwordManagerMasterPassword");
    expect(deviceKitFields).toContain("devicePin");
  });
});
