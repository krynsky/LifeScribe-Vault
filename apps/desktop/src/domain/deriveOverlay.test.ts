import { describe, expect, it } from "vitest";
import hintPack from "../../src-tauri/resources/packs/default-pack.json";
import overlay from "../../scripts/credential-overlay.json";
import { buildCredentialPack } from "../../scripts/lib/credential-pack.mjs";
import { deriveOverlay } from "../../scripts/lib/derive-overlay.mjs";
import type { FormPack } from "./formModel";

// buildCredentialPack/deriveOverlay treat packs as opaque JSON; cast loosely.
const hint = hintPack as unknown as Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe("deriveOverlay", () => {
  it("round-trips the committed overlay (derive ∘ generate = identity)", () => {
    const pack = buildCredentialPack(hint, overlay);
    expect(deriveOverlay(hint, pack)).toEqual(overlay);
  });

  it("generate ∘ derive = identity for a helper-text reword", () => {
    const pack = buildCredentialPack(hint, overlay) as FormPack;
    const pm = pack.sections.find((s) => s.sectionKey === "password-manager")!;
    const field = pm.groups
      .flatMap((g) => g.fields)
      .find((f) => f.systemKey === "passwordManagerRecoveryLocation")!;
    field.helperText = "Reworded for credential mode.";
    const derived = deriveOverlay(hint, pack);
    expect(derived.fieldOverrides.passwordManagerRecoveryLocation).toEqual({
      helperText: "Reworded for credential mode.",
    });
    expect(buildCredentialPack(hint, derived)).toEqual(pack);
  });

  it("generate ∘ derive = identity when shared fields are reordered", () => {
    const pack = buildCredentialPack(hint, overlay) as FormPack;
    const devices = pack.sections.find((s) => s.sectionKey === "devices")!;
    const group = devices.groups.find((g) => g.groupKey === "device")!;
    // Reorder deviceType (2) and deviceOwner (3): swap both their order values
    // and their array positions, mirroring a real editor reorder so the group
    // stays internally consistent (array order == order-value order).
    const ti = group.fields.findIndex((f) => f.systemKey === "deviceType");
    const oi = group.fields.findIndex((f) => f.systemKey === "deviceOwner");
    const type = group.fields[ti]!;
    const owner = group.fields[oi]!;
    [type.order, owner.order] = [owner.order, type.order];
    [group.fields[ti], group.fields[oi]] = [group.fields[oi]!, group.fields[ti]!];
    const derived = deriveOverlay(hint, pack);
    expect(buildCredentialPack(hint, derived)).toEqual(pack);
  });

  it("records added fields and kit additions", () => {
    const pack = buildCredentialPack(hint, overlay);
    const derived = deriveOverlay(hint, pack);
    const addedKeys = derived.addedFields.map((a) => a.field.systemKey);
    expect(addedKeys).toContain("passwordManagerMasterPassword");
    expect(addedKeys).toContain("devicePin");
    expect(derived.kitAdditions["password-manager"]).toContain(
      "passwordManagerMasterPassword",
    );
  });

  it("emits no overrides for an unedited pack (packId only + added fields)", () => {
    const pack = clone(buildCredentialPack(hint, overlay));
    const derived = deriveOverlay(hint, pack);
    expect(derived.fieldOverrides).toEqual({});
  });
});
