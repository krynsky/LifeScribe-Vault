/**
 * Small shared helpers for the generic form renderer and record-list UX.
 * Kept out of the component files so component modules only export
 * components (react-refresh) and so FormRenderer/RecordList never need a
 * circular import.
 */

import type { ResolvedField } from "../domain/formModel";
import type { SectionRecord } from "../domain/valuesStore";

/** A fresh unique id for a new section record. */
export function createRecordId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `record-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Summary label for a collapsed record row: the record's first
 * readiness-rule protected-field value, falling back to its first non-empty
 * value in field order, then "Untitled".
 */
export function recordSummaryLabel(
  record: SectionRecord,
  orderedFields: ReadonlyArray<Pick<ResolvedField, "systemKey">>,
  readinessKeys: readonly string[],
): string {
  for (const key of readinessKeys) {
    const value = record.values[key]?.trim();
    if (value) {
      return value;
    }
  }
  for (const field of orderedFields) {
    const value = record.values[field.systemKey]?.trim();
    if (value) {
      return value;
    }
  }
  return "Untitled";
}
