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
import { useState } from "react";
import {
  addFieldToTarget,
  removeInTarget,
  removeSectionInTarget,
  updateFieldInTarget,
  updateSectionInTarget,
  type EditTarget,
} from "../src/creator/editorEdits";
import type { EditorView, EditorViewField, EditorViewSection, ViewSource } from "../src/creator/editorView";
import { maxOrder } from "../src/creator/packEdits";
import { isCustomFieldKey, FIELD_TYPES } from "../src/domain/formModel";
import type { FieldDefinition, FieldType, FormPack } from "../src/domain/formModel";
import { SectionPropertyPanel } from "./SectionPropertyPanel";

export interface OverlayDesignProps {
  base: FormPack;
  view: EditorView;
  viewSection: EditorViewSection;
  activeTarget: EditTarget;
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
  onChangeBase: (next: FormPack) => void;
  onError: (message: string) => void;
}

/**
 * EditorViewField extends FieldDefinition with view-only `source`/`removed`
 * keys. FieldPropertyPanel's onChange does `{...field, ...}`, so those keys
 * would otherwise ride along into `updateField` and get persisted into the
 * pack JSON. Strip them at both the field-list -> panel boundary (defense at
 * the source) AND again in the panel's onChange (defense against a future
 * change to the panel re-spreading extra keys in).
 */
function stripViewKeys(field: FieldDefinition & { source?: ViewSource; removed?: boolean }): FieldDefinition {
  const { source: _source, removed: _removed, ...def } = field;
  return def;
}

function uniqueFieldKey(): string {
  let key: string;
  do {
    key = `field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  } while (isCustomFieldKey(key));
  return key;
}

/**
 * Moves `fromKey` to `toKey`'s slot within a base group, renumbering
 * sequentially. A no-op (referential-identity `base`) if either key isn't
 * base-sourced — the list renders the MIXED view (base + module-injected
 * fields), so a dragged/dropped row may belong to a module option. Mirrors
 * SectionNav.reorderBaseSections; the base-index translation via reorderFields
 * lets a module-interleaved neighbor be skipped without derailing the move.
 */
function reorderBaseFieldsByKey(
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

/** Which module/option (or "Base") a field's source layer names for display. */
function ownerLabel(source: ViewSource, base: FormPack): string {
  if (source.kind === "base") return "Base";
  const module = (base.modules ?? []).find((m) => m.moduleId === source.moduleId);
  const option = module?.options.find((o) => o.optionId === source.optionId);
  return `${module?.title ?? source.moduleId} → ${option?.label ?? source.optionId}`;
}

/** "base" | "active" | "other" — purely for provenance styling, per spec section A. */
function layerOf(source: ViewSource, activeTarget: EditTarget): "base" | "active" | "other" {
  if (source.kind === "base") return "base";
  const isActive =
    activeTarget.kind === "module" &&
    activeTarget.moduleId === source.moduleId &&
    activeTarget.optionId === source.optionId;
  return isActive ? "active" : "other";
}

/** Whether the active target owns this field, i.e. edits to it are live, not silently dropped. */
function isActiveOwner(source: ViewSource, activeTarget: EditTarget): boolean {
  if (activeTarget.kind === "base") return source.kind === "base";
  return layerOf(source, activeTarget) === "active";
}

interface RowProps {
  field: EditorViewField;
  groupKey: string;
  base: FormPack;
  activeTarget: EditTarget;
  selected: boolean;
  reorderable: boolean;
  onSelect: (key: string) => void;
  onDuplicate: (groupKey: string, key: string) => void;
  onRemove: (groupKey: string, key: string) => void;
}

function FieldRow({
  field,
  groupKey,
  base,
  activeTarget,
  selected,
  reorderable,
  onSelect,
  onDuplicate,
  onRemove,
}: RowProps) {
  // useSortable's `disabled` shorthand only disables DRAGGING when passed a
  // plain boolean (droppable stays enabled), so a non-reorderable row would
  // still be a valid drop target unless both flags are set — matching
  // SectionNav's handling.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.systemKey,
    disabled: { draggable: !reorderable, droppable: !reorderable },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };
  const layer = layerOf(field.source, activeTarget);
  const owner = isActiveOwner(field.source, activeTarget);
  const showDuplicate = field.source.kind === "base" && owner && !field.removed;
  // removeInTarget's module branch just records a removeKey by systemKey — it
  // never silently no-ops, regardless of which layer the field came from, so
  // any field is actionable while a module option is active. Its base branch
  // only mutates base.sections, so with the base target active, Remove is only
  // actionable for fields the base target actually owns; anything else (an
  // overlaid-but-not-active module's field) must NOT render an enabled Remove
  // — removeField's `if (!field) return pack;` would silently no-op it.
  const removalActionable = activeTarget.kind === "module" || owner;
  const showRemove = !field.removed && !field.protected && removalActionable;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={selected ? "field-row field-row--selected" : "field-row"}
      data-layer={layer}
      data-field-key={field.systemKey}
      data-removed={field.removed ? "true" : undefined}
    >
      <button
        type="button"
        className="field-row__handle"
        aria-label={`Drag to reorder ${field.label}`}
        disabled={!reorderable}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <button
        type="button"
        className="field-row__label"
        aria-label={`Edit field ${field.label}`}
        style={field.removed ? { textDecoration: "line-through" } : undefined}
        onClick={() => onSelect(field.systemKey)}
      >
        {field.label}
      </button>
      <span className="field-row__type">{field.type}</span>
      {layer === "other" ? (
        <span className="field-row__from">{`from ${ownerLabel(field.source, base)}`}</span>
      ) : null}
      {showDuplicate ? (
        <button
          type="button"
          className="button button--ghost button--small"
          aria-label={`Duplicate ${field.label}`}
          onClick={() => onDuplicate(groupKey, field.systemKey)}
        >
          ⧉
        </button>
      ) : null}
      {showRemove ? (
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

/** Two-step remove button for sections that are locked (not owned by the active
 *  target) but still removable — e.g. a base section while a module option is
 *  active. Mirrors SectionPropertyPanel's confirm UI without the property fields. */
function LockedSectionRemoveButton({ title, onRemove }: { title: string; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="module-panel__confirm" role="alert">
        <p>Remove section <strong>{title}</strong>? This cannot be undone until you close the editor without saving.</p>
        <div className="module-panel__confirm-actions">
          <button
            type="button"
            className="button button--ghost button--small"
            aria-label={`Cancel remove section ${title}`}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--small module-panel__delete"
            aria-label={`Confirm remove section ${title}`}
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="button button--ghost button--small module-panel__delete"
      aria-label={`Remove section ${title}`}
      onClick={() => setConfirming(true)}
    >
      Remove section
    </button>
  );
}

export function OverlayDesign({
  base,
  view,
  viewSection,
  activeTarget,
  selectedKey,
  onSelectKey,
  onChangeBase,
  onError,
}: OverlayDesignProps) {
  const selectedField =
    viewSection.groups.flatMap((g) => g.fields).find((f) => f.systemKey === selectedKey) ?? null;
  const selectedGroupKey =
    viewSection.groups.find((g) => g.fields.some((f) => f.systemKey === selectedKey))?.groupKey ?? null;
  const selectedEditable = selectedField ? isActiveOwner(selectedField.source, activeTarget) && !selectedField.removed : false;
  // When no field is selected, the panel falls back to editing the currently
  // active section itself — gated by the same ownership rule as fields, so an
  // enabled panel is never a dead end for a section this target doesn't own.
  const sectionEditable = isActiveOwner(viewSection.source, activeTarget) && !viewSection.removed;
  // removeSectionInTarget's module branch just records a removeSectionKeys
  // entry regardless of which layer the section came from, so any section is
  // removable while a module option is active. Its base branch only mutates
  // base.sections, so remove is only actionable for sections the base target
  // actually owns.
  const sectionRemovable =
    !viewSection.removed && (activeTarget.kind === "module" || sectionEditable);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleSectionChange(patch: { title: string; lede: string; multiRecord: boolean }) {
    onChangeBase(
      updateSectionInTarget(base, activeTarget, viewSection.sectionKey, (s) => ({ ...s, ...patch })),
    );
  }

  function handleRemoveSection() {
    onChangeBase(removeSectionInTarget(base, activeTarget, viewSection.sectionKey));
  }

  function handleAdd(groupKey: string, type: FieldType) {
    const group = viewSection.groups.find((g) => g.groupKey === groupKey);
    const order = maxOrder(group?.fields ?? []) + 1;
    const newField: FieldDefinition = {
      systemKey: uniqueFieldKey(),
      label: "New Field",
      type,
      required: false,
      protected: false,
      order,
    };
    onChangeBase(addFieldToTarget(base, activeTarget, viewSection.sectionKey, groupKey, newField));
  }

  function handleRemove(groupKey: string, systemKey: string) {
    try {
      const next = removeInTarget(base, activeTarget, viewSection.sectionKey, groupKey, systemKey);
      onChangeBase(next);
      if (selectedKey === systemKey) onSelectKey(null);
    } catch (error) {
      // removeField (the base branch of removeInTarget) throws only for
      // `protected` fields — unreachable from this UI today because
      // `showRemove` already excludes protected fields from the row. Kept as
      // a defensive catch (not exercised by any current test) in case that
      // gating ever changes.
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleDuplicate(groupKey: string, systemKey: string) {
    onChangeBase(duplicateField(base, viewSection.sectionKey, groupKey, systemKey));
  }

  function handleDragEnd(groupKey: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChangeBase(
      reorderBaseFieldsByKey(base, viewSection.sectionKey, groupKey, String(active.id), String(over.id)),
    );
  }

  return (
    <div className="pack-editor__design">
      <div className="field-list">
        {view.warnings.length > 0 ? (
          <div className="overlay-design__warnings" role="status">
            {view.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
        {viewSection.groups.map((group) => {
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
                        base={base}
                        activeTarget={activeTarget}
                        selected={field.systemKey === selectedKey}
                        // Only base-sourced, non-removed fields can be dragged;
                        // reorderBaseFieldsByKey no-ops on module-interleaved
                        // rows (their droppable is disabled too), so a module
                        // field between two base ones is skipped, not derailed.
                        reorderable={field.source.kind === "base" && !field.removed}
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
        selectedEditable ? (
          <FieldPropertyPanel
            field={stripViewKeys(selectedField)}
            onChange={(updated) => {
              if (!selectedGroupKey) return;
              const clean = stripViewKeys(updated);
              onChangeBase(
                updateFieldInTarget(
                  base,
                  activeTarget,
                  viewSection.sectionKey,
                  selectedGroupKey,
                  clean.systemKey,
                  clean,
                ),
              );
            }}
          />
        ) : (
          <div className="field-panel field-panel--locked" role="note">
            <p>
              {selectedField.removed
                ? "This field has been removed here. It cannot be edited while removed."
                : `This field comes from ${ownerLabel(selectedField.source, base)}. Switch the active target to edit it.`}
            </p>
          </div>
        )
      ) : sectionEditable ? (
        <SectionPropertyPanel
          section={{ title: viewSection.title, lede: viewSection.lede, multiRecord: viewSection.multiRecord }}
          onChange={handleSectionChange}
          onRemove={sectionRemovable ? handleRemoveSection : undefined}
        />
      ) : (
        <div className="field-panel field-panel--locked" role="note">
          <p>
            {viewSection.removed
              ? "This section has been removed here. It cannot be edited while removed."
              : `This section comes from ${ownerLabel(viewSection.source, base)}. Switch the active target to edit it.`}
          </p>
          {sectionRemovable ? (
            <LockedSectionRemoveButton title={viewSection.title} onRemove={handleRemoveSection} />
          ) : null}
        </div>
      )}
    </div>
  );
}
