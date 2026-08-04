/**
 * Section record values, archived answers, and reconciliation.
 *
 * Law: field-level user data is never silently dropped. When a definition
 * change orphans a value (field removed, field retyped without a conforming
 * value, cardinality reduced, group removed), the value becomes an archived
 * answer carrying its original label and the reason — never deleted, never
 * coerced.
 *
 * All functions here are pure: they never mutate their inputs and are
 * deterministic (no clocks, no randomness) so migrate/reconcile-on-read can
 * run repeatedly with identical results until a normal save persists them.
 */

import type { FieldType, ResolvedField, ResolvedSection } from "./formModel";

/**
 * Attachment reference placeholder — declared now so U4–U7 type-check against
 * it; U8 fills in behavior (encrypt/store/sweep) additively.
 */
export interface AttachmentRef {
  id: string;
  fileName: string;
  sizeBytes: number;
}

export interface SectionRecord {
  id: string;
  /**
   * Set for records belonging to a repeatable group inside a section;
   * absent for the plain records of a multi-record section.
   */
  groupKey?: string;
  /** The pack schemaVersion the values were entered under. */
  schemaVersion: number;
  values: Record<string, string>;
  attachments?: AttachmentRef[];
}

export interface ArchivedAnswer {
  id: string;
  sectionKey: string;
  recordId: string;
  systemKey: string;
  /** The field label at the time the value was archived. */
  originalLabel: string;
  value: string;
  /**
   * File metadata retained when a file-valued answer is archived. The
   * ciphertext remains part of the vault until the user explicitly deletes
   * the archived answer; form-definition changes must never orphan it.
   */
  attachment?: AttachmentRef;
  /** Human-readable reason the value was orphaned. */
  reason: string;
}

export interface SectionValues {
  sectionKey: string;
  records: SectionRecord[];
  archivedAnswers: ArchivedAnswer[];
}

/** sectionKey -> values for that section. */
export type VaultValues = Record<string, SectionValues>;

export interface KeyRename {
  sectionKey: string;
  from: string;
  to: string;
}

/** Field metadata from the previously-installed definition, used to detect retypes. */
export interface PreviousFieldInfo {
  label: string;
  type: FieldType;
}

export type PreviousFieldIndex = Record<string, PreviousFieldInfo>;

export interface ReconcileResult {
  sectionValues: SectionValues;
  /** Only the archived answers newly produced by this reconcile pass. */
  newlyArchived: ArchivedAnswer[];
}

export function createSectionValues(sectionKey: string): SectionValues {
  return { sectionKey, records: [], archivedAnswers: [] };
}

export function createSectionRecord(
  id: string,
  schemaVersion: number,
  values: Record<string, string>,
  groupKey?: string,
): SectionRecord {
  const record: SectionRecord = { id, schemaVersion, values: { ...values } };
  if (groupKey !== undefined) {
    record.groupKey = groupKey;
  }
  return record;
}

/**
 * Collect trimmed, non-empty form input restricted to the given field
 * definitions (unknown keys are ignored — they cannot enter the store).
 */
export function collectRecordValues(
  fields: ReadonlyArray<Pick<ResolvedField, "systemKey">>,
  input: Record<string, string | undefined>,
): Record<string, string> {
  const collected: Record<string, string> = {};
  for (const field of fields) {
    const raw = input[field.systemKey];
    if (typeof raw === "string" && raw.trim().length > 0) {
      collected[field.systemKey] = raw.trim();
    }
  }
  return collected;
}

/** Expand a record into a complete form-input map ("" for absent fields). */
export function applyRecordValues(
  fields: ReadonlyArray<Pick<ResolvedField, "systemKey">>,
  record: SectionRecord,
): Record<string, string> {
  const applied: Record<string, string> = {};
  for (const field of fields) {
    applied[field.systemKey] = record.values[field.systemKey] ?? "";
  }
  return applied;
}

export function upsertSectionRecord(
  sectionValues: SectionValues,
  record: SectionRecord,
): SectionValues {
  const index = sectionValues.records.findIndex((candidate) => candidate.id === record.id);
  const records =
    index === -1
      ? [...sectionValues.records, record]
      : sectionValues.records.map((candidate, position) => (position === index ? record : candidate));
  return { ...sectionValues, records };
}

/**
 * Re-key stored values after merge renamed colliding custom fields, so the
 * user's values follow their renamed custom field instead of being read as
 * the new default field's values.
 */
export function applyKeyRenames(values: VaultValues, renames: KeyRename[]): VaultValues {
  if (renames.length === 0) {
    return values;
  }
  const result: VaultValues = {};
  for (const [sectionKey, sectionValues] of Object.entries(values)) {
    const sectionRenames = renames.filter((rename) => rename.sectionKey === sectionKey);
    if (sectionRenames.length === 0) {
      result[sectionKey] = sectionValues;
      continue;
    }
    result[sectionKey] = {
      ...sectionValues,
      records: sectionValues.records.map((record) => {
        const renamedValues: Record<string, string> = {};
        for (const [key, value] of Object.entries(record.values)) {
          const rename = sectionRenames.find((candidate) => candidate.from === key);
          renamedValues[rename ? rename.to : key] = value;
        }
        return { ...record, values: renamedValues };
      }),
    };
  }
  return result;
}

/** Does a stored string value conform to the given field's current type? */
export function valueConformsToField(
  value: string,
  field: Pick<ResolvedField, "type" | "options">,
): boolean {
  switch (field.type) {
    case "select":
      return (field.options ?? []).some((option) => option.value === value);
    case "recordRef":
      return value.length > 0;
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "email":
      return value.includes("@");
    case "text":
    case "textarea":
    case "phone":
    case "file":
    case "path":
      return true;
  }
}

interface CurrentFieldInfo {
  field: ResolvedField;
  groupKey: string;
}

function indexResolvedSection(section: ResolvedSection): Map<string, CurrentFieldInfo> {
  const index = new Map<string, CurrentFieldInfo>();
  for (const group of section.groups) {
    for (const field of group.fields) {
      index.set(field.systemKey, { field, groupKey: group.groupKey });
    }
  }
  return index;
}

function nextArchiveId(existing: Set<string>, base: string): string {
  if (!existing.has(base)) {
    existing.add(base);
    return base;
  }
  let suffix = 2;
  while (existing.has(`${base}:${suffix}`)) {
    suffix += 1;
  }
  const id = `${base}:${suffix}`;
  existing.add(id);
  return id;
}

/**
 * Reconcile stored section values against the current resolved definition.
 *
 * - Whole records are archived when their group no longer exists, when their
 *   group is no longer repeatable (records beyond the first), or when the
 *   section is no longer multi-record (plain records beyond the first).
 * - Field values are archived when the field no longer exists, or when
 *   `previousFields` shows the field's type changed and the stored value does
 *   not conform to the new type (never coerced).
 * - Saved select values absent from the current options with an *unchanged*
 *   type are left in place — packMerge flags them as read-only "previous
 *   answers" instead of archiving them.
 *
 * Pure and idempotent: reconciling an already-reconciled result is a no-op.
 */
export function reconcileSectionValues(
  sectionValues: SectionValues,
  section: ResolvedSection,
  previousFields?: PreviousFieldIndex,
  retypedFields?: ReadonlySet<string>,
): ReconcileResult {
  const fieldIndex = indexResolvedSection(section);
  const groupIndex = new Map(section.groups.map((group) => [group.groupKey, group]));
  const archiveIds = new Set(sectionValues.archivedAnswers.map((answer) => answer.id));
  const newlyArchived: ArchivedAnswer[] = [];

  const labelFor = (systemKey: string): string =>
    previousFields?.[systemKey]?.label ?? fieldIndex.get(systemKey)?.field.label ?? systemKey;

  const archiveValue = (record: SectionRecord, systemKey: string, value: string, reason: string) => {
    const attachment = record.attachments?.find((candidate) => candidate.id === value);
    newlyArchived.push({
      id: nextArchiveId(archiveIds, `${sectionValues.sectionKey}:${record.id}:${systemKey}`),
      sectionKey: sectionValues.sectionKey,
      recordId: record.id,
      systemKey,
      originalLabel: labelFor(systemKey),
      value,
      ...(attachment ? { attachment: { ...attachment } } : {}),
      reason,
    });
  };

  const archiveWholeRecord = (record: SectionRecord, reason: string) => {
    for (const [systemKey, value] of Object.entries(record.values)) {
      if (value.length > 0) {
        archiveValue(record, systemKey, value, reason);
      }
    }
  };

  // Pass 1: record-level reconciliation (group removal, cardinality reduction).
  const keptRecords: SectionRecord[] = [];
  const seenPerGroup = new Map<string, number>();
  let plainRecordsSeen = 0;

  for (const record of sectionValues.records) {
    if (record.groupKey !== undefined) {
      const group = groupIndex.get(record.groupKey);
      if (!group) {
        archiveWholeRecord(record, `The "${record.groupKey}" group was removed from this section.`);
        continue;
      }
      const seen = seenPerGroup.get(record.groupKey) ?? 0;
      if (!group.repeatable && seen >= 1) {
        archiveWholeRecord(
          record,
          `The "${group.title}" group no longer holds multiple records.`,
        );
        continue;
      }
      seenPerGroup.set(record.groupKey, seen + 1);
    } else {
      if (!section.multiRecord && plainRecordsSeen >= 1) {
        archiveWholeRecord(record, `The "${section.title}" section no longer holds multiple records.`);
        continue;
      }
      plainRecordsSeen += 1;
    }
    keptRecords.push(record);
  }

  // Pass 2: field-level reconciliation within kept records.
  const reconciledRecords = keptRecords.map((record) => {
    let changed = false;
    const droppedAttachmentIds = new Set<string>();
    const keptValues: Record<string, string> = {};
    for (const [systemKey, value] of Object.entries(record.values)) {
      const current = fieldIndex.get(systemKey);
      if (!current) {
        if (value.length > 0) {
          const droppedRef = record.attachments?.find((a) => a.id === value);
          if (droppedRef) {
            archiveValue(
              record,
              systemKey,
              value,
              `This file field was removed; the attached file "${droppedRef.fileName}" was preserved in archived data.`,
            );
            droppedAttachmentIds.add(value);
          } else {
            archiveValue(record, systemKey, value, "This field was removed from the form definition.");
          }
        }
        changed = true;
        continue;
      }
      const previous = previousFields?.[systemKey];
      if (
        ((previous && previous.type !== current.field.type) || retypedFields?.has(systemKey)) &&
        value.length > 0 &&
        !valueConformsToField(value, current.field)
      ) {
        archiveValue(
          record,
          systemKey,
          value,
          previous
            ? `This field changed from ${previous.type} to ${current.field.type} and the previous answer no longer fits.`
            : `This field changed to ${current.field.type} and the previous answer no longer fits.`,
        );
        changed = true;
        continue;
      }
      keptValues[systemKey] = value;
    }
    if (!changed && droppedAttachmentIds.size === 0) return record;
    const nextAttachments = record.attachments?.filter((a) => !droppedAttachmentIds.has(a.id));
    return {
      ...record,
      values: keptValues,
      ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
    };
  });

  if (newlyArchived.length === 0 && reconciledRecords.length === sectionValues.records.length) {
    return { sectionValues, newlyArchived: [] };
  }

  return {
    sectionValues: {
      ...sectionValues,
      records: reconciledRecords,
      archivedAnswers: [...sectionValues.archivedAnswers, ...newlyArchived],
    },
    newlyArchived,
  };
}

/**
 * Every non-empty user value visible anywhere in the store — active record
 * values plus archived answers. Used by the "no value is ever discarded"
 * property tests.
 */
export function collectAllStoredValues(values: VaultValues): string[] {
  const collected: string[] = [];
  for (const sectionValues of Object.values(values)) {
    for (const record of sectionValues.records) {
      for (const value of Object.values(record.values)) {
        if (value.length > 0) {
          collected.push(value);
        }
      }
    }
    for (const answer of sectionValues.archivedAnswers) {
      if (answer.value.length > 0) {
        collected.push(answer.value);
      }
    }
  }
  return collected;
}
