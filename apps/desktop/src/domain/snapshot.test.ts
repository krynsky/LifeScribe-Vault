import { describe, expect, it } from "vitest";
import type { FormPack } from "./formModel";
import { buildSnapshot, emptySnapshot, formModeFromModuleSelections, normalizeSnapshot } from "./snapshot";

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

describe("basePackId", () => {
  it("reads a persisted basePackId", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "A", basePackId: "lifescribe-default" },
    });
    expect(parsed.profile.basePackId).toBe("lifescribe-default");
  });

  it("is absent when missing, empty, or malformed", () => {
    expect(
      normalizeSnapshot({ profile: { ownerName: "A" } }).profile.basePackId,
    ).toBeUndefined();
    expect(
      normalizeSnapshot({ profile: { ownerName: "A", basePackId: "" } }).profile.basePackId,
    ).toBeUndefined();
    expect(
      normalizeSnapshot({ profile: { ownerName: "A", basePackId: 7 } }).profile.basePackId,
    ).toBeUndefined();
  });

  it("round-trips through build + normalize", () => {
    const parsed = emptySnapshot("A");
    parsed.profile.basePackId = "lifescribe-default-credential";
    const built = buildSnapshot(parsed);
    expect(normalizeSnapshot(built).profile.basePackId).toBe(
      "lifescribe-default-credential",
    );
  });
});

describe("customPack round-trip", () => {
  it("preserves customPack through buildSnapshot → normalizeSnapshot", () => {
    const wire = buildSnapshot({
      snapshotFormat: 1,
      schemaVersion: 1,
      profile: { ownerName: "Alice", reviewCadenceMonths: 12, formMode: "hint" as const, moduleSelections: {} },
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
      profile: { ownerName: "Bob", reviewCadenceMonths: 12, formMode: "hint" as const, moduleSelections: {} },
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
      profile: { ownerName: "Carol", reviewCadenceMonths: 12, formMode: "hint" as const, moduleSelections: {} },
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

describe("moduleSelections migration", () => {
  it("seeds { secrets: 'on' } from a legacy credential formMode", () => {
    const parsed = normalizeSnapshot({ profile: { ownerName: "Dana", formMode: "credential" } });
    expect(parsed.profile.moduleSelections).toEqual({ secrets: "on" });
  });

  it("seeds { secrets: 'off' } from a legacy hint formMode", () => {
    const parsed = normalizeSnapshot({ profile: { ownerName: "Dana", formMode: "hint" } });
    expect(parsed.profile.moduleSelections).toEqual({ secrets: "off" });
  });

  it("preserves an explicit moduleSelections map over the formMode-derived seed", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "Dana", formMode: "hint", moduleSelections: { secrets: "on", "file-method": "attach" } },
    });
    expect(parsed.profile.moduleSelections).toEqual({ secrets: "on", "file-method": "attach" });
  });

  it("ignores a non-string-record moduleSelections and falls back to the formMode seed", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "Dana", formMode: "credential", moduleSelections: "bogus" },
    });
    expect(parsed.profile.moduleSelections).toEqual({ secrets: "on" });
  });

  it("emptySnapshot seeds moduleSelections from its formMode", () => {
    expect(emptySnapshot("Dana", "credential").profile.moduleSelections).toEqual({ secrets: "on" });
    expect(emptySnapshot("Dana", "hint").profile.moduleSelections).toEqual({ secrets: "off" });
  });

  it("ignores a moduleSelections map with a non-string value", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "Dana", formMode: "hint", moduleSelections: { secrets: "on", extra: 1 } },
    });
    expect(parsed.profile.moduleSelections).toEqual({ secrets: "off" });
  });
});

describe("moduleSelections-first seeding", () => {
  it("emptySnapshot seeds the profile from moduleSelections and syncs formMode from secrets", () => {
    const snap = emptySnapshot("Dana", { secrets: "on", "file-method": "attach" });
    expect(snap.profile.moduleSelections).toEqual({ secrets: "on", "file-method": "attach" });
    expect(snap.profile.formMode).toBe("credential");
  });

  it("formModeFromModuleSelections maps secrets on->credential, else hint", () => {
    expect(formModeFromModuleSelections({ secrets: "on" })).toBe("credential");
    expect(formModeFromModuleSelections({ secrets: "off" })).toBe("hint");
    expect(formModeFromModuleSelections({})).toBe("hint");
  });
});
