import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { duplicateField, reorderFields } from "../src/forms/structure/fieldOps";
import { FieldPropertyPanel } from "../src/forms/structure/FieldPropertyPanel";
import {
  addOptionalField,
  removeField,
  setFieldReadinessRequired,
  updateField,
  updateSection,
} from "../src/creator/packEdits";
import { FIELD_TYPES } from "../src/domain/formModel";
import type { FieldDefinition, FieldType, FormPack, PackSection } from "../src/domain/formModel";
import { SectionPropertyPanel } from "./SectionPropertyPanel";

export interface OverlayDesignProps {
  base: FormPack;
  section: PackSection;
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
  onChangeBase: (next: FormPack) => void;
  /**
   * Removal is the parent's job: it owns `activeSection`, which would otherwise
   * keep naming the section we just deleted.
   */
  onRemoveSection: (sectionKey: string) => void;
  onError: (message: string) => void;
}

/**
 * Moves `fromKey` to `toKey`'s slot within a group, renumbering sequentially.
 * A no-op (referential-identity `base`) if either key is unknown.
 */
function reorderFieldsByKey(
  base: FormPack,
  sectionKey: string,
  groupKey: string,
  fromKey: string,
  toKey: string,
): FormPack {
  const group = base.sections
    .find((s) => s.sectionKey === sectionKey)
    ?.groups.find((g) => g.groupKey === groupKey);
  if (!group) return base;
  const sorted = [...group.fields].sort((a, b) => a.order - b.order);
  const fromIndex = sorted.findIndex((f) => f.systemKey === fromKey);
  const toIndex = sorted.findIndex((f) => f.systemKey === toKey);
  if (fromIndex === -1 || toIndex === -1) return base;
  return reorderFields(base, sectionKey, groupKey, fromIndex, toIndex);
}

interface RowProps {
  field: FieldDefinition;
  groupKey: string;
  selected: boolean;
  onSelect: (key: string) => void;
  onDuplicate: (groupKey: string, key: string) => void;
  onRemove: (groupKey: string, key: string) => void;
}

function FieldRow({ field, groupKey, selected, onSelect, onDuplicate, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.systemKey,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={selected ? "field-row field-row--selected" : "field-row"}
      data-field-key={field.systemKey}
    >
      <button
        type="button"
        className="field-row__handle"
        aria-label={`Drag to reorder ${field.label}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <button
        type="button"
        className="field-row__label"
        aria-label={`Edit field ${field.label}`}
        onClick={() => onSelect(field.systemKey)}
      >
        {field.label}
      </button>
      <span className="field-row__type">{field.type}</span>
      <button
        type="button"
        className="button button--ghost button--small"
        aria-label={`Duplicate ${field.label}`}
        onClick={() => onDuplicate(groupKey, field.systemKey)}
      >
        ⧉
      </button>
      {/* Protected fields are structural: removeField throws for them, so they
          get no Remove control at all. */}
      {!field.protected ? (
        <button
          type="button"
          className="button button--ghost button--small"
          aria-label={`Remove field ${field.label}`}
          onClick={() => onRemove(groupKey, field.systemKey)}
        >
          ✕
        </button>
      ) : null}
    </li>
  );
}

export function OverlayDesign({
  base,
  section,
  selectedKey,
  onSelectKey,
  onChangeBase,
  onRemoveSection,
  onError,
}: OverlayDesignProps) {
  const selectedField =
    section.groups.flatMap((g) => g.fields).find((f) => f.systemKey === selectedKey) ?? null;
  const selectedGroupKey =
    section.groups.find((g) => g.fields.some((f) => f.systemKey === selectedKey))?.groupKey ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleSectionChange(patch: { title: string; lede: string; multiRecord: boolean }) {
    onChangeBase(updateSection(base, section.sectionKey, (s) => ({ ...s, ...patch })));
  }

  function handleAdd(groupKey: string, type: FieldType) {
    onChangeBase(addOptionalField(base, section.sectionKey, groupKey, type));
  }

  function handleRemove(groupKey: string, systemKey: string) {
    try {
      onChangeBase(removeField(base, section.sectionKey, groupKey, systemKey));
      if (selectedKey === systemKey) onSelectKey(null);
    } catch (error) {
      // removeField throws only for `protected` fields — unreachable from this
      // UI today because the row renders no Remove control for them. Kept as a
      // defensive catch in case that gating ever changes.
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleToggleReadinessAnchor(groupKey: string, systemKey: string, next: boolean) {
    onChangeBase(setFieldReadinessRequired(base, section.sectionKey, groupKey, systemKey, next));
  }

  function handleDuplicate(groupKey: string, systemKey: string) {
    onChangeBase(duplicateField(base, section.sectionKey, groupKey, systemKey));
  }

  function handleDragEnd(groupKey: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChangeBase(
      reorderFieldsByKey(base, section.sectionKey, groupKey, String(active.id), String(over.id)),
    );
  }

  return (
    <div className="pack-editor__design">
      <div className="field-list">
        {section.groups.map((group) => {
          const sorted = [...group.fields].sort((a, b) => a.order - b.order);
          return (
            <section key={group.groupKey} className="field-list__group">
              <h3 className="field-list__group-title">{group.title}</h3>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => handleDragEnd(group.groupKey, event)}
              >
                <SortableContext
                  items={sorted.map((f) => f.systemKey)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="field-list__rows">
                    {sorted.map((field) => (
                      <FieldRow
                        key={field.systemKey}
                        field={field}
                        groupKey={group.groupKey}
                        selected={field.systemKey === selectedKey}
                        onSelect={onSelectKey}
                        onDuplicate={handleDuplicate}
                        onRemove={handleRemove}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
              <label className="field-list__add">
                <span className="sr-only">{`Add field to ${group.title}`}</span>
                <select
                  aria-label={`Add field to ${group.title}`}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) handleAdd(group.groupKey, e.target.value as FieldType);
                    e.target.value = "";
                  }}
                >
                  <option value="">+ Add field…</option>
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          );
        })}
      </div>

      {selectedField ? (
        <FieldPropertyPanel
          field={selectedField}
          onChange={(updated) => {
            if (!selectedGroupKey) return;
            onChangeBase(
              updateField(
                base,
                section.sectionKey,
                selectedGroupKey,
                updated.systemKey,
                () => updated,
              ),
            );
          }}
          isReadinessAnchor={section.readinessRule.requiredKeys.includes(selectedField.systemKey)}
          onToggleReadinessAnchor={() => {
            if (!selectedGroupKey) return;
            handleToggleReadinessAnchor(
              selectedGroupKey,
              selectedField.systemKey,
              !section.readinessRule.requiredKeys.includes(selectedField.systemKey),
            );
          }}
        />
      ) : (
        <SectionPropertyPanel
          section={{ title: section.title, lede: section.lede, multiRecord: section.multiRecord }}
          onChange={handleSectionChange}
          onRemove={() => onRemoveSection(section.sectionKey)}
        />
      )}
    </div>
  );
}
