/**
 * buildEditorView — a provenance-annotated view of the base pack overlaid with
 * a set of module options, for the pack editor's overlay Design view.
 *
 * Unlike composePack (which resolves to a runtime artifact and DROPS removed
 * items), this KEEPS removed sections/fields — flagged `removed: true` so the
 * editor can render them struck-through — and tags every section/field with the
 * layer it comes from (`base` or a specific module option). It never renumbers;
 * ordering is for display only.
 *
 * Notes:
 * - `kitAdditions` is intentionally NOT reflected here — this is a structural
 *   field/section view; kit membership affects the Recovery Kit, not layout.
 * - An `addFields` op whose target section/group isn't in the current view is
 *   skipped and recorded in `warnings` (its owning module may not be overlaid).
 * - Added fields sort by their raw `order`, so on an exact `order` tie the
 *   pre-existing field wins — this can differ from composePack's `order-0.5`
 *   tie-break (added field wins there); acceptable because this ordering is
 *   display-only.
 *
 * Pure — no React, no IPC.
 */

import type {
  FieldDefinition,
  FieldGroup,
  FormModuleOption,
  FormPack,
  PackSection,
} from "../domain/formModel";

export type ViewSource = { kind: "base" } | { kind: "module"; moduleId: string; optionId: string };

export interface EditorViewField extends FieldDefinition {
  source: ViewSource;
  removed: boolean;
}
export interface EditorViewGroup extends Omit<FieldGroup, "fields"> {
  fields: EditorViewField[];
}
export interface EditorViewSection extends Omit<PackSection, "groups"> {
  source: ViewSource;
  removed: boolean;
  groups: EditorViewGroup[];
}
export interface EditorView {
  sections: EditorViewSection[];
  warnings: string[];
}

const BASE: ViewSource = { kind: "base" };

function tagSection(section: PackSection, source: ViewSource): EditorViewSection {
  return {
    ...section,
    source,
    removed: false,
    groups: section.groups.map((group) => ({
      ...group,
      fields: group.fields.map((field) => ({ ...field, source, removed: false })),
    })),
  };
}

function findSection(view: EditorView, sectionKey: string): EditorViewSection | undefined {
  return view.sections.find((section) => section.sectionKey === sectionKey);
}

function markSectionRemoved(view: EditorView, sectionKey: string): void {
  const section = findSection(view, sectionKey);
  if (section) section.removed = true;
}

function markFieldRemoved(view: EditorView, key: string): void {
  for (const section of view.sections) {
    for (const group of section.groups) {
      const field = group.fields.find((candidate) => candidate.systemKey === key);
      if (field) field.removed = true;
    }
  }
}

function addField(
  view: EditorView,
  source: ViewSource,
  add: { sectionKey: string; groupKey: string; order: number; field: FieldDefinition },
): void {
  const section = findSection(view, add.sectionKey);
  const group = section?.groups.find((candidate) => candidate.groupKey === add.groupKey);
  if (!group) {
    view.warnings.push(
      `Field "${add.field.systemKey}" could not be placed: section/group "${add.sectionKey}/${add.groupKey}" is not in the current view (its owning module may not be overlaid).`,
    );
    return;
  }
  group.fields.push({ ...add.field, order: add.order, source, removed: false });
}

function applyOption(view: EditorView, source: ViewSource, option: FormModuleOption): void {
  for (const key of option.removeSectionKeys ?? []) markSectionRemoved(view, key);
  for (const add of option.addSections ?? []) {
    view.sections.push({ ...tagSection(add.section, source), order: add.order });
  }
  for (const key of option.removeKeys ?? []) markFieldRemoved(view, key);
  for (const add of option.addFields ?? []) addField(view, source, add);
}

export function buildEditorView(
  base: FormPack,
  viewSelections: Record<string, string | null>,
): EditorView {
  const view: EditorView = {
    sections: base.sections.map((section) => tagSection(section, BASE)),
    warnings: [],
  };
  const modules = [...(base.modules ?? [])].sort((left, right) => left.order - right.order);
  for (const module of modules) {
    const optionId = viewSelections[module.moduleId];
    if (!optionId) continue; // null / absent = not overlaid
    const option = module.options.find((candidate) => candidate.optionId === optionId);
    if (!option) continue;
    applyOption(view, { kind: "module", moduleId: module.moduleId, optionId }, option);
  }
  view.sections.sort((left, right) => left.order - right.order);
  for (const section of view.sections) {
    for (const group of section.groups) {
      group.fields.sort((left, right) => left.order - right.order);
    }
  }
  return view;
}
