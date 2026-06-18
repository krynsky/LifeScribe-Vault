import { describe, expect, it } from "vitest";
import type { FormPack } from "./formModel";
import { buildSnapshot, normalizeSnapshot } from "./snapshot";

const MINIMAL_PACK: FormPack = {
  packId: "test-pack",
  packVersion: "1.0.0",
  schemaVersion: 1,
  minAppVersion: "0.0.0",
  sections: [],
  migrations: [],
};

describe("customPack round-trip", () => {
  it("preserves customPack through buildSnapshot → normalizeSnapshot", () => {
    const wire = buildSnapshot({
      snapshotFormat: 1,
      schemaVersion: 1,
      profile: { ownerName: "Alice", reviewCadenceMonths: 12 },
      values: {},
      sectionMeta: {},
      overlay: null,
      kitMeta: null,
      extra: {},
      customPack: MINIMAL_PACK,
    });
    const result = normalizeSnapshot(wire, "");
    expect(result.customPack).toEqual(MINIMAL_PACK);
  });

  it("returns undefined customPack when field is absent in a null snapshot", () => {
    const result = normalizeSnapshot(null, "");
    expect(result.customPack).toBeUndefined();
  });

  it("returns undefined customPack when field is absent in a real snapshot", () => {
    const wire = buildSnapshot({
      snapshotFormat: 1,
      schemaVersion: 1,
      profile: { ownerName: "Bob", reviewCadenceMonths: 12 },
      values: {},
      sectionMeta: {},
      overlay: null,
      kitMeta: null,
      extra: {},
    });
    const result = normalizeSnapshot(wire, "");
    expect(result.customPack).toBeUndefined();
  });

  it("does not place customPack in extra", () => {
    const wire = buildSnapshot({
      snapshotFormat: 1,
      schemaVersion: 1,
      profile: { ownerName: "Carol", reviewCadenceMonths: 12 },
      values: {},
      sectionMeta: {},
      overlay: null,
      kitMeta: null,
      extra: {},
      customPack: MINIMAL_PACK,
    });
    const result = normalizeSnapshot(wire, "");
    expect(result.extra).not.toHaveProperty("customPack");
  });
});
