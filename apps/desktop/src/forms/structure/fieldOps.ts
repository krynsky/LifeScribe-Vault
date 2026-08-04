import { updateGroup } from "../../creator/packEdits";
import type { FieldGroup, FormPack } from "../../domain/formModel";

function renumbered(fields: FieldGroup["fields"]): FieldGroup["fields"] {
  return fields.map((field, index) => ({ ...field, order: index + 1 }));
}

/**
 * Move a field within a group from one display position to another, then
 * renumber `order` to sequential integers so the group stays internally
 * consistent (array order must equal order-value order).
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
