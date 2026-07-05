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
import type { FieldDefinition, FieldGroup, FieldType } from "../src/domain/formModel";
import { FIELD_TYPES } from "../src/domain/formModel";

export interface FieldListProps {
  groups: FieldGroup[];
  selectedKey: string | null;
  /** systemKeys present in the hint pack — these cannot be deleted. */
  hintKeys: Set<string>;
  onSelect: (systemKey: string) => void;
  onDuplicate: (groupKey: string, systemKey: string) => void;
  onDelete: (groupKey: string, systemKey: string) => void;
  onAdd: (groupKey: string, type: FieldType) => void;
  onReorder: (groupKey: string, fromIndex: number, toIndex: number) => void;
}

interface RowProps {
  field: FieldDefinition;
  groupKey: string;
  selected: boolean;
  deletable: boolean;
  onSelect: (systemKey: string) => void;
  onDuplicate: (groupKey: string, systemKey: string) => void;
  onDelete: (groupKey: string, systemKey: string) => void;
}

function FieldRow({ field, groupKey, selected, deletable, onSelect, onDuplicate, onDelete }: RowProps) {
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
      {deletable ? (
        <button
          type="button"
          className="button button--ghost button--small"
          aria-label={`Remove field ${field.label}`}
          onClick={() => onDelete(groupKey, field.systemKey)}
        >
          ✕
        </button>
      ) : null}
    </li>
  );
}

export function FieldList({
  groups,
  selectedKey,
  hintKeys,
  onSelect,
  onDuplicate,
  onDelete,
  onAdd,
  onReorder,
}: FieldListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <div className="field-list">
      {groups.map((group) => {
        const sorted = [...group.fields].sort((a, b) => a.order - b.order);
        const ids = sorted.map((f) => f.systemKey);
        const handleDragEnd = (event: DragEndEvent) => {
          const { active, over } = event;
          if (!over || active.id === over.id) return;
          const from = ids.indexOf(String(active.id));
          const to = ids.indexOf(String(over.id));
          if (from !== -1 && to !== -1) onReorder(group.groupKey, from, to);
        };
        return (
          <section key={group.groupKey} className="field-list__group">
            <h3 className="field-list__group-title">{group.title}</h3>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <ul className="field-list__rows">
                  {sorted.map((field) => (
                    <FieldRow
                      key={field.systemKey}
                      field={field}
                      groupKey={group.groupKey}
                      selected={field.systemKey === selectedKey}
                      deletable={!hintKeys.has(field.systemKey)}
                      onSelect={onSelect}
                      onDuplicate={onDuplicate}
                      onDelete={onDelete}
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
                  if (e.target.value) onAdd(group.groupKey, e.target.value as FieldType);
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
  );
}
