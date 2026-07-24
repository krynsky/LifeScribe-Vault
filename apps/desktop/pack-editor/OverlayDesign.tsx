import { duplicateField, reorderFields } from "../src/forms/structure/fieldOps";
import { FieldPropertyPanel } from "../src/forms/structure/FieldPropertyPanel";
import {
  addFieldToTarget,
  removeInTarget,
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
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: (key: string) => void;
  onDuplicate: (groupKey: string, key: string) => void;
  onRemove: (groupKey: string, key: string) => void;
  onMoveUp: (groupKey: string, key: string) => void;
  onMoveDown: (groupKey: string, key: string) => void;
}

function FieldRow({
  field,
  groupKey,
  base,
  activeTarget,
  selected,
  canMoveUp,
  canMoveDown,
  onSelect,
  onDuplicate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: RowProps) {
  const layer = layerOf(field.source, activeTarget);
  const owner = isActiveOwner(field.source, activeTarget);
  const reorderable = field.source.kind === "base" && !field.removed;
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
      className={selected ? "field-row field-row--selected" : "field-row"}
      data-layer={layer}
      data-removed={field.removed ? "true" : undefined}
    >
      <button
        type="button"
        className="field-row__handle"
        aria-label={`Move field ${field.label} up`}
        disabled={!reorderable || !canMoveUp}
        onClick={() => onMoveUp(groupKey, field.systemKey)}
      >
        ↑
      </button>
      <button
        type="button"
        className="field-row__handle"
        aria-label={`Move field ${field.label} down`}
        disabled={!reorderable || !canMoveDown}
        onClick={() => onMoveDown(groupKey, field.systemKey)}
      >
        ↓
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

  function handleSectionChange(patch: { title: string; lede: string; multiRecord: boolean }) {
    onChangeBase(
      updateSectionInTarget(base, activeTarget, viewSection.sectionKey, (s) => ({ ...s, ...patch })),
    );
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

  function move(groupKey: string, systemKey: string, direction: "up" | "down") {
    const group = viewSection.groups.find((g) => g.groupKey === groupKey);
    if (!group) return;
    const sorted = [...group.fields].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((f) => f.systemKey === systemKey);
    if (index === -1) return;
    const neighborIndex = direction === "up" ? index - 1 : index + 1;
    const neighbor = sorted[neighborIndex];
    const current = sorted[index]!;
    if (!neighbor || current.source.kind !== "base" || neighbor.source.kind !== "base") return;

    const baseGroup = base.sections
      .find((s) => s.sectionKey === viewSection.sectionKey)
      ?.groups.find((g) => g.groupKey === groupKey);
    if (!baseGroup) return;
    const baseSorted = [...baseGroup.fields].sort((a, b) => a.order - b.order);
    const fromIndex = baseSorted.findIndex((f) => f.systemKey === current.systemKey);
    const toIndex = baseSorted.findIndex((f) => f.systemKey === neighbor.systemKey);
    if (fromIndex === -1 || toIndex === -1) return;
    onChangeBase(reorderFields(base, viewSection.sectionKey, groupKey, fromIndex, toIndex));
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
              <ul className="field-list__rows">
                {sorted.map((field, index) => (
                  <FieldRow
                    key={field.systemKey}
                    field={field}
                    groupKey={group.groupKey}
                    base={base}
                    activeTarget={activeTarget}
                    selected={field.systemKey === selectedKey}
                    // move() only ever swaps with the IMMEDIATE view neighbor
                    // and no-ops if that neighbor isn't base-sourced — so an
                    // enabled button must mirror that exactly, not just index
                    // bounds, or a module-interleaved base field (e.g. [A, M,
                    // B]) would show an enabled-but-dead "move down" on A.
                    canMoveUp={index > 0 && sorted[index - 1]!.source.kind === "base"}
                    canMoveDown={index < sorted.length - 1 && sorted[index + 1]!.source.kind === "base"}
                    onSelect={onSelectKey}
                    onDuplicate={handleDuplicate}
                    onRemove={handleRemove}
                    onMoveUp={(gk, key) => move(gk, key, "up")}
                    onMoveDown={(gk, key) => move(gk, key, "down")}
                  />
                ))}
              </ul>
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
        />
      ) : (
        <div className="field-panel field-panel--locked" role="note">
          <p>
            {viewSection.removed
              ? "This section has been removed here. It cannot be edited while removed."
              : `This section comes from ${ownerLabel(viewSection.source, base)}. Switch the active target to edit it.`}
          </p>
        </div>
      )}
    </div>
  );
}
