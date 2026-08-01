/**
 * Default pack + user overlay -> resolved definition.
 *
 * Precedence (plan: Key Technical Decisions):
 * - The pack wins structure: sections, groups, field types, required /
 *   protected flags, conditionals, readiness rules, kit mappings.
 * - The overlay wins labels, order, and contributes custom fields.
 * - systemKey collisions (a new default key matching a user custom key)
 *   rename the custom field deterministically and produce a notice; the
 *   accompanying KeyRename lets the caller re-key stored values.
 * - Saved select values absent from the new option list are flagged as
 *   read-only "previous answers" on the resolved field.
 * - Overlay hide flags are invalidated (with a notice) on any field the
 *   incoming pack marks protected, required, or readiness-gating — a hidden
 *   required field would make a section permanently unready invisibly.
 *
 * Conflicts never silently drop anything: every adjustment emits a notice
 * and the normalized overlay returned reflects what actually applied.
 */

import {
  type CustomFieldDefinition,
  type FormPack,
  type MergeNotice,
  type PackSection,
  type ResolvedDefinition,
  type ResolvedField,
  type ResolvedGroup,
  type ResolvedSection,
  type SectionOverlay,
  type UserOverlay,
  type VisibleWhen,
  isCustomFieldKey,
} from "./formModel";
import type { KeyRename, VaultValues } from "./valuesStore";

export interface MergeResult {
  resolved: ResolvedDefinition;
  notices: MergeNotice[];
  /** The overlay as it actually applied (renamed keys, invalidated hides). */
  overlay: UserOverlay;
  /** Custom-field renames the caller must apply to stored values. */
  keyRenames: KeyRename[];
}

const EMPTY_OVERLAY: UserOverlay = { sections: [] };

function uniqueCustomKey(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) {
    return desired;
  }
  let candidate = `${desired}.user`;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${desired}.user${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function resolveCustomFields(
  section: PackSection,
  overlay: SectionOverlay,
  packKeys: ReadonlySet<string>,
  notices: MergeNotice[],
  keyRenames: KeyRename[],
): { fieldsByGroup: Map<string, ResolvedField[]>; normalizedCustomFields: CustomFieldDefinition[] } {
  const fieldsByGroup = new Map<string, ResolvedField[]>();
  const normalizedCustomFields: CustomFieldDefinition[] = [];
  const takenKeys = new Set<string>(packKeys);
  const fallbackGroupKey = section.groups[0]?.groupKey ?? "";

  for (const customField of overlay.customFields ?? []) {
    let systemKey = customField.systemKey;

    if (!isCustomFieldKey(systemKey, section.sectionKey)) {
      // Never executes or drops a malformed key — relocate it into the
      // namespace deterministically and tell the user.
      const namespaced = `custom.${section.sectionKey}.${systemKey.replace(/^custom\./, "")}`;
      const relocated = uniqueCustomKey(namespaced, takenKeys);
      notices.push({
        kind: "custom-field-renamed",
        sectionKey: section.sectionKey,
        systemKey: relocated,
        message: `Your custom field "${customField.label}" was moved to the custom namespace (${systemKey} -> ${relocated}).`,
      });
      keyRenames.push({ sectionKey: section.sectionKey, from: systemKey, to: relocated });
      systemKey = relocated;
    } else if (takenKeys.has(systemKey)) {
      const renamed = uniqueCustomKey(systemKey, takenKeys);
      notices.push({
        kind: "custom-field-renamed",
        sectionKey: section.sectionKey,
        systemKey: renamed,
        message: `Your custom field "${customField.label}" was renamed (${systemKey} -> ${renamed}) because an updated default field now uses its key. No data was lost.`,
      });
      keyRenames.push({ sectionKey: section.sectionKey, from: systemKey, to: renamed });
      systemKey = renamed;
    }

    takenKeys.add(systemKey);
    const groupKey = section.groups.some((group) => group.groupKey === customField.groupKey)
      ? customField.groupKey
      : fallbackGroupKey;

    const resolved: ResolvedField = {
      systemKey,
      label: customField.label,
      helperText: customField.helperText,
      type: customField.type,
      required: false,
      protected: false,
      options: customField.options?.map((option) => ({ ...option })),
      reference: customField.reference
        ? {
            ...customField.reference,
            displayFields: customField.reference.displayFields.map((part) => ({ ...part })),
          }
        : undefined,
      order: customField.order,
      source: "custom",
      hidden: false,
    };
    const bucket = fieldsByGroup.get(groupKey) ?? [];
    bucket.push(resolved);
    fieldsByGroup.set(groupKey, bucket);
    normalizedCustomFields.push({ ...customField, systemKey, groupKey });
  }

  return { fieldsByGroup, normalizedCustomFields };
}

function applyFieldOrder(fields: ResolvedField[], fieldOrder: string[] | undefined): ResolvedField[] {
  const sorted = [...fields].sort((left, right) => left.order - right.order);
  if (!fieldOrder || fieldOrder.length === 0) {
    return sorted.map((field, index) => ({ ...field, order: index + 1 }));
  }
  const position = new Map(fieldOrder.map((key, index) => [key, index]));
  const listed = sorted.filter((field) => position.has(field.systemKey));
  const unlisted = sorted.filter((field) => !position.has(field.systemKey));
  listed.sort(
    (left, right) => (position.get(left.systemKey) ?? 0) - (position.get(right.systemKey) ?? 0),
  );
  return [...listed, ...unlisted].map((field, index) => ({ ...field, order: index + 1 }));
}

function mergeSection(
  section: PackSection,
  overlay: SectionOverlay | undefined,
  values: VaultValues | undefined,
  notices: MergeNotice[],
  keyRenames: KeyRename[],
): { resolved: ResolvedSection; normalizedOverlay: SectionOverlay | null } {
  const packKeys = new Set(
    section.groups.flatMap((group) => group.fields.map((field) => field.systemKey)),
  );
  const readinessKeys = new Set(section.readinessRule.requiredKeys);

  const effectiveOverlay: SectionOverlay = overlay ?? { sectionKey: section.sectionKey };
  const { fieldsByGroup: customByGroup, normalizedCustomFields } = resolveCustomFields(
    section,
    effectiveOverlay,
    packKeys,
    notices,
    keyRenames,
  );

  // Hide flags: only optional, unprotected, non-readiness fields may hide.
  const validHiddenFields: string[] = [];
  const hiddenSet = new Set<string>();
  for (const hiddenKey of effectiveOverlay.hiddenFields ?? []) {
    const packField = section.groups
      .flatMap((group) => group.fields)
      .find((field) => field.systemKey === hiddenKey);
    if (!packField) {
      // Field no longer exists; the hide flag is moot but harmless — keep it
      // out of the normalized overlay without a notice (nothing is hidden).
      continue;
    }
    if (packField.protected || packField.required || readinessKeys.has(hiddenKey)) {
      notices.push({
        kind: "hide-flag-invalidated",
        sectionKey: section.sectionKey,
        systemKey: hiddenKey,
        message: `"${packField.label}" can no longer be hidden because the updated form marks it as ${
          packField.protected || readinessKeys.has(hiddenKey) ? "essential to this section's readiness" : "required"
        }. It is visible again.`,
      });
      continue;
    }
    validHiddenFields.push(hiddenKey);
    hiddenSet.add(hiddenKey);
  }

  const relabels = effectiveOverlay.relabels ?? {};
  const allFieldKeys = new Set<string>(packKeys);
  for (const bucket of customByGroup.values()) {
    for (const field of bucket) {
      allFieldKeys.add(field.systemKey);
    }
  }

  const resolveCondition = (
    condition: VisibleWhen | undefined,
    fieldLabel: string,
  ): VisibleWhen | undefined => {
    if (!condition) {
      return undefined;
    }
    if (!allFieldKeys.has(condition.field)) {
      // Fail open for data visibility: a dangling reference must never hide
      // user data behind a condition that can no longer be satisfied.
      notices.push({
        kind: "dangling-condition",
        sectionKey: section.sectionKey,
        systemKey: condition.field,
        message: `"${fieldLabel}" referenced a field that no longer exists for its visibility rule, so it is now always visible.`,
      });
      return undefined;
    }
    return "equals" in condition ? { ...condition } : { ...condition, oneOf: [...condition.oneOf] };
  };

  const sectionRecords = values?.[section.sectionKey]?.records ?? [];

  const groups: ResolvedGroup[] = [...section.groups]
    .sort((left, right) => left.order - right.order)
    .map((group, groupIndex) => {
      const packFields: ResolvedField[] = group.fields.map((field) => {
        const relabel = relabels[field.systemKey];
        const resolved: ResolvedField = {
          ...field,
          label: relabel?.label?.trim() ? relabel.label : field.label,
          helperText: relabel?.helperText !== undefined ? relabel.helperText : field.helperText,
          options: field.options?.map((option) => ({ ...option })),
          reference: field.reference
            ? {
                ...field.reference,
                displayFields: field.reference.displayFields.map((part) => ({ ...part })),
              }
            : undefined,
          visibleWhen: resolveCondition(field.visibleWhen, field.label),
          source: "pack",
          hidden: hiddenSet.has(field.systemKey),
        };

        if (resolved.type === "select") {
          const optionValues = new Set((resolved.options ?? []).map((option) => option.value));
          const previousAnswers = sectionRecords
            .filter((record) => {
              const value = record.values[field.systemKey];
              return (
                typeof value === "string" && value.length > 0 && !optionValues.has(value)
              );
            })
            .map((record) => ({ recordId: record.id, value: record.values[field.systemKey] }));
          if (previousAnswers.length > 0) {
            resolved.previousAnswers = previousAnswers;
            notices.push({
              kind: "previous-answer",
              sectionKey: section.sectionKey,
              systemKey: field.systemKey,
              message: `Your saved answer for "${resolved.label}" is no longer one of the listed choices. It is kept as a read-only previous answer.`,
            });
          }
        }
        return resolved;
      });

      const customFields = (customByGroup.get(group.groupKey) ?? []).map((field) => {
        const relabel = relabels[field.systemKey];
        return {
          ...field,
          label: relabel?.label?.trim() ? relabel.label : field.label,
          helperText: relabel?.helperText !== undefined ? relabel.helperText : field.helperText,
        };
      });

      return {
        groupKey: group.groupKey,
        title: group.title,
        repeatable: group.repeatable,
        minRecords: group.minRecords,
        order: groupIndex + 1,
        fields: applyFieldOrder([...packFields, ...customFields], effectiveOverlay.fieldOrder),
      };
    });

  const resolved: ResolvedSection = {
    sectionKey: section.sectionKey,
    title: section.title,
    lede: section.lede,
    multiRecord: section.multiRecord,
    order: section.order,
    groups,
    readinessRule: { requiredKeys: [...section.readinessRule.requiredKeys] },
    kitMapping: {
      entries: section.kitMapping.entries.map((entry) => ({
        heading: entry.heading,
        fields: [...entry.fields],
      })),
    },
  };

  const hasOverlayContent =
    Object.keys(relabels).length > 0 ||
    (effectiveOverlay.fieldOrder?.length ?? 0) > 0 ||
    normalizedCustomFields.length > 0 ||
    validHiddenFields.length > 0;

  const normalizedOverlay: SectionOverlay | null = hasOverlayContent
    ? {
        sectionKey: section.sectionKey,
        ...(Object.keys(relabels).length > 0 ? { relabels: { ...relabels } } : {}),
        ...(effectiveOverlay.fieldOrder?.length ? { fieldOrder: [...effectiveOverlay.fieldOrder] } : {}),
        ...(normalizedCustomFields.length > 0 ? { customFields: normalizedCustomFields } : {}),
        ...(validHiddenFields.length > 0 ? { hiddenFields: validHiddenFields } : {}),
      }
    : null;

  return { resolved, normalizedOverlay };
}

/**
 * Merge a validated default pack with the user's overlay (and, when stored
 * values are provided, flag previous answers). Returns the resolved
 * definition for the renderer, all notices, the normalized overlay, and the
 * key renames the caller must apply to stored values via
 * `applyKeyRenames` before reconciling.
 */
export function mergePackWithOverlay(
  pack: FormPack,
  overlay?: UserOverlay | null,
  values?: VaultValues,
): MergeResult {
  const notices: MergeNotice[] = [];
  const keyRenames: KeyRename[] = [];
  const effectiveOverlay = overlay ?? EMPTY_OVERLAY;

  const overlayBySection = new Map(
    effectiveOverlay.sections.map((section) => [section.sectionKey, section]),
  );

  const sections: ResolvedSection[] = [];
  const normalizedSections: SectionOverlay[] = [];

  for (const section of [...pack.sections].sort((left, right) => left.order - right.order)) {
    const { resolved, normalizedOverlay } = mergeSection(
      section,
      overlayBySection.get(section.sectionKey),
      values,
      notices,
      keyRenames,
    );
    sections.push(resolved);
    if (normalizedOverlay) {
      normalizedSections.push(normalizedOverlay);
    }
  }

  // Overlay entries for sections the pack no longer ships are retained
  // untouched — overlays survive default-pack upgrades, and the section may
  // return in a later pack.
  const packSectionKeys = new Set(pack.sections.map((section) => section.sectionKey));
  for (const overlaySection of effectiveOverlay.sections) {
    if (!packSectionKeys.has(overlaySection.sectionKey)) {
      normalizedSections.push(overlaySection);
    }
  }

  return {
    resolved: { schemaVersion: pack.schemaVersion, sections, notices },
    notices,
    overlay: { sections: normalizedSections },
    keyRenames,
  };
}
