/**
 * Form model v2 — the data types for versioned form-definition packs,
 * user overlays, and the resolved definition the generic renderer consumes.
 *
 * Laws (see CLAUDE.md / the v2 rebuild plan):
 * - Form definitions are data, not executable scripts. Conditional visibility
 *   is expressed only as declarative `visibleWhen` objects — never expression
 *   strings, custom JS, remote scripts, or webhooks.
 * - systemKey is field identity. Protected system keys stay stable unless all
 *   dependent save/status/recovery mappings migrate in the same change.
 * - End-user customization is a constrained overlay (relabel, reorder, add
 *   custom fields, hide optional fields) merged at load — it can never
 *   delete or retype protected fields.
 */

export const FIELD_TYPES = ["text", "textarea", "date", "select", "email", "phone", "file", "path"] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldOption {
  value: string;
  label: string;
}

/**
 * Declarative conditional visibility. Exactly one of `equals` / `oneOf`.
 * Never a string, never an expression — validated as untrusted input.
 */
export type VisibleWhen =
  | { field: string; equals: string }
  | { field: string; oneOf: string[] };

export interface FieldDefinition {
  systemKey: string;
  label: string;
  helperText?: string;
  type: FieldType;
  required: boolean;
  protected: boolean;
  options?: FieldOption[];
  visibleWhen?: VisibleWhen;
  order: number;
}

export interface FieldGroup {
  groupKey: string;
  title: string;
  repeatable: boolean;
  minRecords?: number;
  order: number;
  fields: FieldDefinition[];
}

/** Names the protected systemKeys whose values gate section readiness. */
export interface ReadinessRule {
  requiredKeys: string[];
}

export interface KitMappingEntry {
  heading: string;
  fields: string[];
}

/** Which fields flow into the generated Recovery Kit, grouped under headings. */
export interface KitMapping {
  entries: KitMappingEntry[];
}

export interface PackSection {
  sectionKey: string;
  title: string;
  lede: string;
  multiRecord: boolean;
  order: number;
  groups: FieldGroup[];
  readinessRule: ReadinessRule;
  kitMapping: KitMapping;
}

/**
 * Declarative migration operations. Migrations are pure data compiled into
 * pure, deterministic, idempotent functions by packMigrations.ts — never
 * scripts. An authored operation is what authorizes a rename / retype /
 * cardinality reduction on an existing key.
 */
export type MigrationOperation =
  | { op: "renameField"; sectionKey: string; fromKey: string; toKey: string }
  | { op: "mapValue"; sectionKey: string; systemKey: string; mapping: Record<string, string> }
  | {
      op: "retypeField";
      sectionKey: string;
      systemKey: string;
      toType: FieldType;
      valueMap?: Record<string, string>;
    }
  | { op: "reduceCardinality"; sectionKey: string; groupKey?: string };

export const MIGRATION_OP_KINDS = [
  "renameField",
  "mapValue",
  "retypeField",
  "reduceCardinality",
] as const;

/** One stepwise migration: schemaVersion `fromVersion` -> `fromVersion + 1`. */
export interface MigrationStep {
  fromVersion: number;
  operations: MigrationOperation[];
}

// ---------------------------------------------------------------------------
// Composable form modules — an onboarding question whose selected option adds
// or removes whole fields on the base pack. Declarative data only (no scripts).
// Composition happens in composePack.ts; selection lives in the vault profile.
// ---------------------------------------------------------------------------

/** A whole field a module option inserts, with its placement in the base pack. */
export interface ModuleAddField {
  sectionKey: string;
  groupKey: string;
  /** Desired FINAL slot; inserted at order-0.5 then the group is renumbered. */
  order: number;
  field: FieldDefinition;
}

/** One mutually-exclusive answer to a module's question. */
export interface FormModuleOption {
  optionId: string;
  label?: string;
  description?: string;
  /** Whole fields this option inserts into the composed pack. */
  addFields?: ModuleAddField[];
  /** systemKeys this option removes from the composed pack. */
  removeKeys?: string[];
  /** sectionKey -> systemKeys appended to the section's first kitMapping entry. */
  kitAdditions?: Record<string, string[]>;
}

/** An onboarding question. A binary toggle is just a 2-option module. */
export interface FormModule {
  moduleId: string;
  title: string;
  question: string;
  helperText?: string;
  options: FormModuleOption[];
  /** optionId used when the profile has no selection for this module. */
  defaultOptionId: string;
  /** Onboarding display order and composition order (ascending). */
  order: number;
}

export interface FormPack {
  packId: string;
  packVersion: string;
  schemaVersion: number;
  minAppVersion: string;
  sections: PackSection[];
  migrations: MigrationStep[];
  /** Optional onboarding modules composed onto this pack at load. */
  modules?: FormModule[];
}

// ---------------------------------------------------------------------------
// User overlay — per-section deltas, pure data merged at load (packMerge.ts).
// ---------------------------------------------------------------------------

export interface OverlayRelabel {
  label?: string;
  helperText?: string;
}

/**
 * A user-added custom field. Structurally it can never be required or
 * protected — those capabilities simply do not exist on the type.
 * systemKey must live in the `custom.<sectionKey>.<id>` namespace.
 */
export interface CustomFieldDefinition {
  systemKey: string;
  groupKey: string;
  label: string;
  helperText?: string;
  type: FieldType;
  options?: FieldOption[];
  order: number;
}

export interface SectionOverlay {
  sectionKey: string;
  /** systemKey -> label/helperText override. */
  relabels?: Record<string, OverlayRelabel>;
  /** systemKeys in the user's preferred order (applied within each group). */
  fieldOrder?: string[];
  customFields?: CustomFieldDefinition[];
  /** Optional, unprotected, non-readiness fields the user chose to hide. */
  hiddenFields?: string[];
}

export interface UserOverlay {
  sections: SectionOverlay[];
}

// ---------------------------------------------------------------------------
// Resolved definition — merge output the renderer (U4) consumes.
// ---------------------------------------------------------------------------

/** A saved select value that is no longer among the field's options. */
export interface PreviousAnswer {
  recordId: string;
  value: string;
}

export interface ResolvedField extends FieldDefinition {
  source: "pack" | "custom";
  hidden: boolean;
  /** Present when saved select values fell out of the current option list. */
  previousAnswers?: PreviousAnswer[];
}

export interface ResolvedGroup extends Omit<FieldGroup, "fields"> {
  fields: ResolvedField[];
}

export interface ResolvedSection extends Omit<PackSection, "groups"> {
  groups: ResolvedGroup[];
}

export type MergeNoticeKind =
  | "custom-field-renamed"
  | "hide-flag-invalidated"
  | "previous-answer"
  | "dangling-condition";

export interface MergeNotice {
  kind: MergeNoticeKind;
  sectionKey: string;
  systemKey?: string;
  message: string;
}

export interface ResolvedDefinition {
  schemaVersion: number;
  sections: ResolvedSection[];
  notices: MergeNotice[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const CUSTOM_FIELD_PREFIX = "custom.";

export function customFieldKey(sectionKey: string, id: string): string {
  return `${CUSTOM_FIELD_PREFIX}${sectionKey}.${id}`;
}

export function isCustomFieldKey(systemKey: string, sectionKey?: string): boolean {
  if (sectionKey !== undefined) {
    return systemKey.startsWith(`${CUSTOM_FIELD_PREFIX}${sectionKey}.`);
  }
  return systemKey.startsWith(CUSTOM_FIELD_PREFIX);
}

/** All fields of a section in group order, then field order. */
export function sectionFields(section: PackSection): FieldDefinition[];
export function sectionFields(section: ResolvedSection): ResolvedField[];
export function sectionFields(section: PackSection | ResolvedSection): FieldDefinition[] {
  return [...section.groups]
    .sort((left, right) => left.order - right.order)
    .flatMap((group) => [...group.fields].sort((left, right) => left.order - right.order));
}

export function findSectionField(
  section: PackSection,
  systemKey: string,
): FieldDefinition | undefined {
  for (const group of section.groups) {
    const match = group.fields.find((field) => field.systemKey === systemKey);
    if (match) {
      return match;
    }
  }
  return undefined;
}

/**
 * Evaluate a declarative visibility condition against a record's values.
 * Absent condition means always visible. Dangling references are resolved
 * to always-visible by the merge step before this is ever consulted, but
 * this evaluator itself only ever compares strings — nothing executes.
 */
export function isConditionSatisfied(
  condition: VisibleWhen | undefined,
  values: Record<string, string>,
): boolean {
  if (!condition) {
    return true;
  }
  const actual = values[condition.field] ?? "";
  if ("equals" in condition) {
    return actual === condition.equals;
  }
  return condition.oneOf.includes(actual);
}
