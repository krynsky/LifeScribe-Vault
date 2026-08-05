import { describe, expect, it } from "vitest";
import type { FormPack } from "./formModel";
import releaseSnapshot from "./fixtures/snapshot-v1.0.json";
import {
  buildSnapshot,
  emptySnapshot,
  normalizeSnapshot,
  SnapshotFormatTooNewError,
} from "./snapshot";

const MINIMAL_PACK: FormPack = {
  packId: "test-pack",
  packVersion: "1.0.0",
  schemaVersion: 1,
  minAppVersion: "0.0.0",
  sections: [],
  migrations: [],
};

describe("profile", () => {
  it("fills the owner name from the fallback and the default review cadence", () => {
    const parsed = normalizeSnapshot(null, "Alice");
    expect(parsed.profile.ownerName).toBe("Alice");
    expect(parsed.profile.reviewCadenceMonths).toBe(12);
  });

  it("fills the default review cadence when the persisted value is malformed", () => {
    expect(
      normalizeSnapshot({ profile: { ownerName: "A", reviewCadenceMonths: 0 } }).profile
        .reviewCadenceMonths,
    ).toBe(12);
    expect(
      normalizeSnapshot({ profile: { ownerName: "A", reviewCadenceMonths: "6" } }).profile
        .reviewCadenceMonths,
    ).toBe(12);
  });

  it("keeps a valid persisted review cadence", () => {
    expect(
      normalizeSnapshot({ profile: { ownerName: "A", reviewCadenceMonths: 6 } }).profile
        .reviewCadenceMonths,
    ).toBe(6);
  });

  // R15: the module system is gone; the profile carries neither field.
  it("carries no formMode or moduleSelections on a fresh snapshot", () => {
    const profile = emptySnapshot("A").profile;
    expect(profile).not.toHaveProperty("formMode");
    expect(profile).not.toHaveProperty("moduleSelections");
  });

  it("drops a legacy formMode / moduleSelections rather than preserving them", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "A", formMode: "credential", moduleSelections: { secrets: "on" } },
    });
    expect(parsed.profile).not.toHaveProperty("formMode");
    expect(parsed.profile).not.toHaveProperty("moduleSelections");
    expect(parsed.extra).not.toHaveProperty("formMode");
    expect(parsed.extra).not.toHaveProperty("moduleSelections");
  });

  it("writes no formMode or moduleSelections into the wire snapshot", () => {
    const wire = buildSnapshot(emptySnapshot("A")) as { profile: Record<string, unknown> };
    expect(wire.profile).not.toHaveProperty("formMode");
    expect(wire.profile).not.toHaveProperty("moduleSelections");
  });
});

describe("unknown top-level fields", () => {
  it("round-trips them through extra", () => {
    const parsed = normalizeSnapshot({
      profile: { ownerName: "A" },
      futureThing: { nested: [1, 2] },
    });
    expect(parsed.extra).toEqual({ futureThing: { nested: [1, 2] } });
    const wire = buildSnapshot(parsed) as Record<string, unknown>;
    expect(wire.futureThing).toEqual({ nested: [1, 2] });
  });
});

describe("forward compatibility", () => {
  it("refuses a snapshot format written by a newer app", () => {
    expect(() => normalizeSnapshot({ snapshotFormat: 2 })).toThrow(SnapshotFormatTooNewError);
  });

  it("keeps the checked-in 1.0 release snapshot readable and lossless", () => {
    expect(buildSnapshot(normalizeSnapshot(releaseSnapshot))).toEqual(releaseSnapshot);
  });

  it("preserves unknown nested fields in same-format snapshots", () => {
    const raw = {
      snapshotFormat: 1,
      profile: { ownerName: "A", futureProfileSetting: { enabled: true } },
      values: {
        identity: {
          sectionKey: "identity",
          records: [],
          archivedAnswers: [],
          futureSectionValue: "kept",
        },
      },
      sectionMeta: { identity: { completed: true, futureMeta: 7 } },
      kitMeta: {
        lastGeneratedAt: "2026-01-01T00:00:00Z",
        fingerprint: "abc",
        futureKitField: [1, 2],
      },
    };
    const roundTrip = buildSnapshot(normalizeSnapshot(raw)) as typeof raw;
    expect(roundTrip.profile.futureProfileSetting).toEqual({ enabled: true });
    expect(roundTrip.values.identity.futureSectionValue).toBe("kept");
    expect(roundTrip.sectionMeta.identity.futureMeta).toBe(7);
    expect(roundTrip.kitMeta.futureKitField).toEqual([1, 2]);
  });
});

describe("payload round-trip", () => {
  it("preserves values, sectionMeta, overlay and kitMeta unchanged", () => {
    const parsed = emptySnapshot("A");
    parsed.values = {
      identity: { sectionKey: "identity", records: [], archivedAnswers: [] },
    };
    parsed.sectionMeta = {
      identity: { na: true, completed: true, lastSavedAt: "2026-01-01T00:00:00.000Z" },
    };
    parsed.overlay = { sectionOrder: ["identity"] } as never;
    parsed.kitMeta = { lastGeneratedAt: "2026-01-02T00:00:00.000Z", fingerprint: "abc" };
    const result = normalizeSnapshot(buildSnapshot(parsed), "");
    expect(result.values).toEqual(parsed.values);
    expect(result.sectionMeta).toEqual(parsed.sectionMeta);
    expect(result.overlay).toEqual(parsed.overlay);
    expect(result.kitMeta).toEqual(parsed.kitMeta);
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

  it("preserves the custom pack baseline used for future rebases", () => {
    const parsed = emptySnapshot("Alice");
    parsed.customPack = MINIMAL_PACK;
    parsed.customPackBase = MINIMAL_PACK;
    const result = normalizeSnapshot(buildSnapshot(parsed));
    expect(result.customPackBase).toEqual(MINIMAL_PACK);
    expect(result.extra).not.toHaveProperty("customPackBase");
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
