import {
  type FieldDefinition,
  type FieldOption,
  type PackSection,
  type RecordReferenceDefinition,
  type RecordReferenceDisplayField,
  type ResolvedSection,
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

export interface RecordReferenceSourceSection {
  sectionKey: string;
  title: string;
  readinessRule: { requiredKeys: string[] };
  groups: ReadonlyArray<{ fields: ReadonlyArray<FieldDefinition> }>;
}

export interface RecordReferenceContext {
  sections: ResolvedSection[];
  savedValues: VaultValues;
  effectiveValues: VaultValues;
}

function sourceSectionFields(section: RecordReferenceSourceSection): FieldDefinition[] {
  return section.groups.flatMap((group) => group.fields);
}

export function recordReferenceSourceFields(section: RecordReferenceSourceSection): FieldDefinition[] {
  return sourceSectionFields(section).filter((field) => field.type !== "recordRef");
}

export function defaultRecordReference(
  section: PackSection | undefined,
): RecordReferenceDefinition | undefined {
  if (!section) return undefined;
  const fields = recordReferenceSourceFields(section);
  const displayKey =
    section.readinessRule.requiredKeys.find((key) =>
      fields.some((field) => field.systemKey === key),
    ) ?? fields[0]?.systemKey;
  if (!displayKey) return undefined;
  return {
    sectionKey: section.sectionKey,
    displayFields: [{ systemKey: displayKey }],
    separator: " — ",
  };
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
  sections: ReadonlyArray<RecordReferenceSourceSection>,
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

function displayFieldValue(
  field: FieldDefinition,
  value: string,
  sections: ReadonlyArray<RecordReferenceSourceSection>,
  values: VaultValues,
): string {
  if (field.type === "recordRef") {
    return (
      resolveRecordReference(field, sections, values, value).options.find(
        (option) => option.value === value,
      )?.label ?? value
    );
  }
  if (field.type === "select") {
    return field.options?.find((option) => option.value === value)?.label ?? value;
  }
  return value;
}

export function recordSummaryLabel(
  record: SectionRecord,
  orderedFields: ReadonlyArray<FieldDefinition>,
  readinessKeys: readonly string[],
  sections: ReadonlyArray<RecordReferenceSourceSection> = [],
  values: VaultValues = {},
): string {
  const readiness = new Set(readinessKeys);
  const candidates = [
    ...orderedFields.filter((field) => readiness.has(field.systemKey)),
    ...orderedFields.filter((field) => !readiness.has(field.systemKey)),
  ];
  for (const field of candidates) {
    const value = record.values[field.systemKey]?.trim();
    if (!value) continue;
    return displayFieldValue(field, value, sections, values);
  }
  return "Untitled";
}

export function findRecordReferenceUsages(
  sourceSectionKey: string,
  sourceRecordId: string,
  sections: ReadonlyArray<RecordReferenceSourceSection>,
  values: VaultValues,
): RecordReferenceUsage[] {
  const usages: RecordReferenceUsage[] = [];
  for (const section of sections) {
    const referencingFields = sourceSectionFields(section).filter(
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
          recordLabel: recordSummaryLabel(
            record,
            sourceSectionFields(section),
            section.readinessRule.requiredKeys,
            sections,
            values,
          ),
          fieldSystemKey: field.systemKey,
          fieldLabel: field.label,
        });
      }
    }
  }
  return usages;
}
