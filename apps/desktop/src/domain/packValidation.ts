/**
 * Pack validation — default packs are UNTRUSTED INPUT.
 *
 * Bundled resources, dev hot-reload files, and creator exports all pass
 * through here before anything renders. Validation failures produce specific
 * errors and the loader falls back to the last-good pack — never silent
 * acceptance, never partial loads.
 */

import {
  FIELD_TYPES,
  RECORD_REFERENCE_FORMATS,
  type FieldDefinition,
  type FormPack,
  type MigrationOperation,
  isCustomFieldKey,
} from "./formModel";
import { isValidSemver } from "./semver";

export type PackValidationResult =
  | { ok: true; pack: FormPack; errors: [] }
  | { ok: false; pack: null; errors: string[] };

export interface UpgradeValidationResult {
  /** Hard violations: the new pack must be rejected. */
  errors: string[];
  /**
   * Lossy-but-survivable changes (merge archives the displaced values).
   * Creator export (U10) treats these as blocking via `strict`.
   */
  warnings: string[];
}

export interface LoadPackOptions {
  /** Highest schemaVersion this app's migration range can read. */
  maxSupportedSchemaVersion: number;
  /** Pack to fall back to when the incoming pack is rejected. */
  lastGoodPack?: FormPack | null;
  /** When provided, upgrade rules are checked against this previous pack. */
  previousPack?: FormPack | null;
}

export interface LoadPackResult {
  pack: FormPack | null;
  usedFallback: boolean;
  errors: string[];
  warnings: string[];
}

const FIELD_TYPE_SET: ReadonlySet<string> = new Set(FIELD_TYPES);
const RECORD_REFERENCE_FORMAT_SET: ReadonlySet<string> = new Set(RECORD_REFERENCE_FORMATS);

/**
 * Credential systemKeys that may never reach the Recovery Kit. The Kit is a
 * PRINTABLE document meant for the user's family, and recoveryKit.ts emits the
 * raw value of every field a section's kitMapping names.
 *
 * This is the AUTHORING gate: it stops a leaky pack being written or exported.
 * It is not the last line of defence. Saved custom packs are validated during
 * normal loading, but the enforcement that always runs lives in
 * recoveryKit.ts, which drops these keys at the point of consumption. Keep
 * both: this one gives the author an error message, and that one guarantees the
 * printed page even if a future load path changes.
 */
export const KIT_EXCLUDED_SYSTEM_KEYS: readonly string[] = [
  "passwordManagerMasterPassword",
  "devicePin",
];

const KIT_EXCLUDED_SET: ReadonlySet<string> = new Set(KIT_EXCLUDED_SYSTEM_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function validateVisibleWhen(
  candidate: unknown,
  fieldLabel: string,
  errors: string[],
): void {
  if (typeof candidate === "string") {
    errors.push(
      `Field ${fieldLabel}: visibleWhen must be a declarative condition object, not an expression string.`,
    );
    return;
  }
  if (!isRecord(candidate)) {
    errors.push(`Field ${fieldLabel}: visibleWhen must be a declarative condition object.`);
    return;
  }
  const keys = Object.keys(candidate).sort();
  const isEquals = keys.length === 2 && keys[0] === "equals" && keys[1] === "field";
  const isOneOf = keys.length === 2 && keys[0] === "field" && keys[1] === "oneOf";
  if (!isEquals && !isOneOf) {
    errors.push(
      `Field ${fieldLabel}: visibleWhen must contain exactly "field" and one of "equals" or "oneOf" — no other shapes are allowed.`,
    );
    return;
  }
  if (!isNonEmptyString(candidate.field)) {
    errors.push(`Field ${fieldLabel}: visibleWhen.field must be a non-empty string.`);
  }
  if (isEquals && typeof candidate.equals !== "string") {
    errors.push(`Field ${fieldLabel}: visibleWhen.equals must be a string.`);
  }
  if (isOneOf && !(isStringArray(candidate.oneOf) && candidate.oneOf.length > 0)) {
    errors.push(`Field ${fieldLabel}: visibleWhen.oneOf must be a non-empty string array.`);
  }
}

function validateRecordReference(
  candidate: unknown,
  fieldLabel: string,
  errors: string[],
): void {
  if (!isRecord(candidate)) {
    errors.push(`Field ${fieldLabel}: recordRef requires a reference object.`);
    return;
  }
  if (!isNonEmptyString(candidate.sectionKey)) {
    errors.push(`Field ${fieldLabel}: reference.sectionKey must be a non-empty string.`);
  }
  if (typeof candidate.separator !== "string") {
    errors.push(`Field ${fieldLabel}: reference.separator must be a string.`);
  }
  if (!Array.isArray(candidate.displayFields) || candidate.displayFields.length === 0) {
    errors.push(`Field ${fieldLabel}: reference.displayFields must be a non-empty array.`);
    return;
  }
  for (const displayField of candidate.displayFields) {
    if (!isRecord(displayField) || !isNonEmptyString(displayField.systemKey)) {
      errors.push(
        `Field ${fieldLabel}: every reference display field must name a systemKey.`,
      );
      continue;
    }
    if (
      displayField.format !== undefined &&
      (typeof displayField.format !== "string" ||
        !RECORD_REFERENCE_FORMAT_SET.has(displayField.format))
    ) {
      errors.push(
        `Field ${fieldLabel}: unsupported display format "${String(displayField.format)}".`,
      );
    }
  }
}

function validateField(
  candidate: unknown,
  sectionKey: string,
  errors: string[],
): void {
  if (!isRecord(candidate)) {
    errors.push(`Section ${sectionKey}: each field must be an object.`);
    return;
  }
  const label = isNonEmptyString(candidate.systemKey)
    ? (candidate.systemKey as string)
    : "(missing systemKey)";
  if (!isNonEmptyString(candidate.systemKey)) {
    errors.push(`Section ${sectionKey}: each field must have a non-empty systemKey.`);
  } else if (isCustomFieldKey(candidate.systemKey)) {
    errors.push(
      `Section ${sectionKey}: default packs may not contain custom-namespace field ${candidate.systemKey}.`,
    );
  }
  if (!isNonEmptyString(candidate.label)) {
    errors.push(`Section ${sectionKey}: field ${label} must have a non-empty label.`);
  }
  if (candidate.helperText !== undefined && typeof candidate.helperText !== "string") {
    errors.push(`Section ${sectionKey}: field ${label} helperText must be a string.`);
  }
  if (typeof candidate.type !== "string" || !FIELD_TYPE_SET.has(candidate.type)) {
    errors.push(
      `Section ${sectionKey}: field ${label} has unsupported type "${String(candidate.type)}" — allowed types are ${FIELD_TYPES.join(", ")}.`,
    );
  }
  if (typeof candidate.required !== "boolean") {
    errors.push(`Section ${sectionKey}: field ${label} must declare required as a boolean.`);
  }
  if (typeof candidate.protected !== "boolean") {
    errors.push(`Section ${sectionKey}: field ${label} must declare protected as a boolean.`);
  }
  if (candidate.protected === true && candidate.required !== true) {
    errors.push(`Section ${sectionKey}: protected field ${label} must also be required.`);
  }
  if (typeof candidate.order !== "number") {
    errors.push(`Section ${sectionKey}: field ${label} must have a numeric order.`);
  }
  if (candidate.type === "select") {
    const options = candidate.options;
    const validOptions =
      Array.isArray(options) &&
      options.length > 0 &&
      options.every(
        (option) =>
          isRecord(option) && isNonEmptyString(option.value) && isNonEmptyString(option.label),
      );
    if (!validOptions) {
      errors.push(
        `Section ${sectionKey}: select field ${label} must include at least one option with value and label.`,
      );
    }
  }
  if (candidate.type === "recordRef") {
    validateRecordReference(candidate.reference, `${sectionKey}.${label}`, errors);
    if (candidate.options !== undefined) {
      errors.push(`Section ${sectionKey}: recordRef field ${label} must not declare options.`);
    }
  } else if (candidate.reference !== undefined) {
    errors.push(
      `Section ${sectionKey}: only recordRef field ${label} may declare a reference.`,
    );
  }
  if ((candidate.type === "file" || candidate.type === "path") && candidate.options !== undefined) {
    errors.push(
      `Section ${sectionKey}: ${candidate.type} field ${label} must not declare options.`,
    );
  }
  if (candidate.visibleWhen !== undefined) {
    validateVisibleWhen(candidate.visibleWhen, `${sectionKey}.${label}`, errors);
  }
}

function validateRecordReferenceTargets(sections: unknown[], errors: string[]): void {
  const sectionIndex = new Map<string, Record<string, unknown>>();
  for (const section of sections) {
    if (isRecord(section) && isNonEmptyString(section.sectionKey)) {
      sectionIndex.set(section.sectionKey, section);
    }
  }

  const fieldIndex = (section: Record<string, unknown>): Map<string, Record<string, unknown>> => {
    const fields = new Map<string, Record<string, unknown>>();
    if (!Array.isArray(section.groups)) return fields;
    for (const group of section.groups) {
      if (!isRecord(group) || !Array.isArray(group.fields)) continue;
      for (const field of group.fields) {
        if (isRecord(field) && isNonEmptyString(field.systemKey)) {
          fields.set(field.systemKey, field);
        }
      }
    }
    return fields;
  };

  for (const [sectionKey, section] of sectionIndex) {
    for (const field of fieldIndex(section).values()) {
      if (field.type !== "recordRef" || !isRecord(field.reference)) continue;
      const fieldKey = isNonEmptyString(field.systemKey) ? field.systemKey : "(missing systemKey)";
      const sourceKey = field.reference.sectionKey;
      if (!isNonEmptyString(sourceKey)) continue;
      if (sourceKey === sectionKey) {
        errors.push(
          `Section ${sectionKey}: recordRef field ${fieldKey} may not reference its own section.`,
        );
        continue;
      }
      const sourceSection = sectionIndex.get(sourceKey);
      if (!sourceSection) {
        errors.push(
          `Section ${sectionKey}: recordRef field ${fieldKey} references unknown section ${sourceKey}.`,
        );
        continue;
      }
      const sourceFields = fieldIndex(sourceSection);
      if (!Array.isArray(field.reference.displayFields)) continue;
      for (const displayField of field.reference.displayFields) {
        if (!isRecord(displayField) || !isNonEmptyString(displayField.systemKey)) continue;
        if (KIT_EXCLUDED_SET.has(displayField.systemKey)) {
          // A reference label reaches the printed Recovery Kit via
          // recoveryKit.ts's recordRef branch — a second route into record
          // values that the kitMapping filter does not cover. recordReferences.ts
          // drops these regardless; this is the authoring-time error message.
          errors.push(
            `Section ${sectionKey}: recordRef field ${fieldKey} may not display credential field ${displayField.systemKey} — reference labels reach the Recovery Kit.`,
          );
          continue;
        }
        const sourceField = sourceFields.get(displayField.systemKey);
        if (!sourceField) {
          errors.push(
            `Section ${sectionKey}: recordRef field ${fieldKey} references unknown display field ${sourceKey}.${displayField.systemKey}.`,
          );
        } else if (sourceField.type === "recordRef") {
          errors.push(
            `Section ${sectionKey}: recordRef field ${fieldKey} may not use recordRef display field ${sourceKey}.${displayField.systemKey}.`,
          );
        }
      }
    }
  }
}

function validateSection(candidate: unknown, errors: string[]): void {
  if (!isRecord(candidate)) {
    errors.push("Each section must be an object.");
    return;
  }
  const sectionKey = isNonEmptyString(candidate.sectionKey)
    ? (candidate.sectionKey as string)
    : "(missing sectionKey)";
  if (!isNonEmptyString(candidate.sectionKey)) {
    errors.push("Each section must have a non-empty sectionKey.");
  }
  if (!isNonEmptyString(candidate.title)) {
    errors.push(`Section ${sectionKey} must have a non-empty title.`);
  }
  if (typeof candidate.lede !== "string") {
    errors.push(`Section ${sectionKey} must have a lede string.`);
  }
  if (typeof candidate.multiRecord !== "boolean") {
    errors.push(`Section ${sectionKey} must declare multiRecord as a boolean.`);
  }
  if (typeof candidate.order !== "number") {
    errors.push(`Section ${sectionKey} must have a numeric order.`);
  }

  const fieldIndex = new Map<string, { protected: boolean }>();
  if (!Array.isArray(candidate.groups) || candidate.groups.length === 0) {
    errors.push(`Section ${sectionKey} must contain at least one group.`);
  } else {
    const groupKeys = new Set<string>();
    for (const group of candidate.groups) {
      if (!isRecord(group)) {
        errors.push(`Section ${sectionKey}: each group must be an object.`);
        continue;
      }
      const groupKey = isNonEmptyString(group.groupKey)
        ? (group.groupKey as string)
        : "(missing groupKey)";
      if (!isNonEmptyString(group.groupKey)) {
        errors.push(`Section ${sectionKey}: each group must have a non-empty groupKey.`);
      } else if (groupKeys.has(group.groupKey)) {
        errors.push(`Section ${sectionKey}: duplicate groupKey ${group.groupKey}.`);
      } else {
        groupKeys.add(group.groupKey);
      }
      if (!isNonEmptyString(group.title)) {
        errors.push(`Section ${sectionKey}: group ${groupKey} must have a non-empty title.`);
      }
      if (typeof group.repeatable !== "boolean") {
        errors.push(`Section ${sectionKey}: group ${groupKey} must declare repeatable as a boolean.`);
      }
      if (
        group.minRecords !== undefined &&
        !(typeof group.minRecords === "number" && Number.isInteger(group.minRecords) && group.minRecords >= 0)
      ) {
        errors.push(`Section ${sectionKey}: group ${groupKey} minRecords must be a non-negative integer.`);
      }
      if (typeof group.order !== "number") {
        errors.push(`Section ${sectionKey}: group ${groupKey} must have a numeric order.`);
      }
      if (!Array.isArray(group.fields) || group.fields.length === 0) {
        errors.push(`Section ${sectionKey}: group ${groupKey} must contain at least one field.`);
        continue;
      }
      for (const field of group.fields) {
        validateField(field, sectionKey, errors);
        if (isRecord(field) && isNonEmptyString(field.systemKey)) {
          if (fieldIndex.has(field.systemKey)) {
            errors.push(`Section ${sectionKey}: duplicate field systemKey ${field.systemKey}.`);
          }
          fieldIndex.set(field.systemKey, { protected: field.protected === true });
        }
      }
    }
  }

  if (!isRecord(candidate.readinessRule) || !isStringArray(candidate.readinessRule.requiredKeys)) {
    errors.push(`Section ${sectionKey} must declare readinessRule.requiredKeys as a string array.`);
  } else {
    for (const key of candidate.readinessRule.requiredKeys) {
      const entry = fieldIndex.get(key);
      if (!entry) {
        errors.push(`Section ${sectionKey}: readiness rule references unknown field ${key}.`);
      } else if (!entry.protected) {
        errors.push(
          `Section ${sectionKey}: readiness rule may only reference protected fields, but ${key} is not protected.`,
        );
      }
    }
  }

  if (candidate.recordLabel !== undefined) {
    if (
      !isRecord(candidate.recordLabel) ||
      !isStringArray(candidate.recordLabel.fields) ||
      candidate.recordLabel.fields.length === 0 ||
      typeof candidate.recordLabel.separator !== "string"
    ) {
      errors.push(
        `Section ${sectionKey}: recordLabel must declare a non-empty fields string array and a separator string.`,
      );
    } else {
      for (const key of candidate.recordLabel.fields) {
        if (!fieldIndex.has(key)) {
          errors.push(`Section ${sectionKey}: record label references unknown field ${key}.`);
        }
        if (KIT_EXCLUDED_SET.has(key)) {
          errors.push(
            `Section ${sectionKey}: record label may not include credential field ${key}.`,
          );
        }
      }
    }
  }

  if (!isRecord(candidate.kitMapping) || !Array.isArray(candidate.kitMapping.entries)) {
    errors.push(`Section ${sectionKey} must declare kitMapping.entries as an array.`);
  } else {
    for (const entry of candidate.kitMapping.entries) {
      if (!isRecord(entry) || !isNonEmptyString(entry.heading) || !isStringArray(entry.fields)) {
        errors.push(
          `Section ${sectionKey}: each kit mapping entry must have a heading and a fields string array.`,
        );
        continue;
      }
      for (const key of entry.fields) {
        if (!fieldIndex.has(key)) {
          errors.push(`Section ${sectionKey}: kit mapping references unknown field ${key}.`);
        }
        if (KIT_EXCLUDED_SET.has(key)) {
          errors.push(
            `Section ${sectionKey}: kit mapping may not include credential field ${key} — the Recovery Kit is a printable document.`,
          );
        }
      }
    }
  }
}

function validateMigrationOperation(candidate: unknown, stepLabel: string, errors: string[]): void {
  if (!isRecord(candidate) || typeof candidate.op !== "string") {
    errors.push(`Migration ${stepLabel}: each operation must be an object with an "op" kind.`);
    return;
  }
  switch (candidate.op) {
    case "renameField":
      if (
        !isNonEmptyString(candidate.sectionKey) ||
        !isNonEmptyString(candidate.fromKey) ||
        !isNonEmptyString(candidate.toKey)
      ) {
        errors.push(`Migration ${stepLabel}: renameField requires sectionKey, fromKey and toKey.`);
      }
      break;
    case "mapValue":
      if (
        !isNonEmptyString(candidate.sectionKey) ||
        !isNonEmptyString(candidate.systemKey) ||
        !isStringRecord(candidate.mapping)
      ) {
        errors.push(`Migration ${stepLabel}: mapValue requires sectionKey, systemKey and a string mapping.`);
      }
      break;
    case "retypeField":
      if (
        !isNonEmptyString(candidate.sectionKey) ||
        !isNonEmptyString(candidate.systemKey) ||
        typeof candidate.toType !== "string" ||
        !FIELD_TYPE_SET.has(candidate.toType) ||
        (candidate.valueMap !== undefined && !isStringRecord(candidate.valueMap))
      ) {
        errors.push(`Migration ${stepLabel}: retypeField requires sectionKey, systemKey and a valid toType.`);
      }
      break;
    case "reduceCardinality":
      if (
        !isNonEmptyString(candidate.sectionKey) ||
        (candidate.groupKey !== undefined && !isNonEmptyString(candidate.groupKey))
      ) {
        errors.push(`Migration ${stepLabel}: reduceCardinality requires sectionKey.`);
      }
      break;
    case "archiveField":
      if (!isNonEmptyString(candidate.sectionKey) || !isNonEmptyString(candidate.systemKey)) {
        errors.push(`Migration ${stepLabel}: archiveField requires sectionKey and systemKey.`);
      }
      break;
    default:
      errors.push(
        `Migration ${stepLabel}: unknown operation "${candidate.op}" — migrations are declarative data, not scripts.`,
      );
  }
}

/** Structural validation of an untrusted pack candidate. */
export function validatePack(candidate: unknown): PackValidationResult {
  const errors: string[] = [];

  if (!isRecord(candidate)) {
    return { ok: false, pack: null, errors: ["Pack must be a JSON object."] };
  }
  if (!isNonEmptyString(candidate.packId)) {
    errors.push("Pack must have a non-empty packId.");
  }
  if (!isNonEmptyString(candidate.packVersion)) {
    errors.push("Pack must have a non-empty packVersion.");
  } else if (!isValidSemver(candidate.packVersion)) {
    errors.push("Pack packVersion must be a valid semantic version.");
  }
  if (!isPositiveInteger(candidate.schemaVersion)) {
    errors.push("Pack schemaVersion must be a positive integer.");
  }
  if (!isNonEmptyString(candidate.minAppVersion)) {
    errors.push("Pack must have a non-empty minAppVersion.");
  } else if (!isValidSemver(candidate.minAppVersion)) {
    errors.push("Pack minAppVersion must be a valid semantic version.");
  }

  if (!Array.isArray(candidate.sections) || candidate.sections.length === 0) {
    errors.push("Pack must contain at least one section.");
  } else {
    const sectionKeys = new Set<string>();
    for (const section of candidate.sections) {
      validateSection(section, errors);
      if (isRecord(section) && isNonEmptyString(section.sectionKey)) {
        if (sectionKeys.has(section.sectionKey)) {
          errors.push(`Duplicate sectionKey ${section.sectionKey}.`);
        }
        sectionKeys.add(section.sectionKey);
      }
    }
    validateRecordReferenceTargets(candidate.sections, errors);
  }

  if (!Array.isArray(candidate.migrations)) {
    errors.push("Pack must declare migrations as an array (empty is fine).");
  } else {
    for (const step of candidate.migrations) {
      if (!isRecord(step) || !isPositiveInteger(step.fromVersion)) {
        errors.push("Each migration step must declare a positive integer fromVersion.");
        continue;
      }
      const stepLabel = `v${step.fromVersion} -> v${step.fromVersion + 1}`;
      if (!Array.isArray(step.operations)) {
        errors.push(`Migration ${stepLabel}: operations must be an array.`);
        continue;
      }
      for (const operation of step.operations) {
        validateMigrationOperation(operation, stepLabel, errors);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, pack: null, errors };
  }
  return { ok: true, pack: candidate as unknown as FormPack, errors: [] };
}

interface FieldRecordInfo {
  field: FieldDefinition;
  groupKey: string;
  groupRepeatable: boolean;
}

function indexPackFields(pack: FormPack): Map<string, Map<string, FieldRecordInfo>> {
  const index = new Map<string, Map<string, FieldRecordInfo>>();
  for (const section of pack.sections) {
    const fields = new Map<string, FieldRecordInfo>();
    for (const group of section.groups) {
      for (const field of group.fields) {
        fields.set(field.systemKey, {
          field,
          groupKey: group.groupKey,
          groupRepeatable: group.repeatable,
        });
      }
    }
    index.set(section.sectionKey, fields);
  }
  return index;
}

function migrationOpsBetween(
  pack: FormPack,
  fromVersion: number,
  toVersion: number,
): MigrationOperation[] {
  return pack.migrations
    .filter((step) => step.fromVersion >= fromVersion && step.fromVersion < toVersion)
    .sort((left, right) => left.fromVersion - right.fromVersion)
    .flatMap((step) => step.operations);
}

/**
 * Upgrade rules between an installed pack and an incoming one.
 *
 * Errors (always rejected): protected fields deleted, retyped, or demoted;
 * schemaVersion going backwards.
 * Warnings (lossy but survivable — merge archives displaced values): any
 * existing key removed/renamed/retyped or cardinality reduced without an
 * authored migration operation. Pass `strict: true` (creator export) to
 * promote warnings to errors.
 */
export function validatePackUpgrade(
  previous: FormPack,
  next: FormPack,
  options?: { strict?: boolean },
): UpgradeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (next.schemaVersion < previous.schemaVersion) {
    errors.push(
      `Pack schemaVersion may not decrease (was ${previous.schemaVersion}, incoming ${next.schemaVersion}).`,
    );
  }

  const previousIndex = indexPackFields(previous);
  const nextIndex = indexPackFields(next);
  const ops = migrationOpsBetween(next, previous.schemaVersion, next.schemaVersion);

  const renamedTo = (sectionKey: string, fromKey: string): string | null => {
    let key = fromKey;
    let renamed = false;
    for (const op of ops) {
      if (op.op === "renameField" && op.sectionKey === sectionKey && op.fromKey === key) {
        key = op.toKey;
        renamed = true;
      }
    }
    return renamed ? key : null;
  };

  const hasRetypeOp = (sectionKey: string, systemKey: string): boolean =>
    ops.some(
      (op) => op.op === "retypeField" && op.sectionKey === sectionKey && op.systemKey === systemKey,
    );

  const hasArchiveOp = (sectionKey: string, systemKey: string): boolean =>
    ops.some(
      (op) => op.op === "archiveField" && op.sectionKey === sectionKey && op.systemKey === systemKey,
    );

  const hasReduceOp = (sectionKey: string, groupKey?: string): boolean =>
    ops.some(
      (op) =>
        op.op === "reduceCardinality" &&
        op.sectionKey === sectionKey &&
        (op.groupKey === undefined || op.groupKey === groupKey),
    );

  for (const [sectionKey, previousFields] of previousIndex) {
    const nextFields = nextIndex.get(sectionKey);
    for (const [systemKey, info] of previousFields) {
      const { field } = info;
      const target = nextFields?.get(systemKey);

      if (!target) {
        const renameTarget = renamedTo(sectionKey, systemKey);
        const renamedField = renameTarget ? nextFields?.get(renameTarget) : undefined;
        if (field.protected) {
          if (!renamedField) {
            errors.push(
              `Protected field ${sectionKey}.${systemKey} cannot be deleted; renames require an authored renameField migration to a field that still exists.`,
            );
          } else if (!renamedField.field.protected) {
            errors.push(
              `Protected field ${sectionKey}.${systemKey} was renamed to ${renameTarget} which must remain protected.`,
            );
          } else if (renamedField.field.type !== field.type) {
            errors.push(
              `Protected field ${sectionKey}.${systemKey} cannot change type (renamed to ${renameTarget} with type ${renamedField.field.type}).`,
            );
          }
        } else if (!renamedField && !hasArchiveOp(sectionKey, systemKey)) {
          warnings.push(
            `Field ${sectionKey}.${systemKey} was removed without an authored migration; existing values will become archived answers.`,
          );
        }
        continue;
      }

      if (field.protected && !target.field.protected) {
        errors.push(`Protected field ${sectionKey}.${systemKey} must remain protected.`);
      }
      if (target.field.type !== field.type) {
        if (field.protected) {
          errors.push(
            `Protected field ${sectionKey}.${systemKey} cannot change type from ${field.type} to ${target.field.type}.`,
          );
        } else if (!hasRetypeOp(sectionKey, systemKey)) {
          warnings.push(
            `Field ${sectionKey}.${systemKey} changed type from ${field.type} to ${target.field.type} without an authored migration; non-conforming values will be archived.`,
          );
        }
      }
      if (info.groupRepeatable && !target.groupRepeatable && !hasReduceOp(sectionKey, target.groupKey)) {
        warnings.push(
          `Group ${sectionKey}.${target.groupKey} is no longer repeatable without an authored migration; records beyond the first will become archived answers.`,
        );
      }
    }
  }

  const previousSections = new Map(previous.sections.map((section) => [section.sectionKey, section]));
  for (const section of next.sections) {
    const before = previousSections.get(section.sectionKey);
    if (before && before.multiRecord && !section.multiRecord && !hasReduceOp(section.sectionKey)) {
      warnings.push(
        `Section ${section.sectionKey} is no longer multi-record without an authored migration; records beyond the first will become archived answers.`,
      );
    }
  }

  if (options?.strict && warnings.length > 0) {
    return { errors: [...errors, ...warnings], warnings: [] };
  }
  return { errors, warnings };
}

/**
 * Parse + validate an untrusted raw pack JSON string. On any failure the
 * last-good pack is used (when available) and the specific errors are
 * surfaced — the failure is never silent and never partial.
 */
export function loadPack(rawJson: string, options: LoadPackOptions): LoadPackResult {
  const fallback = (errors: string[], warnings: string[] = []): LoadPackResult => ({
    pack: options.lastGoodPack ?? null,
    usedFallback: true,
    errors,
    warnings,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (parseError) {
    return fallback([
      `Pack JSON is malformed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
    ]);
  }

  const validation = validatePack(parsed);
  if (!validation.ok) {
    return fallback(validation.errors);
  }

  if (validation.pack.schemaVersion > options.maxSupportedSchemaVersion) {
    return fallback([
      `Pack schemaVersion ${validation.pack.schemaVersion} is newer than this app supports (max ${options.maxSupportedSchemaVersion}). Update the app to use this pack.`,
    ]);
  }

  if (options.previousPack) {
    const upgrade = validatePackUpgrade(options.previousPack, validation.pack);
    if (upgrade.errors.length > 0) {
      return fallback(upgrade.errors, upgrade.warnings);
    }
    return { pack: validation.pack, usedFallback: false, errors: [], warnings: upgrade.warnings };
  }

  return { pack: validation.pack, usedFallback: false, errors: [], warnings: [] };
}
