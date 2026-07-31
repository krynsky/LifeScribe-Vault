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
import { addSection, updateSection } from "../src/creator/packEdits";
import type { FormPack, PackSection } from "../src/domain/formModel";

export interface SectionNavProps {
  base: FormPack;
  activeSection: string;
  onSelectSection: (sectionKey: string) => void;
  onChangeBase: (next: FormPack) => void;
}

/**
 * Moves `fromKey` next to `toKey` within `base.sections`, renumbering
 * sequentially. A no-op (referential-identity `base`) if either key is unknown.
 */
function reorderSections(base: FormPack, fromKey: string, toKey: string): FormPack {
  const sorted = [...base.sections].sort((a, b) => a.order - b.order);
  const fromIndex = sorted.findIndex((s) => s.sectionKey === fromKey);
  const toIndex = sorted.findIndex((s) => s.sectionKey === toKey);
  if (fromIndex === -1 || toIndex === -1) return base;

  const moved = [...sorted];
  const [item] = moved.splice(fromIndex, 1);
  moved.splice(toIndex, 0, item!);
  return { ...base, sections: moved.map((s, i) => ({ ...s, order: i + 1 })) };
}

interface RowProps {
  section: PackSection;
  active: boolean;
  onSelect: (sectionKey: string) => void;
  onRename: (sectionKey: string, title: string) => void;
}

function SectionRow({ section, active, onSelect, onRename }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.sectionKey,
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
      className={active ? "section-nav__row section-nav__row--active" : "section-nav__row"}
      data-section-key={section.sectionKey}
      aria-current={active ? "page" : undefined}
    >
      <button
        type="button"
        className="section-nav__handle"
        aria-label={`Drag to reorder ${section.title}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <input
        type="text"
        className="section-nav__title"
        aria-label={`Rename section: ${section.title}`}
        value={section.title}
        onFocus={() => onSelect(section.sectionKey)}
        onChange={(e) => onRename(section.sectionKey, e.target.value)}
      />
    </li>
  );
}

export function SectionNav({ base, activeSection, onSelectSection, onChangeBase }: SectionNavProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sections = [...base.sections].sort((a, b) => a.order - b.order);
  const ids = sections.map((s) => s.sectionKey);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChangeBase(reorderSections(base, String(active.id), String(over.id)));
  }

  function handleRename(sectionKey: string, title: string) {
    onChangeBase(updateSection(base, sectionKey, (s) => ({ ...s, title })));
  }

  function handleAdd() {
    const before = new Set(base.sections.map((s) => s.sectionKey));
    const next = addSection(base);
    onChangeBase(next);
    const created = next.sections.find((s) => !before.has(s.sectionKey));
    if (created) onSelectSection(created.sectionKey);
  }

  return (
    <nav className="pack-editor__nav" aria-label="Sections">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="section-nav__rows">
            {sections.map((section) => (
              <SectionRow
                key={section.sectionKey}
                section={section}
                active={section.sectionKey === activeSection}
                onSelect={onSelectSection}
                onRename={handleRename}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <button type="button" className="button button--ghost button--small section-nav__add" onClick={handleAdd}>
        + Add section
      </button>
    </nav>
  );
}
