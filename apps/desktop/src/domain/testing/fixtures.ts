/**
 * Test-only fixture builders for form model v2 tests.
 * Imported exclusively from colocated `.test.ts` files.
 */

import type {
  FieldDefinition,
  FieldGroup,
  FormPack,
  PackSection,
} from "../formModel";
import type {
  PreviousFieldIndex,
  SectionRecord,
  SectionValues,
  VaultValues,
} from "../valuesStore";

export function makeField(overrides: Partial<FieldDefinition> & Pick<FieldDefinition, "systemKey">): FieldDefinition {
  return {
    label: overrides.systemKey,
    type: "text",
    required: false,
    protected: false,
    order: 1,
    ...overrides,
  };
}

export function makeGroup(overrides: Partial<FieldGroup> & Pick<FieldGroup, "groupKey">): FieldGroup {
  return {
    title: overrides.groupKey,
    repeatable: false,
    order: 1,
    fields: [],
    ...overrides,
  };
}

export function makeSection(overrides: Partial<PackSection> & Pick<PackSection, "sectionKey">): PackSection {
  return {
    title: overrides.sectionKey,
    lede: `About ${overrides.sectionKey}.`,
    multiRecord: false,
    order: 1,
    groups: [],
    readinessRule: { requiredKeys: [] },
    kitMapping: { entries: [] },
    ...overrides,
  };
}

export function makePack(overrides: Partial<FormPack> = {}): FormPack {
  return {
    packId: "test-pack",
    packVersion: "1.0.0",
    schemaVersion: 1,
    minAppVersion: "0.2.0",
    sections: [],
    migrations: [],
    ...overrides,
  };
}

export function makeRecord(
  overrides: Partial<SectionRecord> & Pick<SectionRecord, "id">,
): SectionRecord {
  return {
    schemaVersion: 1,
    values: {},
    ...overrides,
  };
}

export function makeSectionValues(
  sectionKey: string,
  records: SectionRecord[] = [],
): SectionValues {
  return { sectionKey, records, archivedAnswers: [] };
}

export function makeVaultValues(sections: SectionValues[]): VaultValues {
  return Object.fromEntries(sections.map((section) => [section.sectionKey, section]));
}

/**
 * Index of a pack section's fields as the "previously installed definition"
 * shape reconcile uses to detect retypes and recover original labels.
 */
export function previousFieldsOf(pack: FormPack, sectionKey: string): PreviousFieldIndex {
  const section = pack.sections.find((candidate) => candidate.sectionKey === sectionKey);
  if (!section) {
    throw new Error(`fixture pack has no section ${sectionKey}`);
  }
  const index: PreviousFieldIndex = {};
  for (const group of section.groups) {
    for (const field of group.fields) {
      index[field.systemKey] = { label: field.label, type: field.type };
    }
  }
  return index;
}

/**
 * A representative single-section pack used across merge/migration tests:
 * one "plan" section with a non-repeatable "main" group (protected select +
 * optional fields) and a repeatable "contact" group.
 */
export function makePlanPack(overrides: Partial<FormPack> = {}): FormPack {
  return makePack({
    sections: [
      makeSection({
        sectionKey: "plan",
        title: "Plan",
        order: 1,
        groups: [
          makeGroup({
            groupKey: "main",
            title: "Main",
            order: 1,
            fields: [
              makeField({
                systemKey: "provider",
                label: "Provider",
                type: "select",
                required: true,
                protected: true,
                options: [
                  { value: "1Password", label: "1Password" },
                  { value: "Bitwarden", label: "Bitwarden" },
                  { value: "Other", label: "Other" },
                ],
                order: 1,
              }),
              makeField({
                systemKey: "otherProvider",
                label: "Other provider",
                visibleWhen: { field: "provider", equals: "Other" },
                order: 2,
              }),
              makeField({ systemKey: "notes", label: "Notes", type: "textarea", order: 3 }),
            ],
          }),
          makeGroup({
            groupKey: "contact",
            title: "Contact",
            repeatable: true,
            order: 2,
            fields: [
              makeField({ systemKey: "contactName", label: "Contact name", order: 1 }),
              makeField({ systemKey: "contactEmail", label: "Contact email", type: "email", order: 2 }),
            ],
          }),
        ],
        readinessRule: { requiredKeys: ["provider"] },
        kitMapping: { entries: [{ heading: "Plan", fields: ["provider", "contactName"] }] },
      }),
    ],
    ...overrides,
  });
}
