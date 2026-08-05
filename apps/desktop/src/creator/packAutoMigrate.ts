/**
 * packAutoMigrate.ts — auto-derive declarative migration operations from
 * breaking inline edits the creator made between two pack revisions (U2).
 *
 * The creator edits a pack's structure directly. Two kinds of edit are
 * "breaking" — they can orphan stored user values — yet are safe to derive
 * automatically because the authorization is unambiguous from the diff:
 *
 *  - A field's `type` changed            -> `retypeField`
 *  - A group went repeatable -> single   -> `reduceCardinality`
 *
 * For each such edit we emit the matching declarative operation, bump the
 * pack's schemaVersion by one, and append a single MigrationStep so the
 * exported pack carries the authorization the upgrade validator (strict mode)
 * demands. Renames and value remaps are NOT auto-derived — those require
 * explicit creator intent and are out of scope here.
 *
 * Pure: inputs are never mutated. Idempotent: re-running on an already-derived
 * pack (diffing it against itself) produces no new operations.
 *
 * No React imports — plain data only.
 */

import type {
  FieldType,
  FormPack,
  MigrationOperation,
  MigrationStep,
  PackSection,
} from "../domain/formModel";
import { exportPack } from "./packExport";

export type AutoMigrateResult =
  | { ok: true; pack: FormPack; changed: boolean }
  | { ok: false; error: string };

interface FieldInfo {
  type: FieldType;
}

function indexSectionFields(section: PackSection): Map<string, FieldInfo> {
  const index = new Map<string, FieldInfo>();
  for (const group of section.groups) {
    for (const field of group.fields) {
      index.set(field.systemKey, { type: field.type });
    }
  }
  return index;
}

/**
 * Diff `prevPack` against `nextPack` and emit the breaking operations the
 * upgrade validator needs authored. Matching is by sectionKey + systemKey for
 * fields and sectionKey + groupKey for groups; cross-section matches do not
 * count (a key reused in another section is treated as unrelated).
 */
function deriveOperations(prevPack: FormPack, nextPack: FormPack): MigrationOperation[] {
  const operations: MigrationOperation[] = [];
  const prevSections = new Map(prevPack.sections.map((s) => [s.sectionKey, s]));
  const nextSectionKeys = new Set(nextPack.sections.map((section) => section.sectionKey));

  for (const previousSection of prevPack.sections) {
    if (!nextSectionKeys.has(previousSection.sectionKey)) {
      for (const field of previousSection.groups.flatMap((group) => group.fields)) {
        operations.push({
          op: "archiveField",
          sectionKey: previousSection.sectionKey,
          systemKey: field.systemKey,
        });
      }
    }
  }

  for (const nextSection of nextPack.sections) {
    const prevSection = prevSections.get(nextSection.sectionKey);
    if (!prevSection) {
      continue; // Brand-new section — nothing to migrate.
    }

    // Field retypes and explicit archival authorization for removals.
    const prevFields = indexSectionFields(prevSection);
    const nextFieldKeys = new Set(nextSection.groups.flatMap((group) => group.fields.map((field) => field.systemKey)));
    for (const systemKey of prevFields.keys()) {
      if (!nextFieldKeys.has(systemKey)) {
        operations.push({ op: "archiveField", sectionKey: nextSection.sectionKey, systemKey });
      }
    }
    for (const group of nextSection.groups) {
      for (const field of group.fields) {
        const before = prevFields.get(field.systemKey);
        if (before && before.type !== field.type) {
          operations.push({
            op: "retypeField",
            sectionKey: nextSection.sectionKey,
            systemKey: field.systemKey,
            toType: field.type,
          });
        }
      }
    }

    // Section-level cardinality reduction (multiRecord: true -> false).
    if (prevSection.multiRecord && !nextSection.multiRecord) {
      operations.push({
        op: "reduceCardinality",
        sectionKey: nextSection.sectionKey,
      });
    }

    // Group-level cardinality reductions (repeatable: true -> false).
    const prevGroups = new Map(prevSection.groups.map((g) => [g.groupKey, g]));
    for (const group of nextSection.groups) {
      const before = prevGroups.get(group.groupKey);
      if (before && before.repeatable && !group.repeatable) {
        operations.push({
          op: "reduceCardinality",
          sectionKey: nextSection.sectionKey,
          groupKey: group.groupKey,
        });
      }
    }
  }

  return operations;
}

/**
 * Derive auto-migrations for breaking inline edits and validate the result.
 *
 * On success returns the derived pack (schemaVersion bumped and a MigrationStep
 * appended only when operations were emitted) together with `changed`. On any
 * validation failure from the creator export pipeline, returns the joined error.
 */
export function deriveAutoMigration(prevPack: FormPack, nextPack: FormPack): AutoMigrateResult {
  const operations = deriveOperations(prevPack, nextPack);

  let derivedPack: FormPack;
  let changed: boolean;

  if (operations.length === 0) {
    derivedPack = {
      ...nextPack,
      schemaVersion: prevPack.schemaVersion,
      migrations: prevPack.migrations,
    };
    changed = false;
  } else {
    const step: MigrationStep = {
      fromVersion: prevPack.schemaVersion,
      operations,
    };
    derivedPack = {
      ...nextPack,
      schemaVersion: prevPack.schemaVersion + 1,
      migrations: [...prevPack.migrations, step],
    };
    changed = true;
  }

  // Validation gate: the derived pack must pass the same pipeline the creator
  // export uses (strict upgrade rules — lossy edits must be authorized, which
  // the derived operations now are).
  const exportResult = exportPack(derivedPack, prevPack);
  if (!exportResult.ok) {
    return { ok: false, error: exportResult.errors.join(" ") };
  }

  return { ok: true, pack: derivedPack, changed };
}
