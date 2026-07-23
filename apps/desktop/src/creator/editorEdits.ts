/**
 * editorEdits — route a pack-editor edit to the correct layer. A base-target
 * edit changes pack.sections directly; a module-target edit changes that
 * option's add/remove arrays. Pure and immutable.
 */

import type { FieldDefinition, FormModuleOption, FormPack } from "../domain/formModel";
import { updateGroup } from "./packEdits";

export type EditTarget = { kind: "base" } | { kind: "module"; moduleId: string; optionId: string };

/** Immutably update one module option by (moduleId, optionId). */
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
    return updateGroup(pack, sectionKey, groupKey, (group) => ({
      ...group,
      fields: group.fields.filter((field) => field.systemKey !== systemKey),
    }));
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => {
    const removeKeys = option.removeKeys ?? [];
    return removeKeys.includes(systemKey)
      ? option
      : { ...option, removeKeys: [...removeKeys, systemKey] };
  });
}
