/**
 * packEdits.ts — pure TypeScript pack-mutation helpers.
 *
 * All functions are immutable: they return new objects and never mutate inputs.
 * Untouched objects retain referential identity (only the modified path is spread).
 *
 * No React imports — these are plain data functions safe to use anywhere.
 */

import type {
  FieldDefinition,
  FieldGroup,
  FieldType,
  FormPack,
  PackSection,
} from "../domain/formModel";
import { isCustomFieldKey } from "../domain/formModel";

// ---------------------------------------------------------------------------
// Low-level immutable updaters
// ---------------------------------------------------------------------------

/** Immutably update one section by sectionKey; all others keep referential identity. */
export function updateSection(
  pack: FormPack,
  sectionKey: string,
  updater: (s: PackSection) => PackSection,
): FormPack {
  return {
    ...pack,
    sections: pack.sections.map((s) =>
      s.sectionKey === sectionKey ? updater(s) : s,
    ),
  };
}

/** Immutably update one group inside a section. */
export function updateGroup(
  pack: FormPack,
  sectionKey: string,
  groupKey: string,
  updater: (g: FieldGroup) => FieldGroup,
): FormPack {
  return updateSection(pack, sectionKey, (s) => ({
    ...s,
    groups: s.groups.map((g) =>
      g.groupKey === groupKey ? updater(g) : g,
    ),
  }));
}

/** Immutably update one field inside a group. */
export function updateField(
  pack: FormPack,
  sectionKey: string,
  groupKey: string,
  systemKey: string,
  updater: (f: FieldDefinition) => FieldDefinition,
): FormPack {
  return updateGroup(pack, sectionKey, groupKey, (g) => ({
    ...g,
    fields: g.fields.map((f) =>
      f.systemKey === systemKey ? updater(f) : f,
    ),
  }));
}

/** Returns the maximum `order` value in the array, or 0 if the array is empty. */
export function maxOrder(items: { order: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.order), 0);
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

function uniqueKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now()}_${rand}`;
}

// ---------------------------------------------------------------------------
// Add helpers
// ---------------------------------------------------------------------------

/** Appends a new empty section with a unique sectionKey. */
export function addSection(pack: FormPack, title = "New Section"): FormPack {
  const order = maxOrder(pack.sections) + 1;
  const existingKeys = new Set(pack.sections.map((s) => s.sectionKey));
  let sectionKey = uniqueKey("section");
  // Extremely unlikely collision guard.
  while (existingKeys.has(sectionKey)) {
    sectionKey = uniqueKey("section");
  }
  const newSection: PackSection = {
    sectionKey,
    title,
    lede: "",
    multiRecord: false,
    order,
    groups: [],
    readinessRule: { requiredKeys: [] },
    kitMapping: { entries: [] },
  };
  return { ...pack, sections: [...pack.sections, newSection] };
}

/** Appends a new empty non-repeatable group to the section with a unique groupKey. */
export function addGroup(
  pack: FormPack,
  sectionKey: string,
  title = "New Group",
): FormPack {
  const section = pack.sections.find((s) => s.sectionKey === sectionKey);
  if (!section) return pack;

  const order = maxOrder(section.groups) + 1;
  const existingKeys = new Set(section.groups.map((g) => g.groupKey));
  let groupKey = uniqueKey("group");
  while (existingKeys.has(groupKey)) {
    groupKey = uniqueKey("group");
  }
  const newGroup: FieldGroup = {
    groupKey,
    title,
    repeatable: false,
    order,
    fields: [],
  };
  return updateSection(pack, sectionKey, (s) => ({
    ...s,
    groups: [...s.groups, newGroup],
  }));
}

/**
 * Appends a new optional field to the group.
 * The generated systemKey is never in the `custom.*` namespace.
 */
export function addOptionalField(
  pack: FormPack,
  sectionKey: string,
  groupKey: string,
  type: FieldType = "text",
): FormPack {
  const section = pack.sections.find((s) => s.sectionKey === sectionKey);
  const group = section?.groups.find((g) => g.groupKey === groupKey);
  if (!group) return pack;

  const order = maxOrder(group.fields) + 1;
  let systemKey = uniqueKey("field");
  // Ensure key is never in the custom.* namespace (guard per spec).
  while (isCustomFieldKey(systemKey)) {
    systemKey = uniqueKey("field");
  }
  const newField: FieldDefinition = {
    systemKey,
    label: "New Field",
    type,
    required: false,
    protected: false,
    order,
  };
  return updateGroup(pack, sectionKey, groupKey, (g) => ({
    ...g,
    fields: [...g.fields, newField],
  }));
}

// ---------------------------------------------------------------------------
// Remove / reorder helpers
// ---------------------------------------------------------------------------

/**
 * Removes a field by systemKey.
 * - Throws if the field is `protected: true`.
 * - Returns the pack unchanged if the field is not found.
 */
export function removeField(
  pack: FormPack,
  sectionKey: string,
  groupKey: string,
  systemKey: string,
): FormPack {
  const section = pack.sections.find((s) => s.sectionKey === sectionKey);
  const group = section?.groups.find((g) => g.groupKey === groupKey);
  const field = group?.fields.find((f) => f.systemKey === systemKey);

  if (!field) return pack;

  if (field.protected) {
    throw new Error("Cannot remove a protected field");
  }

  return updateGroup(pack, sectionKey, groupKey, (g) => ({
    ...g,
    fields: g.fields.filter((f) => f.systemKey !== systemKey),
  }));
}

/**
 * Swaps the `order` of the target field with the adjacent field in the given
 * direction. Returns the pack unchanged if already at the boundary.
 */
export function moveField(
  pack: FormPack,
  sectionKey: string,
  groupKey: string,
  systemKey: string,
  direction: "up" | "down",
): FormPack {
  const section = pack.sections.find((s) => s.sectionKey === sectionKey);
  const group = section?.groups.find((g) => g.groupKey === groupKey);
  if (!group) return pack;

  // Sort by order to determine adjacency.
  const sorted = [...group.fields].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((f) => f.systemKey === systemKey);
  if (idx === -1) return pack;

  const adjacentIdx = direction === "up" ? idx - 1 : idx + 1;
  if (adjacentIdx < 0 || adjacentIdx >= sorted.length) return pack;

  const target = sorted[idx]!;
  const adjacent = sorted[adjacentIdx]!;
  const targetOrder = target.order;
  const adjacentOrder = adjacent.order;

  return updateGroup(pack, sectionKey, groupKey, (g) => ({
    ...g,
    fields: g.fields.map((f) => {
      if (f.systemKey === target.systemKey) return { ...f, order: adjacentOrder };
      if (f.systemKey === adjacent.systemKey) return { ...f, order: targetOrder };
      return f;
    }),
  }));
}
