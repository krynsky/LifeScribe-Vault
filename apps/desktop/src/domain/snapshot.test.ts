import { describe, expect, it } from "vitest";
import type { FormPack } from "./formModel";
import { buildSnapshot, emptySnapshot, normalizeSnapshot } from "./snapshot";

const MINIMAL_PACK: FormPack = {
  packId: "test-pack",
  packVersion: "1.0.0",
  schemaVersion: 1,
  minAppVersion: "0.0.0",
  sections: [],
  migrations: [],
};

describe("formMode", () => {
  it("defaults to hint when absent from a snapshot", () => {
    const parsed = normalizeSnapshot({ profile: { ownerName: "A" } });
    expect(parsed.profile.formMode).toBe("hint");
  });

  it("reads an explicit credential formMode", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "A", formMode: "credential" },
    });
    expect(parsed.profile.formMode).toBe("credential");
  });

  it("ignores a malformed formMode and falls back to hint", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "A", formMode: "nonsense" },
    });
    expect(parsed.profile.formMode).toBe("hint");
  });

  it("round-trips formMode through build + normalize", () => {
    const built = buildSnapshot(emptySnapshot("A", "credential"));
    expect(normalizeSnapshot(built).profile.formMode).toBe("credential");
  });

  it("emptySnapshot defaults to hint", () => {
    expect(emptySnapshot("A").profile.formMode).toBe("hint");
  });

  it("uses the fallbackFormMode for a fresh (null) snapshot", () => {
    expect(normalizeSnapshot(null, "A", "credential").profile.formMode).toBe(
      "credential",
    );
  });
});

describe("customPack round-trip", () => {
  it("preserves customPack through buildSnapshot → normalizeSnapshot", () => {
    const wire = buildSnapshot({
      snapshotFormat: 1,
      schemaVersion: 1,
      profile: { ownerName: "Alice", reviewCadenceMonths: 12, formMode: "hint" as const },
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
      profile: { ownerName: "Bob", reviewCadenceMonths: 12, formMode: "hint" as const },
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
      profile: { ownerName: "Carol", reviewCadenceMonths: 12, formMode: "hint" as const },
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
