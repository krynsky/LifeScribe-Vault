import { useState } from "react";
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
import {
  addSectionToTarget,
  removeSectionInTarget,
  renameSectionInTarget,
  type EditTarget,
} from "../src/creator/editorEdits";
import type { EditorView, EditorViewSection, ViewSource } from "../src/creator/editorView";
import { maxOrder } from "../src/creator/packEdits";
import { isCustomFieldKey } from "../src/domain/formModel";
import type { FormPack, PackSection } from "../src/domain/formModel";

export interface SectionNavProps {
  base: FormPack;
  view: EditorView;
  activeTarget: EditTarget;
  activeSection: string;
  onSelectSection: (sectionKey: string) => void;
  onChangeBase: (next: FormPack) => void;
}

/** Which module/option (or "Base") a section's source layer names for display. */
function ownerLabel(source: ViewSource, base: FormPack): string {
  if (source.kind === "base") return "Base";
  const module = (base.modules ?? []).find((m) => m.moduleId === source.moduleId);
  const option = module?.options.find((o) => o.optionId === source.optionId);
  return `${module?.title ?? source.moduleId} → ${option?.label ?? source.optionId}`;
}

/** "base" | "active" | "other" — purely for provenance styling, mirroring OverlayDesign. */
function layerOf(source: ViewSource, activeTarget: EditTarget): "base" | "active" | "other" {
  if (source.kind === "base") return "base";
  const isActive =
    activeTarget.kind === "module" &&
    activeTarget.moduleId === source.moduleId &&
    activeTarget.optionId === source.optionId;
  return isActive ? "active" : "other";
}

/** Whether the active target owns this section, i.e. edits to it are live, not silently dropped. */
function isActiveOwner(source: ViewSource, activeTarget: EditTarget): boolean {
  if (activeTarget.kind === "base") return source.kind === "base";
  return layerOf(source, activeTarget) === "active";
}

function uniqueKey(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function uniqueSectionKey(existingKeys: Set<string>): string {
  let key = uniqueKey("section");
  while (existingKeys.has(key)) key = uniqueKey("section");
  return key;
}

function uniqueFieldKey(): string {
  let key: string;
  do {
    key = uniqueKey("field");
  } while (isCustomFieldKey(key));
  return key;
}

/** Seeds a fresh section with one group + one unprotected field, so it is valid on save. */
function seededSection(order: number, existingKeys: Set<string>): PackSection {
  const title = "New Section";
  return {
    sectionKey: uniqueSectionKey(existingKeys),
    title,
    lede: "",
    multiRecord: false,
    order,
    groups: [
      {
        groupKey: uniqueKey("group"),
        title: "Details",
        repeatable: false,
        order: 1,
        fields: [
          {
            systemKey: uniqueFieldKey(),
            label: "New Field",
            type: "text",
            required: false,
            protected: false,
            order: 1,
          },
        ],
      },
    ],
    readinessRule: { requiredKeys: [] },
    kitMapping: { entries: [{ heading: title, fields: [] }] },
  };
}

/**
 * Moves `fromKey` next to `toKey` within `base.sections`, renumbering
 * sequentially. A no-op (referential-identity `base`) if either key isn't
 * base-sourced — the nav renders the MIXED view list, so a dragged/dropped
 * view row may belong to a module option instead.
 */
function reorderBaseSections(base: FormPack, fromKey: string, toKey: string): FormPack {
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
  section: EditorViewSection;
  base: FormPack;
  activeTarget: EditTarget;
  active: boolean;
  editable: boolean;
  reorderable: boolean;
  showRemove: boolean;
  onSelect: (sectionKey: string) => void;
  onRename: (sectionKey: string, title: string) => void;
  onRemove: (sectionKey: string) => void;
}

function SectionRow({
  section,
  base,
  activeTarget,
  active,
  editable,
  reorderable,
  showRemove,
  onSelect,
  onRename,
  onRemove,
}: RowProps) {
  // useSortable's `disabled` shorthand only disables DRAGGING when passed a
  // plain boolean (droppable stays enabled for backwards compatibility), so a
  // non-reorderable row would still be a valid drop target unless both flags
  // are set explicitly.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.sectionKey,
    disabled: { draggable: !reorderable, droppable: !reorderable },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };
  const layer = layerOf(section.source, activeTarget);
  const [confirming, setConfirming] = useState(false);
  const removeLabel =
    activeTarget.kind === "module"
      ? `${section.title} in this option`
      : `section ${section.title}`;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={active ? "section-nav__row section-nav__row--active" : "section-nav__row"}
      data-layer={layer}
      data-section-key={section.sectionKey}
      data-removed={section.removed ? "true" : undefined}
      aria-current={active ? "page" : undefined}
    >
      <button
        type="button"
        className="section-nav__handle"
        aria-label={`Drag to reorder ${section.title}`}
        disabled={!reorderable}
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
        readOnly={!editable}
        style={section.removed ? { textDecoration: "line-through" } : undefined}
        onFocus={() => onSelect(section.sectionKey)}
        onChange={(e) => {
          if (editable) onRename(section.sectionKey, e.target.value);
        }}
      />
      {section.source.kind !== "base" ? (
        <span className="section-nav__from">{`from ${ownerLabel(section.source, base)}`}</span>
      ) : null}
      {showRemove ? (
        confirming ? (
          <span className="section-nav__confirm">
            <button
              type="button"
              className="button button--ghost button--small"
              aria-label={`Cancel removing ${removeLabel}`}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--ghost button--small confirm-remove"
              aria-label={`Confirm remove ${removeLabel}`}
              onClick={() => onRemove(section.sectionKey)}
            >
              Remove
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="button button--ghost button--small"
            aria-label={`Remove ${removeLabel}`}
            onClick={() => setConfirming(true)}
          >
            ✕
          </button>
        )
      ) : null}
    </li>
  );
}

export function SectionNav({
  base,
  view,
  activeTarget,
  activeSection,
  onSelectSection,
  onChangeBase,
}: SectionNavProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = view.sections.map((s) => s.sectionKey);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChangeBase(reorderBaseSections(base, String(active.id), String(over.id)));
  }

  function handleRename(sectionKey: string, title: string) {
    onChangeBase(renameSectionInTarget(base, activeTarget, sectionKey, title));
  }

  function handleRemove(sectionKey: string) {
    onChangeBase(removeSectionInTarget(base, activeTarget, sectionKey));
  }

  function handleAdd() {
    const existingKeys = new Set(view.sections.map((s) => s.sectionKey));
    const order = maxOrder(view.sections) + 1;
    const section = seededSection(order, existingKeys);
    onChangeBase(addSectionToTarget(base, activeTarget, section));
    onSelectSection(section.sectionKey);
  }

  return (
    <nav className="pack-editor__nav" aria-label="Sections">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="section-nav__rows">
            {view.sections.map((section) => {
              const owner = isActiveOwner(section.source, activeTarget);
              const reorderable = section.source.kind === "base" && !section.removed;
              const editable = owner && !section.removed;
              // removeSectionInTarget's module branch just records a
              // removeSectionKeys entry — it never silently no-ops, regardless
              // of which layer the section came from, so any row is
              // actionable while a module option is active. Its base branch
              // only mutates base.sections, so with the base target active,
              // Remove is only actionable for sections the base target
              // actually owns.
              const removalActionable = activeTarget.kind === "module" || owner;
              const showRemove = !section.removed && removalActionable;
              return (
                <SectionRow
                  key={section.sectionKey}
                  section={section}
                  base={base}
                  activeTarget={activeTarget}
                  active={section.sectionKey === activeSection}
                  editable={editable}
                  reorderable={reorderable}
                  showRemove={showRemove}
                  onSelect={onSelectSection}
                  onRename={handleRename}
                  onRemove={handleRemove}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
      <button type="button" className="button button--ghost button--small section-nav__add" onClick={handleAdd}>
        + Add section
      </button>
    </nav>
  );
}
