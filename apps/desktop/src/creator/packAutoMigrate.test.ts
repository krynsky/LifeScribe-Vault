/**
 * Tests for packAutoMigrate.ts — auto-derivation of declarative migration
 * operations from breaking inline edits (retype, cardinality reduction).
 *
 * Written test-first (U2). The derived pack must pass the same exportPack
 * validation gate the creator uses, and applying the derived migration must
 * never silently drop a stored value.
 */

import { describe, it, expect } from "vitest";

import type { FormPack, MigrationStep } from "../domain/formModel";
import { migrateSectionRecord } from "../domain/packMigrations";
import {
  createSectionRecord,
  type SectionValues,
} from "../domain/valuesStore";
import { deriveAutoMigration } from "./packAutoMigrate";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function minimalPack(): FormPack {
  return {
    packId: "test.pack",
    packVersion: "1.0.0",
    schemaVersion: 1,
    minAppVersion: "0.0.0",
    sections: [
      {
        sectionKey: "sec",
        title: "Section",
        lede: "",
        multiRecord: false,
        order: 1,
        groups: [
          {
            groupKey: "grp",
            title: "Group",
            repeatable: true,
            order: 1,
            fields: [
              {
                systemKey: "note",
                label: "Note",
                type: "text",
                required: false,
                protected: false,
                order: 1,
              },
              {
                systemKey: "choice",
                label: "Choice",
                type: "select",
                required: false,
                protected: false,
                order: 2,
                options: [
                  { value: "a", label: "A" },
                  { value: "b", label: "B" },
                ],
              },
            ],
          },
        ],
        readinessRule: { requiredKeys: [] },
        kitMapping: { entries: [] },
      },
    ],
    migrations: [],
  };
}

/** Deep-clone so tests can mutate a next-pack freely without aliasing prev. */
function clone(pack: FormPack): FormPack {
  return JSON.parse(JSON.stringify(pack)) as FormPack;
}

function retypeNoteToDate(pack: FormPack): FormPack {
  const next = clone(pack);
  const field = next.sections[0]!.groups[0]!.fields.find((f) => f.systemKey === "note")!;
  field.type = "date";
  return next;
}

function makeGroupSingle(pack: FormPack): FormPack {
  const next = clone(pack);
  next.sections[0]!.groups[0]!.repeatable = false;
  return next;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveAutoMigration", () => {
  it("reports no change when prev and next are identical", () => {
    const pack = minimalPack();
    const result = deriveAutoMigration(pack, pack);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.pack.schemaVersion).toBe(1);
    expect(result.pack.migrations).toEqual([]);
  });

  it("emits a retypeField op and bumps schemaVersion on a type change", () => {
    const prev = minimalPack();
    const next = retypeNoteToDate(prev);
    const result = deriveAutoMigration(prev, next);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.pack.schemaVersion).toBe(2);
    const step = result.pack.migrations.find((s) => s.fromVersion === 1);
    expect(step).toBeDefined();
    expect(step!.operations).toEqual([
      { op: "retypeField", sectionKey: "sec", systemKey: "note", toType: "date" },
    ]);
  });

  it("emits a reduceCardinality op when a group becomes non-repeatable", () => {
    const prev = minimalPack();
    const next = makeGroupSingle(prev);
    const result = deriveAutoMigration(prev, next);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    const step = result.pack.migrations.find((s) => s.fromVersion === 1)!;
    expect(step.operations).toContainEqual({
      op: "reduceCardinality",
      sectionKey: "sec",
      groupKey: "grp",
    });
  });

  it("collects two breaking edits into a single MigrationStep", () => {
    const prev = minimalPack();
    let next = retypeNoteToDate(prev);
    next.sections[0]!.groups[0]!.repeatable = false;
    const result = deriveAutoMigration(prev, next);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const steps = result.pack.migrations.filter((s) => s.fromVersion === 1);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.operations).toHaveLength(2);
    expect(steps[0]!.operations).toContainEqual({
      op: "retypeField",
      sectionKey: "sec",
      systemKey: "note",
      toType: "date",
    });
    expect(steps[0]!.operations).toContainEqual({
      op: "reduceCardinality",
      sectionKey: "sec",
      groupKey: "grp",
    });
  });

  it("is idempotent: re-running on the derived pack emits nothing", () => {
    const prev = minimalPack();
    const next = retypeNoteToDate(prev);
    const first = deriveAutoMigration(prev, next);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const derived = first.pack;

    const second = deriveAutoMigration(derived, derived);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changed).toBe(false);
    expect(second.pack.schemaVersion).toBe(derived.schemaVersion);
    expect(second.pack.migrations).toEqual(derived.migrations);
  });

  it("does not mutate its inputs", () => {
    const prev = minimalPack();
    const next = retypeNoteToDate(prev);
    const prevSnapshot = JSON.stringify(prev);
    const nextSnapshot = JSON.stringify(next);
    deriveAutoMigration(prev, next);
    expect(JSON.stringify(prev)).toBe(prevSnapshot);
    expect(JSON.stringify(next)).toBe(nextSnapshot);
  });

  it("derived pack passes exportPack validation (ok: true)", () => {
    const prev = minimalPack();
    const next = retypeNoteToDate(prev);
    const result = deriveAutoMigration(prev, next);
    expect(result.ok).toBe(true);
  });

  it("preserves the retyped field's stored value when the derived migration is applied", () => {
    const prev = minimalPack();
    const next = retypeNoteToDate(prev);
    const result = deriveAutoMigration(prev, next);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const derived = result.pack;

    const sectionValues: SectionValues = {
      sectionKey: "sec",
      records: [createSectionRecord("r1", 1, { note: "not-a-date" }, "grp")],
      archivedAnswers: [],
    };

    const migrated = migrateSectionRecord(
      sectionValues.records[0]!,
      sectionValues.sectionKey,
      derived.migrations as MigrationStep[],
      derived.schemaVersion,
    );

    // The migration step is an authorization marker; without a valueMap the
    // value is carried forward untouched (reconcile, not migrate, archives a
    // non-conforming value). It must still be present under the field key.
    expect(migrated.values).toHaveProperty("note");
    expect(migrated.values.note).toBe("not-a-date");
    expect(migrated.schemaVersion).toBe(derived.schemaVersion);
  });
});
