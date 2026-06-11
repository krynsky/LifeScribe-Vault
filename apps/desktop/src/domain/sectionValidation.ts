/**
 * Section-level required-field validation for the page-level Save action
 * (U5). Mirrors the FormRenderer rules: hidden fields and fields whose
 * `visibleWhen` condition is unsatisfied validate as not-required.
 */

import { isConditionSatisfied, type ResolvedSection } from "./formModel";
import type { SectionRecord, SectionValues } from "./valuesStore";

export interface SectionValidationIssue {
  systemKey: string;
  recordId: string | null;
  message: string;
}

const EMPTY_RECORD_VALUES: SectionRecord["values"] = {};

export function validateSectionValues(
  section: ResolvedSection,
  values: SectionValues,
): SectionValidationIssue[] {
  const issues: SectionValidationIssue[] = [];
  const plainRecords = values.records.filter((record) => record.groupKey === undefined);

  for (const group of section.groups) {
    const records: Array<{ id: string | null; values: SectionRecord["values"] }> =
      group.repeatable
        ? values.records.filter((record) => record.groupKey === group.groupKey)
        : plainRecords.length > 0
          ? plainRecords.slice(0, 1)
          : [{ id: null, values: EMPTY_RECORD_VALUES }];

    for (const record of records) {
      for (const field of group.fields) {
        if (field.hidden || !field.required) {
          continue;
        }
        if (!isConditionSatisfied(field.visibleWhen, record.values)) {
          continue;
        }
        if ((record.values[field.systemKey] ?? "").trim().length === 0) {
          issues.push({
            systemKey: field.systemKey,
            recordId: record.id,
            message: `${field.label} is required.`,
          });
        }
      }
    }
  }
  return issues;
}
