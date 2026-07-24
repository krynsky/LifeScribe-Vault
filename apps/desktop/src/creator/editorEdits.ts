/**
 * editorEdits — route a pack-editor edit to the correct layer. A base-target
 * edit changes pack.sections directly; a module-target edit changes that
 * option's add/remove arrays. Pure and immutable.
 */

import type { FieldDefinition, FormModuleOption, FormPack, PackSection } from "../domain/formModel";
import { removeField, updateGroup, updateSection } from "./packEdits";

export type EditTarget = { kind: "base" } | { kind: "module"; moduleId: string; optionId: string };

/**
 * Immutably update one module option by (moduleId, optionId). No-op if the
 * moduleId/optionId isn't found — callers pass the editor's current active
 * target, which always exists; stricter handling (surfacing an error for a
 * stale/missing target) is deferred to the 3b-2 UI wiring.
 */
function updateOption(
  pack: FormPack,
  moduleId: string,
  optionId: string,
  updater: (option: FormModuleOption) => FormModuleOption,
): FormPack {
  return {
    ...pack,
    modules: (pack.modules ?? []).map((module) =>
      module.moduleId !== moduleId
        ? module
        : {
            ...module,
            options: module.options.map((option) =>
              option.optionId === optionId ? updater(option) : option,
            ),
          },
    ),
  };
}

export function addFieldToTarget(
  pack: FormPack,
  target: EditTarget,
  sectionKey: string,
  groupKey: string,
  field: FieldDefinition,
): FormPack {
  if (target.kind === "base") {
    return updateGroup(pack, sectionKey, groupKey, (group) => ({
      ...group,
      fields: [...group.fields, field],
    }));
  }
  // The ModuleAddField `order` is taken from the field's own `order`: a field's
  // order doubles as its desired placement slot in the base group (callers set
  // field.order to the intended position; composePack inserts at order - 0.5).
  return updateOption(pack, target.moduleId, target.optionId, (option) => ({
    ...option,
    addFields: [...(option.addFields ?? []), { sectionKey, groupKey, order: field.order, field }],
  }));
}

export function removeInTarget(
  pack: FormPack,
  target: EditTarget,
  sectionKey: string,
  groupKey: string,
  systemKey: string,
): FormPack {
  if (target.kind === "base") {
    // Delegate to removeField so a base removal keeps its guarantees: it rejects
    // protected fields and prunes the key from the section's kitMapping /
    // readinessRule (a hand-rolled filter would leave dangling references).
    return removeField(pack, sectionKey, groupKey, systemKey);
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => {
    const removeKeys = option.removeKeys ?? [];
    return removeKeys.includes(systemKey)
      ? option
      : { ...option, removeKeys: [...removeKeys, systemKey] };
  });
}

export function addSectionToTarget(pack: FormPack, target: EditTarget, section: PackSection): FormPack {
  if (target.kind === "base") {
    return { ...pack, sections: [...pack.sections, section] };
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => ({
    ...option,
    addSections: [...(option.addSections ?? []), { order: section.order, section }],
  }));
}

/**
 * Renames a section, routed to its owning layer. A base target renames the
 * base section directly; a module target renames that option's addSections
 * entry — a no-op (referential-equal option) if the option didn't add a
 * section by that key, which mirrors updateOption's existing not-found
 * behavior rather than throwing.
 */
export function renameSectionInTarget(
  pack: FormPack,
  target: EditTarget,
  sectionKey: string,
  title: string,
): FormPack {
  if (target.kind === "base") {
    return updateSection(pack, sectionKey, (s) => ({ ...s, title }));
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => ({
    ...option,
    addSections: (option.addSections ?? []).map((add) =>
      add.section.sectionKey === sectionKey ? { ...add, section: { ...add.section, title } } : add,
    ),
  }));
}

export function removeSectionInTarget(pack: FormPack, target: EditTarget, sectionKey: string): FormPack {
  if (target.kind === "base") {
    return { ...pack, sections: pack.sections.filter((section) => section.sectionKey !== sectionKey) };
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => {
    const keys = option.removeSectionKeys ?? [];
    return keys.includes(sectionKey) ? option : { ...option, removeSectionKeys: [...keys, sectionKey] };
  });
}
