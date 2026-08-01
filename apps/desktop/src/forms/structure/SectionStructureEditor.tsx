/**
 * SectionStructureEditor — in-app form-structure editor with the same
 * master-detail interaction model as the pack editor's Design view: a
 * sortable FieldList (drag-to-reorder, duplicate/delete adorners,
 * type-picker add) alongside a FieldPropertyPanel that edits the selected
 * field.
 *
 * Security contract (inherited from the shared components):
 * - systemKey is NEVER shown or editable (FieldPropertyPanel omits it).
 * - `protected` fields cannot be deleted (FieldList locks them) and cannot
 *   have `required` unchecked (FieldPropertyPanel guards the checkbox).
 * - Options are plain FieldOption objects — no expression strings, no JS.
 */

import { useState } from "react";
import type { FieldDefinition, FieldType, PackSection } from "../../domain/formModel";
import { FieldList } from "./FieldList";
import { FieldPropertyPanel } from "./FieldPropertyPanel";

/** In-app editing has no externally-locked keys; protection is per-field. */
const NO_LOCKED_KEYS: Set<string> = new Set();

export interface SectionStructureEditorProps {
  /** Raw, editable pack section (structural definitions, not resolved values). */
  section: PackSection;
  sections: PackSection[];
  onEditField: (sectionKey: string, groupKey: string, updated: FieldDefinition) => void;
  onRemoveField: (sectionKey: string, groupKey: string, systemKey: string) => void;
  onDuplicateField: (sectionKey: string, groupKey: string, systemKey: string) => void;
  onReorderField: (
    sectionKey: string,
    groupKey: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  onAddField: (sectionKey: string, groupKey: string, type: FieldType) => void;
}

export function SectionStructureEditor({
  section,
  sections,
  onEditField,
  onRemoveField,
  onDuplicateField,
  onReorderField,
  onAddField,
}: SectionStructureEditorProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selectedField =
    section.groups.flatMap((group) => group.fields).find((f) => f.systemKey === selectedKey) ??
    null;
  const selectedGroupKey =
    section.groups.find((group) => group.fields.some((f) => f.systemKey === selectedKey))
      ?.groupKey ?? null;

  return (
    <div className="section-structure-editor">
      <FieldList
        groups={section.groups}
        selectedKey={selectedKey}
        lockedKeys={NO_LOCKED_KEYS}
        onSelect={setSelectedKey}
        onDuplicate={(groupKey, systemKey) =>
          onDuplicateField(section.sectionKey, groupKey, systemKey)
        }
        onDelete={(groupKey, systemKey) => {
          onRemoveField(section.sectionKey, groupKey, systemKey);
          setSelectedKey((current) => (current === systemKey ? null : current));
        }}
        onReorder={(groupKey, fromIndex, toIndex) =>
          onReorderField(section.sectionKey, groupKey, fromIndex, toIndex)
        }
        onAdd={(groupKey, type) => onAddField(section.sectionKey, groupKey, type)}
      />
      <FieldPropertyPanel
        field={selectedField}
        sections={sections}
        currentSectionKey={section.sectionKey}
        onChange={(updated) => {
          if (!selectedGroupKey) return;
          onEditField(section.sectionKey, selectedGroupKey, updated);
        }}
      />
    </div>
  );
}
