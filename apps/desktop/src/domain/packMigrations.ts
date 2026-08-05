/**
 * schemaVersion stepwise value migrations.
 *
 * Law (plan: Key Technical Decisions): migrations are pure, deterministic,
 * idempotent. They run in memory at load (migrate-on-read); the migrated
 * result persists only through the normal save path as a new generation —
 * never as a hidden side-effect of load. A crash before write-back is always
 * safe: re-migration converges to the identical result.
 *
 * Values are stamped with the definition schemaVersion they were entered
 * under. A snapshot stamped newer than this app's migration range is refused
 * read-write with a specific error, paralleling the backup version rule.
 */

import type { FormPack, MigrationOperation, MigrationStep } from "./formModel";
import type { SectionRecord, SectionValues, VaultValues } from "./valuesStore";

export const SNAPSHOT_SCHEMA_TOO_NEW = "SnapshotSchemaTooNew" as const;
export const MIGRATION_CHAIN_INCOMPLETE = "MigrationChainIncomplete" as const;

export interface MigrationError {
  code: typeof SNAPSHOT_SCHEMA_TOO_NEW | typeof MIGRATION_CHAIN_INCOMPLETE;
  message: string;
}

export type MigrationResult =
  | { ok: true; values: VaultValues }
  | { ok: false; error: MigrationError };

/**
 * Retype operations that will run for at least one record during this load.
 * Reconciliation uses this provenance to archive values that do not conform
 * to the new field type. Once records carry a newer stamp, the operation no
 * longer participates on subsequent loads.
 */
export function pendingRetypedFields(
  values: VaultValues,
  pack: FormPack,
): Map<string, ReadonlySet<string>> {
  const mutable = new Map<string, Set<string>>();
  const minimumVersions = new Map(
    Object.entries(values).map(([sectionKey, sectionValues]) => [
      sectionKey,
      Math.min(...sectionValues.records.map((record) => record.schemaVersion)),
    ]),
  );
  for (const step of pack.migrations) {
    if (step.fromVersion >= pack.schemaVersion) continue;
    for (const operation of step.operations) {
      if (operation.op !== "retypeField") continue;
      const minimumVersion = minimumVersions.get(operation.sectionKey);
      if (minimumVersion === undefined || minimumVersion > step.fromVersion) {
        continue;
      }
      const keys = mutable.get(operation.sectionKey) ?? new Set<string>();
      keys.add(operation.systemKey);
      mutable.set(operation.sectionKey, keys);
    }
  }
  return mutable;
}

/**
 * Refuse-read-write check: any record stamped beyond the app's migration
 * range means a newer app wrote this snapshot.
 */
export function checkSnapshotReadable(
  values: VaultValues,
  maxSupportedSchemaVersion: number,
): MigrationError | null {
  for (const sectionValues of Object.values(values)) {
    for (const record of sectionValues.records) {
      if (record.schemaVersion > maxSupportedSchemaVersion) {
        return {
          code: SNAPSHOT_SCHEMA_TOO_NEW,
          message: `This vault contains data saved by a newer version of the app (schema v${record.schemaVersion}; this app reads up to v${maxSupportedSchemaVersion}). Update the app to open it — nothing has been changed.`,
        };
      }
    }
  }
  return null;
}

function applyOperationToRecord(
  record: SectionRecord,
  sectionKey: string,
  operation: MigrationOperation,
): SectionRecord {
  if (operation.sectionKey !== sectionKey) {
    return record;
  }
  switch (operation.op) {
    case "renameField": {
      const value = record.values[operation.fromKey];
      if (value === undefined) {
        return record;
      }
      // Never overwrite an existing target value — leave the source in place
      // for reconcile to archive instead of silently destroying either value.
      if (record.values[operation.toKey] !== undefined) {
        return record;
      }
      const values = { ...record.values };
      delete values[operation.fromKey];
      values[operation.toKey] = value;
      return { ...record, values };
    }
    case "mapValue": {
      const value = record.values[operation.systemKey];
      if (value === undefined) {
        return record;
      }
      const mapped = operation.mapping[value];
      if (mapped === undefined || mapped === value) {
        return record;
      }
      return { ...record, values: { ...record.values, [operation.systemKey]: mapped } };
    }
    case "retypeField": {
      const value = record.values[operation.systemKey];
      if (value === undefined || operation.valueMap === undefined) {
        return record;
      }
      const mapped = operation.valueMap[value];
      if (mapped === undefined || mapped === value) {
        return record;
      }
      return { ...record, values: { ...record.values, [operation.systemKey]: mapped } };
    }
    case "reduceCardinality":
    case "archiveField":
      // Authorization marker only — the record-level archival happens in
      // valuesStore.reconcileSectionValues against the new definition.
      return record;
  }
}

function sortedSteps(migrations: MigrationStep[]): MigrationStep[] {
  return [...migrations].sort((left, right) => left.fromVersion - right.fromVersion);
}

/**
 * Migrate one record stepwise from its stamped version up to
 * `targetVersion`, applying each vN -> vN+1 step in order. Pure: the input
 * record is never mutated. Idempotent: a record already at the target is
 * returned unchanged (same reference).
 */
export function migrateSectionRecord(
  record: SectionRecord,
  sectionKey: string,
  migrations: MigrationStep[],
  targetVersion: number,
): SectionRecord {
  if (record.schemaVersion >= targetVersion) {
    return record;
  }
  let migrated = record;
  for (const step of sortedSteps(migrations)) {
    if (step.fromVersion < migrated.schemaVersion || step.fromVersion >= targetVersion) {
      continue;
    }
    for (const operation of step.operations) {
      migrated = applyOperationToRecord(migrated, sectionKey, operation);
    }
    migrated =
      migrated === record
        ? { ...record, schemaVersion: step.fromVersion + 1 }
        : { ...migrated, schemaVersion: step.fromVersion + 1 };
  }
  if (migrated.schemaVersion !== targetVersion) {
    migrated = migrated === record ? { ...record } : migrated;
    migrated.schemaVersion = targetVersion;
  }
  return migrated;
}

function migrateSectionValues(
  sectionValues: SectionValues,
  migrations: MigrationStep[],
  targetVersion: number,
): SectionValues {
  let changed = false;
  const records = sectionValues.records.map((record) => {
    const migrated = migrateSectionRecord(record, sectionValues.sectionKey, migrations, targetVersion);
    if (migrated !== record) {
      changed = true;
    }
    return migrated;
  });
  return changed ? { ...sectionValues, records } : sectionValues;
}

/**
 * Migrate all stored values to the pack's schemaVersion.
 *
 * - Mixed-version snapshots are fine: each record migrates from its own
 *   stamp; records already at the target are untouched.
 * - Records stamped newer than the pack's schemaVersion cause a
 *   `SnapshotSchemaTooNew` refusal — the input is returned unread-writeable
 *   and unchanged.
 * - Pure and idempotent: `migrate(migrate(x)) === migrate(x)` structurally,
 *   and the input is never mutated (crash-before-save is always safe).
 */
export function migrateVaultValues(values: VaultValues, pack: FormPack): MigrationResult {
  const readabilityError = checkSnapshotReadable(values, pack.schemaVersion);
  if (readabilityError) {
    return { ok: false, error: readabilityError };
  }

  const authoredSteps = new Set(pack.migrations.map((step) => step.fromVersion));
  const recordVersions = Object.values(values).flatMap((section) =>
    section.records.map((record) => record.schemaVersion),
  );
  const minimumVersion = recordVersions.length > 0 ? Math.min(...recordVersions) : pack.schemaVersion;
  for (let version = minimumVersion; version < pack.schemaVersion; version += 1) {
    if (!authoredSteps.has(version)) {
      return {
        ok: false,
        error: {
          code: MIGRATION_CHAIN_INCOMPLETE,
          message: `The form pack is missing its schema v${version} to v${version + 1} migration. Nothing has been changed. Restore the previous pack or install a corrected update.`,
        },
      };
      }
  }

  const migrated: VaultValues = {};
  for (const [sectionKey, sectionValues] of Object.entries(values)) {
    migrated[sectionKey] = migrateSectionValues(sectionValues, pack.migrations, pack.schemaVersion);
  }
  return { ok: true, values: migrated };
}
