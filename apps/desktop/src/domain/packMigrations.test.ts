import { describe, expect, it } from "vitest";
import type { FormPack } from "./formModel";
import {
  SNAPSHOT_SCHEMA_TOO_NEW,
  checkSnapshotReadable,
  migrateSectionRecord,
  migrateVaultValues,
} from "./packMigrations";
import type { VaultValues } from "./valuesStore";
import {
  makePlanPack,
  makeRecord,
  makeSectionValues,
  makeVaultValues,
} from "./testing/fixtures";

/**
 * A v3 plan pack with two authored stepwise migrations:
 *   v1 -> v2: the "manager" field was renamed to "provider".
 *   v2 -> v3: legacy provider spellings map onto the canonical option values.
 */
function makeV3Pack(): FormPack {
  const pack = makePlanPack({ schemaVersion: 3 });
  pack.migrations = [
    {
      fromVersion: 1,
      operations: [{ op: "renameField", sectionKey: "plan", fromKey: "manager", toKey: "provider" }],
    },
    {
      fromVersion: 2,
      operations: [
        {
          op: "mapValue",
          sectionKey: "plan",
          systemKey: "provider",
          mapping: { agilebits: "1Password", bitwarden: "Bitwarden" },
        },
      ],
    },
  ];
  return pack;
}

function v1Values(): VaultValues {
  return makeVaultValues([
    makeSectionValues("plan", [
      makeRecord({ id: "main-1", schemaVersion: 1, values: { manager: "agilebits", notes: "Ask Dana" } }),
    ]),
  ]);
}

describe("migrateVaultValues — stepwise composition", () => {
  it("migrates values entered at schemaVersion 1 stepwise to 3", () => {
    const result = migrateVaultValues(v1Values(), makeV3Pack());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const record = result.values.plan.records[0];
    expect(record.schemaVersion).toBe(3);
    // v1->v2 rename, then v2->v3 value map composed on the renamed key.
    expect(record.values).toEqual({ provider: "1Password", notes: "Ask Dana" });
    expect(record.values.manager).toBeUndefined();
  });

  it("starts each record from its own stamp: a v2 record only gets the v2->v3 step", () => {
    const values = makeVaultValues([
      makeSectionValues("plan", [
        makeRecord({ id: "main-1", schemaVersion: 2, values: { provider: "bitwarden", manager: "stale" } }),
      ]),
    ]);
    const result = migrateVaultValues(values, makeV3Pack());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const record = result.values.plan.records[0];
    expect(record.schemaVersion).toBe(3);
    expect(record.values.provider).toBe("Bitwarden");
    // The v1 rename step does not re-run against a v2 record.
    expect(record.values.manager).toBe("stale");
  });

  it("stamps records up to the target even when no step touches them", () => {
    const pack = makePlanPack({ schemaVersion: 3, migrations: [] });
    const result = migrateVaultValues(v1Values(), pack);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.values.plan.records[0].schemaVersion).toBe(3);
    expect(result.values.plan.records[0].values).toEqual({ manager: "agilebits", notes: "Ask Dana" });
  });

  it("renameField never overwrites an existing target value", () => {
    const record = makeRecord({
      id: "main-1",
      schemaVersion: 1,
      values: { manager: "agilebits", provider: "1Password" },
    });
    const migrated = migrateSectionRecord(record, "plan", makeV3Pack().migrations, 3);
    // Both values survive for reconcile to sort out — nothing destroyed.
    expect(migrated.values.manager).toBe("agilebits");
    expect(migrated.values.provider).toBe("1Password");
  });

  it("ignores operations addressed to other sections", () => {
    const record = makeRecord({ id: "r1", schemaVersion: 1, values: { manager: "agilebits" } });
    const migrated = migrateSectionRecord(record, "devices", makeV3Pack().migrations, 3);
    expect(migrated.values).toEqual({ manager: "agilebits" });
    expect(migrated.schemaVersion).toBe(3);
  });
});

describe("migrateVaultValues — purity, idempotence, crash-window safety", () => {
  it("is idempotent: migrating twice equals migrating once", () => {
    const pack = makeV3Pack();
    const once = migrateVaultValues(v1Values(), pack);
    expect(once.ok).toBe(true);
    if (!once.ok) {
      return;
    }
    const twice = migrateVaultValues(once.values, pack);
    expect(twice.ok).toBe(true);
    if (!twice.ok) {
      return;
    }
    expect(twice.values).toEqual(once.values);
    // Records already at the target are returned by reference — the second
    // pass is structurally a no-op, not a rebuild.
    expect(twice.values.plan).toBe(once.values.plan);
  });

  it("never mutates its input (crash before write-back is safe)", () => {
    const values = v1Values();
    const snapshot = structuredClone(values);
    const result = migrateVaultValues(values, makeV3Pack());
    expect(result.ok).toBe(true);
    expect(values).toEqual(snapshot);
  });

  it("crash-window: load-migrate, drop the result, reload, re-migrate -> identical result", () => {
    const pack = makeV3Pack();
    // First app run: migrate in memory, then crash before the save path runs.
    const firstRun = migrateVaultValues(v1Values(), pack);
    // Second app run: the persisted snapshot is still the v1 values.
    const secondRun = migrateVaultValues(v1Values(), pack);
    expect(firstRun.ok).toBe(true);
    expect(secondRun.ok).toBe(true);
    if (!firstRun.ok || !secondRun.ok) {
      return;
    }
    expect(secondRun.values).toEqual(firstRun.values);
  });

  it("loads mixed-version snapshots: v1 and v3 records side by side both land at v3", () => {
    const v3Record = makeRecord({
      id: "contact-1",
      groupKey: "contact",
      schemaVersion: 3,
      values: { contactName: "Dana Reyes" },
    });
    const values = makeVaultValues([
      makeSectionValues("plan", [
        makeRecord({ id: "main-1", schemaVersion: 1, values: { manager: "agilebits" } }),
        v3Record,
      ]),
    ]);
    const result = migrateVaultValues(values, makeV3Pack());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const [migratedV1, migratedV3] = result.values.plan.records;
    expect(migratedV1.schemaVersion).toBe(3);
    expect(migratedV1.values).toEqual({ provider: "1Password" });
    // The already-current record is untouched — same reference.
    expect(migratedV3).toBe(v3Record);
  });
});

describe("migrateVaultValues — snapshots newer than the app", () => {
  it("refuses read-write with a specific error when any record is stamped beyond the range", () => {
    const values = makeVaultValues([
      makeSectionValues("plan", [
        makeRecord({ id: "main-1", schemaVersion: 3, values: { provider: "1Password" } }),
        makeRecord({ id: "main-2", schemaVersion: 4, values: { provider: "Bitwarden" } }),
      ]),
    ]);
    const snapshot = structuredClone(values);
    const result = migrateVaultValues(values, makeV3Pack());
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(SNAPSHOT_SCHEMA_TOO_NEW);
    expect(result.error.message).toMatch(/schema v4/);
    expect(result.error.message).toMatch(/up to v3/);
    // Refusal changes nothing.
    expect(values).toEqual(snapshot);
  });

  it("checkSnapshotReadable passes records stamped exactly at the supported maximum", () => {
    const values = makeVaultValues([
      makeSectionValues("plan", [makeRecord({ id: "main-1", schemaVersion: 3, values: {} })]),
    ]);
    expect(checkSnapshotReadable(values, 3)).toBeNull();
    expect(checkSnapshotReadable(values, 2)?.code).toBe(SNAPSHOT_SCHEMA_TOO_NEW);
  });
});
