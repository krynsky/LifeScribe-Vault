/**
 * Pure composition: base FormPack + selected module options -> composed FormPack.
 *
 * Deterministic and idempotent — output depends only on (base, modules,
 * selections). Modules apply in ascending `order`; within an option, removals
 * happen before additions, then touched groups are renumbered to sequential
 * integers. The caller is responsible for running the result through
 * validatePack before rendering (never silent acceptance).
 *
 * No React, no IPC — plain data only.
 */

import type {
  FieldGroup,
  FormModule,
  FormModuleOption,
  FormPack,
  ModuleAddField,
} from "./formModel";

function selectedOption(
  module: FormModule,
  selections: Record<string, string>,
): FormModuleOption | undefined {
  const optionId = selections[module.moduleId] ?? module.defaultOptionId;
  return (
    module.options.find((option) => option.optionId === optionId) ??
    // Deliberate fallback: a stale/unknown optionId (e.g. from an older pack
    // version) resolves to the module's default rather than throwing.
    module.options.find((option) => option.optionId === module.defaultOptionId)
  );
}

function removeFields(pack: FormPack, keys: Set<string>, touched: Set<FieldGroup>): void {
  if (keys.size === 0) return;
  for (const section of pack.sections) {
    for (const group of section.groups) {
      const before = group.fields.length;
      group.fields = group.fields.filter((field) => !keys.has(field.systemKey));
      if (group.fields.length !== before) {
        touched.add(group);
      }
    }
  }
}

function addField(pack: FormPack, add: ModuleAddField, touched: Set<FieldGroup>): void {
  const section = pack.sections.find((candidate) => candidate.sectionKey === add.sectionKey);
  if (!section) {
    throw new Error(`module addField references unknown section "${add.sectionKey}"`);
  }
  const group = section.groups.find((candidate) => candidate.groupKey === add.groupKey);
  if (!group) {
    throw new Error(`module addField references unknown group "${add.sectionKey}/${add.groupKey}"`);
  }
  group.fields.push({ ...add.field, order: add.order - 0.5 });
  touched.add(group);
}

function renumber(touched: Set<FieldGroup>): void {
  for (const group of touched) {
    group.fields.sort((left, right) => left.order - right.order);
    group.fields.forEach((field, index) => {
      field.order = index + 1;
    });
  }
}

function applyKitAdditions(pack: FormPack, kitAdditions: Record<string, string[]>): void {
  for (const [sectionKey, keys] of Object.entries(kitAdditions)) {
    const section = pack.sections.find((candidate) => candidate.sectionKey === sectionKey);
    if (!section) {
      throw new Error(`module kitAdditions references unknown section "${sectionKey}"`);
    }
    // Optional chaining here is a deliberate runtime guard against malformed
    // pack data — the FormPack types declare kitMapping/entries as required.
    const entry = section.kitMapping?.entries?.[0];
    if (!entry) {
      throw new Error(`section "${sectionKey}" has no kitMapping entry to extend`);
    }
    for (const key of keys) {
      if (!entry.fields.includes(key)) {
        entry.fields.push(key);
      }
    }
  }
}

export function composePack(
  base: FormPack,
  modules: FormModule[],
  selections: Record<string, string>,
): FormPack {
  const pack = structuredClone(base);
  const ordered = [...modules].sort((left, right) => left.order - right.order);
  for (const module of ordered) {
    const option = selectedOption(module, selections);
    if (!option) continue;
    const touched = new Set<FieldGroup>();
    removeFields(pack, new Set(option.removeKeys ?? []), touched);
    for (const add of option.addFields ?? []) {
      addField(pack, add, touched);
    }
    renumber(touched);
    applyKitAdditions(pack, option.kitAdditions ?? {});
  }
  return pack;
}
