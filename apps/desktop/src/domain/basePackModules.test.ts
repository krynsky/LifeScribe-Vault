import { describe, expect, it } from "vitest";
import basePackJson from "../../src-tauri/resources/packs/default-pack.json";
import type { FormPack } from "./formModel";
import { composePack } from "./composePack";
import { validatePack } from "./packValidation";

const base = basePackJson as unknown as FormPack;

function fieldKeys(pack: FormPack, sectionKey: string): string[] {
  const section = pack.sections.find((s) => s.sectionKey === sectionKey)!;
  return section.groups.flatMap((g) => g.fields.map((f) => f.systemKey));
}
function kitFields(pack: FormPack, sectionKey: string): string[] {
  return pack.sections.find((s) => s.sectionKey === sectionKey)!.kitMapping.entries.flatMap((e) => e.fields);
}

describe("base pack modules", () => {
  it("declares the secrets and file-method modules and still validates", () => {
    expect(validatePack(base).ok).toBe(true);
    const ids = (base.modules ?? []).map((m) => m.moduleId).sort();
    expect(ids).toEqual(["file-method", "secrets"]);
  });

  it("default selections are a no-op — composed output equals the base sections", () => {
    const composed = composePack(base, base.modules ?? [], {});
    expect(composed.sections).toEqual(base.sections);
  });

  it("secrets:on adds the master password and device PIN plus their kit entries", () => {
    const composed = composePack(base, base.modules ?? [], { secrets: "on" });
    expect(fieldKeys(composed, "password-manager")).toContain("passwordManagerMasterPassword");
    expect(fieldKeys(composed, "devices")).toContain("devicePin");
    expect(kitFields(composed, "password-manager")).toContain("passwordManagerMasterPassword");
    expect(kitFields(composed, "devices")).toContain("devicePin");
  });

  it("file-method:attach swaps the digital-location path field for an attachment field", () => {
    const composed = composePack(base, base.modules ?? [], { "file-method": "attach" });
    const docs = fieldKeys(composed, "documents");
    expect(docs).not.toContain("documentDigitalLocation");
    expect(docs).toContain("documentDigitalFile");
    const kit = kitFields(composed, "documents");
    expect(kit).toContain("documentDigitalFile");
    // The removed path field must not linger as a dangling kit reference.
    expect(kit).not.toContain("documentDigitalLocation");
  });
});
