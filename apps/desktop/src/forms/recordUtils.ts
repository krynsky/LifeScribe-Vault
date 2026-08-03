/**
 * Small shared helpers for the generic form renderer and record-list UX.
 * Kept out of the component files so component modules only export
 * components (react-refresh) and so FormRenderer/RecordList never need a
 * circular import.
 */

export { recordSummaryLabel } from "../domain/recordReferences";

/** A fresh unique id for a new section record. */
export function createRecordId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `record-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
