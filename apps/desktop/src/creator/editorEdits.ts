/**
 * editorEdits — route a pack-editor edit to the correct layer. A base-target
 * edit changes pack.sections directly; a module-target edit changes that
 * option's add/remove arrays. Pure and immutable.
 */

import type { FieldDefinition, FormModule, FormModuleOption, FormPack, PackSection } from "../domain/formModel";
import { maxOrder, removeField, updateField, updateGroup, updateSection } from "./packEdits";

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
    // If this option added the field itself (via addFields), a removeKeys
    // entry would be dead: composePack/buildEditorView apply removeKeys
    // BEFORE addFields within the same option, so the remove would run
    // before the field exists and the add would still land it. Undo the
    // addition instead.
    const added = option.addFields ?? [];
    const ownIndex = added.findIndex((add) => add.field.systemKey === systemKey);
    if (ownIndex !== -1) {
      return { ...option, addFields: added.filter((_, i) => i !== ownIndex) };
    }
    const removeKeys = option.removeKeys ?? [];
    return removeKeys.includes(systemKey)
      ? option
      : { ...option, removeKeys: [...removeKeys, systemKey] };
  });
}

/**
 * Updates a field's properties, routed to its owning layer. A base target
 * updates the base field directly. A module target updates wherever that
 * option owns the field: either its own addFields entry, or a field inside a
 * whole section the option added via addSections. No-op (referential-equal
 * option) if the target's option doesn't own a field by that key — mirroring
 * updateSectionInTarget's not-found behavior rather than throwing.
 */
export function updateFieldInTarget(
  pack: FormPack,
  target: EditTarget,
  sectionKey: string,
  groupKey: string,
  systemKey: string,
  updated: FieldDefinition,
): FormPack {
  if (target.kind === "base") {
    return updateField(pack, sectionKey, groupKey, systemKey, () => updated);
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => {
    // (a) a field this option injected via addFields
    const addFields = option.addFields ?? [];
    const i = addFields.findIndex((a) => a.field.systemKey === systemKey);
    if (i !== -1) {
      const next = [...addFields];
      next[i] = { ...next[i]!, field: updated };
      return { ...option, addFields: next };
    }
    // (b) a field inside a whole section this option added
    const addSections = option.addSections ?? [];
    const s = addSections.findIndex((entry) => entry.section.sectionKey === sectionKey);
    if (s !== -1) {
      const entry = addSections[s]!;
      const next = [...addSections];
      next[s] = {
        ...entry,
        section: {
          ...entry.section,
          groups: entry.section.groups.map((g) =>
            g.groupKey !== groupKey
              ? g
              : { ...g, fields: g.fields.map((f) => (f.systemKey === systemKey ? updated : f)) },
          ),
        },
      };
      return { ...option, addSections: next };
    }
    return option; // not owned by this option — no-op
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
 * Updates a section, routed to its owning layer. A base target updates the
 * base section directly; a module target updates that option's addSections
 * entry — a no-op (referential-equal option) if the option didn't add a
 * section by that key, which mirrors updateOption's existing not-found
 * behavior rather than throwing. Used by both the section nav's inline rename
 * and the section property panel (title/lede/multiRecord).
 */
export function updateSectionInTarget(
  pack: FormPack,
  target: EditTarget,
  sectionKey: string,
  updater: (s: PackSection) => PackSection,
): FormPack {
  if (target.kind === "base") {
    return updateSection(pack, sectionKey, updater);
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => ({
    ...option,
    addSections: (option.addSections ?? []).map((add) =>
      add.section.sectionKey === sectionKey ? { ...add, section: updater(add.section) } : add,
    ),
  }));
}

/** Renames a section, routed to its owning layer. See {@link updateSectionInTarget}. */
export function renameSectionInTarget(
  pack: FormPack,
  target: EditTarget,
  sectionKey: string,
  title: string,
): FormPack {
  return updateSectionInTarget(pack, target, sectionKey, (s) => ({ ...s, title }));
}

export function removeSectionInTarget(pack: FormPack, target: EditTarget, sectionKey: string): FormPack {
  if (target.kind === "base") {
    return { ...pack, sections: pack.sections.filter((section) => section.sectionKey !== sectionKey) };
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => {
    // Same reasoning as removeInTarget's field case: an option's own
    // addSections entry is applied AFTER removeSectionKeys within that
    // option, so recording a removeSectionKeys entry for a section this
    // option itself added would be silently ignored. Undo the addition.
    const added = option.addSections ?? [];
    const ownIndex = added.findIndex((add) => add.section.sectionKey === sectionKey);
    if (ownIndex !== -1) {
      return { ...option, addSections: added.filter((_, i) => i !== ownIndex) };
    }
    const keys = option.removeSectionKeys ?? [];
    return keys.includes(sectionKey) ? option : { ...option, removeSectionKeys: [...keys, sectionKey] };
  });
}

// ---------------------------------------------------------------------------
// Module authoring — creating and editing onboarding modules themselves
// (distinct from the field/section edits above, which are ROUTED BY a
// module's active option). Pure and immutable, mirroring the helpers above.
// ---------------------------------------------------------------------------

function uniqueModuleId(pack: FormPack): string {
  const existing = new Set((pack.modules ?? []).map((m) => m.moduleId));
  let id: string;
  do {
    id = `module_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  } while (existing.has(id));
  return id;
}

function uniqueOptionId(module: FormModule): string {
  const existing = new Set(module.options.map((o) => o.optionId));
  let n = existing.size + 1;
  let id = `option_${n}`;
  while (existing.has(id)) {
    n += 1;
    id = `option_${n}`;
  }
  return id;
}

function updateModuleById(
  pack: FormPack,
  moduleId: string,
  updater: (m: FormModule) => FormModule,
): FormPack {
  return {
    ...pack,
    modules: (pack.modules ?? []).map((m) => (m.moduleId === moduleId ? updater(m) : m)),
  };
}

/**
 * Appends a new module, valid by construction per validateModules: a unique
 * moduleId, an order past the current max, exactly two options ("off"/"on"),
 * and a defaultOptionId naming one of them.
 */
export function addModule(pack: FormPack): FormPack {
  const modules = pack.modules ?? [];
  const newModule: FormModule = {
    moduleId: uniqueModuleId(pack),
    title: "New Module",
    question: "New question?",
    order: maxOrder(modules) + 1,
    defaultOptionId: "off",
    options: [
      { optionId: "off", label: "No" },
      { optionId: "on", label: "Yes" },
    ],
  };
  return { ...pack, modules: [...modules, newModule] };
}

/** Patches a module's title/question/helperText. No-op if moduleId isn't found. */
export function updateModuleDetails(
  pack: FormPack,
  moduleId: string,
  patch: Partial<Pick<FormModule, "title" | "question" | "helperText">>,
): FormPack {
  return updateModuleById(pack, moduleId, (m) => ({ ...m, ...patch }));
}

/** Renames one option's label. No-op if moduleId/optionId isn't found. */
export function updateModuleOptionLabel(
  pack: FormPack,
  moduleId: string,
  optionId: string,
  label: string,
): FormPack {
  return updateModuleById(pack, moduleId, (m) => ({
    ...m,
    options: m.options.map((o) => (o.optionId === optionId ? { ...o, label } : o)),
  }));
}

/**
 * Sets which option is the module's default. No-op if optionId isn't one of
 * the module's current options — never points defaultOptionId at a dangling id.
 */
export function setModuleDefaultOption(pack: FormPack, moduleId: string, optionId: string): FormPack {
  return updateModuleById(pack, moduleId, (m) =>
    m.options.some((o) => o.optionId === optionId) ? { ...m, defaultOptionId: optionId } : m,
  );
}

/** Appends a new option to a module with a unique optionId. */
export function addModuleOption(pack: FormPack, moduleId: string): FormPack {
  return updateModuleById(pack, moduleId, (m) => ({
    ...m,
    options: [...m.options, { optionId: uniqueOptionId(m), label: "New option" }],
  }));
}

/**
 * Removes an option from a module, gated so the pack can never become invalid
 * (validateModules requires >= 2 options and a defaultOptionId naming one of
 * them):
 * - No-op if the module has only two options (removing would drop below two)
 *   or if optionId isn't one of the module's options.
 * - If the removed option was the default, the default auto-corrects to the
 *   first remaining option — never left dangling.
 */
export function removeModuleOption(pack: FormPack, moduleId: string, optionId: string): FormPack {
  return updateModuleById(pack, moduleId, (m) => {
    if (m.options.length <= 2) return m;
    if (!m.options.some((o) => o.optionId === optionId)) return m;
    const remaining = m.options.filter((o) => o.optionId !== optionId);
    const defaultOptionId = m.defaultOptionId === optionId ? remaining[0]!.optionId : m.defaultOptionId;
    return { ...m, options: remaining, defaultOptionId };
  });
}
