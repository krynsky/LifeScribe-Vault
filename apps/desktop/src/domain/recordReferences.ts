import {
  sectionFields,
  type FieldDefinition,
  type FieldOption,
  type PackSection,
  type RecordReferenceDisplayField,
} from "./formModel";
import type { SectionRecord, VaultValues } from "./valuesStore";

export interface ResolvedRecordReference {
  options: FieldOption[];
  unavailableValue: string | null;
}

export interface RecordReferenceUsage {
  sectionKey: string;
  sectionTitle: string;
  recordId: string;
  recordLabel: string;
  fieldSystemKey: string;
  fieldLabel: string;
}

function formatDisplayPart(value: string, field: RecordReferenceDisplayField): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (field.format === "last4") {
    return `•••• ${trimmed.slice(-4)}`;
  }
  return trimmed;
}

export function recordReferenceLabel(
  record: SectionRecord,
  field: Pick<FieldDefinition, "reference">,
): string {
  const reference = field.reference;
  if (!reference) return "Untitled record";
  const label = reference.displayFields
    .map((part) => formatDisplayPart(record.values[part.systemKey] ?? "", part))
    .filter(Boolean)
    .join(reference.separator);
  return label || "Untitled record";
}

export function resolveRecordReference(
  field: Pick<FieldDefinition, "type" | "reference">,
  sections: ReadonlyArray<PackSection>,
  values: VaultValues,
  selectedValue = "",
): ResolvedRecordReference {
  if (field.type !== "recordRef" || !field.reference) {
    return { options: [], unavailableValue: selectedValue || null };
  }
  const sourceSection = sections.find(
    (section) => section.sectionKey === field.reference!.sectionKey,
  );
  const sourceValues = values[field.reference.sectionKey];
  if (!sourceSection || !sourceValues) {
    return { options: [], unavailableValue: selectedValue || null };
  }
  const options = sourceValues.records.map((record) => ({
    value: record.id,
    label: recordReferenceLabel(record, field),
  }));
  return {
    options,
    unavailableValue:
      selectedValue && !options.some((option) => option.value === selectedValue)
        ? selectedValue
        : null,
  };
}

function usageRecordLabel(
  section: PackSection,
  record: SectionRecord,
  sections: ReadonlyArray<PackSection>,
  values: VaultValues,
): string {
  const fields = sectionFields(section);
  const readiness = new Set(section.readinessRule.requiredKeys);
  const candidates = [
    ...fields.filter((field) => readiness.has(field.systemKey)),
    ...fields.filter((field) => !readiness.has(field.systemKey)),
  ];
  for (const field of candidates) {
    const value = record.values[field.systemKey]?.trim();
    if (!value) continue;
    if (field.type === "recordRef") {
      const resolved = resolveRecordReference(field, sections, values, value);
      const label = resolved.options.find((option) => option.value === value)?.label;
      if (label) return label;
    } else if (field.type === "select") {
      return field.options?.find((option) => option.value === value)?.label ?? value;
    } else {
      return value;
    }
  }
  return "Untitled";
}

export function findRecordReferenceUsages(
  sourceSectionKey: string,
  sourceRecordId: string,
  sections: ReadonlyArray<PackSection>,
  values: VaultValues,
): RecordReferenceUsage[] {
  const usages: RecordReferenceUsage[] = [];
  for (const section of sections) {
    const referencingFields = sectionFields(section).filter(
      (field) =>
        field.type === "recordRef" && field.reference?.sectionKey === sourceSectionKey,
    );
    if (referencingFields.length === 0) continue;
    for (const record of values[section.sectionKey]?.records ?? []) {
      for (const field of referencingFields) {
        if (record.values[field.systemKey] !== sourceRecordId) continue;
        usages.push({
          sectionKey: section.sectionKey,
          sectionTitle: section.title,
          recordId: record.id,
          recordLabel: usageRecordLabel(section, record, sections, values),
          fieldSystemKey: field.systemKey,
          fieldLabel: field.label,
        });
      }
    }
  }
  return usages;
}
