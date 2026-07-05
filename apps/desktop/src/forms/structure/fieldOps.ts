import { updateGroup } from "../../creator/packEdits";
import type { FieldGroup, FormPack } from "../../domain/formModel";
import { isCustomFieldKey } from "../../domain/formModel";

function renumbered(fields: FieldGroup["fields"]): FieldGroup["fields"] {
  return fields.map((field, index) => ({ ...field, order: index + 1 }));
}

function uniqueFieldKey(existing: Set<string>): string {
  let key: string;
  do {
    key = `field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  } while (existing.has(key) || isCustomFieldKey(key));
  return key;
}

/**
 * Move a field within a group from one display position to another, then
 * renumber `order` to sequential integers so the group stays internally
 * consistent (array order == order-value order) — which deriveOverlay requires.
 */
export function reorderFields(
  pack: FormPack,
  sectionKey: string,
  groupKey: string,
  fromIndex: number,
  toIndex: number,
): FormPack {
  return updateGroup(pack, sectionKey, groupKey, (group) => {
    const sorted = [...group.fields].sort((a, b) => a.order - b.order);
    if (fromIndex < 0 || fromIndex >= sorted.length) return group;
    const [moved] = sorted.splice(fromIndex, 1);
    sorted.splice(toIndex, 0, moved!);
    return { ...group, fields: renumbered(sorted) };
  });
}

/**
 * Clone a field as a new, non-protected added field with a fresh systemKey that
 * is absent from any pack (so it reads as an overlay-representable added field),
 * inserted immediately after the original. The group is renumbered.
 */
export function duplicateField(
  pack: FormPack,
  sectionKey: string,
  groupKey: string,
  systemKey: string,
): FormPack {
  return updateGroup(pack, sectionKey, groupKey, (group) => {
    const sorted = [...group.fields].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((f) => f.systemKey === systemKey);
    if (index === -1) return group;
    const existing = new Set(group.fields.map((f) => f.systemKey));
    const clone = {
      ...sorted[index]!,
      systemKey: uniqueFieldKey(existing),
      protected: false,
    };
    sorted.splice(index + 1, 0, clone);
    return { ...group, fields: renumbered(sorted) };
  });
}
