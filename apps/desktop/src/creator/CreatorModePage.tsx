/**
 * CreatorModePage: in-app form-definition editor.
 *
 * Enabled at runtime via the sidebar toggle (packEditorEnabled in localStorage).
 * Receives the current active pack as `initialPack` from Dashboard and calls
 * `onSave` with the validated updated pack, which Dashboard persists to the vault.
 *
 * Security contract:
 * - Preview uses synthetic sample data only — never live vault records.
 * - Exported packs contain structure only; no value slots.
 */

import { useState } from "react";
import { FormRenderer } from "../forms/FormRenderer";
import type {
  FieldDefinition,
  FieldGroup,
  FieldOption,
  FieldType,
  FormPack,
  MigrationStep,
  PackSection,
  ResolvedSection,
  VisibleWhen,
} from "../domain/formModel";
import { FIELD_TYPES, isCustomFieldKey } from "../domain/formModel";
import { mergePackWithOverlay } from "../domain/packMerge";
import type { SectionValues } from "../domain/valuesStore";
import { exportPack } from "./packExport";

// ---------------------------------------------------------------------------
// Synthetic preview data
// ---------------------------------------------------------------------------

function syntheticSectionValues(section: ResolvedSection): SectionValues {
  const values: Record<string, string> = {};
  for (const group of section.groups) {
    for (const field of group.fields) {
      if (field.type === "select" && field.options && field.options.length > 0) {
        values[field.systemKey] = field.options[0].value;
      } else if (field.type === "date") {
        values[field.systemKey] = "2026-01-01";
      } else {
        values[field.systemKey] = `Sample ${field.label}`;
      }
    }
  }
  return {
    sectionKey: section.sectionKey,
    records: [{ id: "preview-record", schemaVersion: 1, values }],
    archivedAnswers: [],
  };
}

// ---------------------------------------------------------------------------
// Selection state
// ---------------------------------------------------------------------------

type SelectionKind = "none" | "section" | "group" | "field";

interface Selection {
  kind: SelectionKind;
  sectionKey: string;
  groupKey?: string;
  systemKey?: string;
}

// ---------------------------------------------------------------------------
// Immutable pack helpers
// ---------------------------------------------------------------------------

function updateSection(pack: FormPack, sectionKey: string, updater: (s: PackSection) => PackSection): FormPack {
  return {
    ...pack,
    sections: pack.sections.map((s) => (s.sectionKey === sectionKey ? updater(s) : s)),
  };
}

function updateGroup(pack: FormPack, sectionKey: string, groupKey: string, updater: (g: FieldGroup) => FieldGroup): FormPack {
  return updateSection(pack, sectionKey, (s) => ({
    ...s,
    groups: s.groups.map((g) => (g.groupKey === groupKey ? updater(g) : g)),
  }));
}

function updateField(pack: FormPack, sectionKey: string, groupKey: string, systemKey: string, updater: (f: FieldDefinition) => FieldDefinition): FormPack {
  return updateGroup(pack, sectionKey, groupKey, (g) => ({
    ...g,
    fields: g.fields.map((f) => (f.systemKey === systemKey ? updater(f) : f)),
  }));
}

function maxOrder(items: { order: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.order), 0);
}

// ---------------------------------------------------------------------------
// Sub-editors
// ---------------------------------------------------------------------------

interface SectionEditorProps {
  section: PackSection;
  onChange: (updated: PackSection) => void;
}

function SectionEditor({ section, onChange }: SectionEditorProps) {
  return (
    <div className="creator__editor-form">
      <h3 className="creator__editor-title">Section: {section.sectionKey}</h3>
      <label className="form-field">
        <span className="form-field__label">Title</span>
        <input
          className="form-field__input"
          type="text"
          value={section.title}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
        />
      </label>
      <label className="form-field">
        <span className="form-field__label">Lede</span>
        <textarea
          className="form-field__input"
          rows={3}
          value={section.lede}
          onChange={(e) => onChange({ ...section, lede: e.target.value })}
        />
      </label>
      <label className="form-field">
        <span className="form-field__label">Multi-record</span>
        <input
          type="checkbox"
          checked={section.multiRecord}
          onChange={(e) => onChange({ ...section, multiRecord: e.target.checked })}
        />
      </label>
      <label className="form-field">
        <span className="form-field__label">Order</span>
        <input
          className="form-field__input"
          type="number"
          value={section.order}
          onChange={(e) => onChange({ ...section, order: parseInt(e.target.value, 10) || section.order })}
        />
      </label>
      <div className="form-field">
        <span className="form-field__label">Readiness keys</span>
        <span className="form-field__hint">
          Space-separated protected systemKeys that must be filled for the section to be "ready".
        </span>
        <input
          className="form-field__input"
          type="text"
          value={section.readinessRule.requiredKeys.join(" ")}
          onChange={(e) => {
            const keys = e.target.value.split(/\s+/).filter(Boolean);
            onChange({ ...section, readinessRule: { requiredKeys: keys } });
          }}
        />
      </div>
    </div>
  );
}

interface GroupEditorProps {
  group: FieldGroup;
  onChange: (updated: FieldGroup) => void;
}

function GroupEditor({ group, onChange }: GroupEditorProps) {
  return (
    <div className="creator__editor-form">
      <h3 className="creator__editor-title">Group: {group.groupKey}</h3>
      <label className="form-field">
        <span className="form-field__label">Title</span>
        <input
          className="form-field__input"
          type="text"
          value={group.title}
          onChange={(e) => onChange({ ...group, title: e.target.value })}
        />
      </label>
      <label className="form-field">
        <span className="form-field__label">Repeatable</span>
        <input
          type="checkbox"
          checked={group.repeatable}
          onChange={(e) => onChange({ ...group, repeatable: e.target.checked })}
        />
      </label>
      <label className="form-field">
        <span className="form-field__label">Min records</span>
        <input
          className="form-field__input"
          type="number"
          value={group.minRecords ?? ""}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            onChange({ ...group, minRecords: isNaN(val) ? undefined : val });
          }}
        />
      </label>
      <label className="form-field">
        <span className="form-field__label">Order</span>
        <input
          className="form-field__input"
          type="number"
          value={group.order}
          onChange={(e) => onChange({ ...group, order: parseInt(e.target.value, 10) || group.order })}
        />
      </label>
    </div>
  );
}

interface FieldEditorProps {
  field: FieldDefinition;
  allFields: FieldDefinition[];
  onChange: (updated: FieldDefinition) => void;
}

function FieldEditor({ field, allFields, onChange }: FieldEditorProps) {
  const [optionInput, setOptionInput] = useState("");
  const systemKeyEditable = !field.protected;

  function addOption() {
    const trimmed = optionInput.trim();
    if (!trimmed) return;
    const [value, ...rest] = trimmed.split(":");
    const label = rest.length > 0 ? rest.join(":").trim() : trimmed;
    const newOption: FieldOption = { value: (value ?? trimmed).trim(), label: label.trim() };
    onChange({ ...field, options: [...(field.options ?? []), newOption] });
    setOptionInput("");
  }

  function removeOption(index: number) {
    onChange({ ...field, options: (field.options ?? []).filter((_, i) => i !== index) });
  }

  const visibleWhenField = field.visibleWhen
    ? ("equals" in field.visibleWhen ? field.visibleWhen.field : field.visibleWhen.field)
    : "";
  const visibleWhenValue = field.visibleWhen
    ? ("equals" in field.visibleWhen ? field.visibleWhen.equals : field.visibleWhen.oneOf.join(", "))
    : "";
  const visibleWhenMode = field.visibleWhen
    ? ("equals" in field.visibleWhen ? "equals" : "oneOf")
    : "equals";

  function updateVisibleWhen(
    controlField: string,
    value: string,
    mode: "equals" | "oneOf",
  ): VisibleWhen | undefined {
    if (!controlField || !value) return undefined;
    if (mode === "oneOf") {
      return { field: controlField, oneOf: value.split(",").map((v) => v.trim()).filter(Boolean) };
    }
    return { field: controlField, equals: value };
  }

  const isCustomKey = isCustomFieldKey(field.systemKey);

  return (
    <div className="creator__editor-form">
      <h3 className="creator__editor-title">Field: {field.systemKey}</h3>

      {isCustomKey && (
        <p className="creator__error">
          Custom-namespace fields may not appear in default packs. Remove the custom.* prefix.
        </p>
      )}

      <label className="form-field">
        <span className="form-field__label">System key</span>
        <input
          className="form-field__input"
          disabled={!systemKeyEditable}
          type="text"
          value={field.systemKey}
          onChange={(e) => onChange({ ...field, systemKey: e.target.value })}
        />
        {field.protected ? (
          <span className="form-field__hint">Protected fields have stable keys — rename requires an authored migration.</span>
        ) : null}
      </label>

      <label className="form-field">
        <span className="form-field__label">Label</span>
        <input
          className="form-field__input"
          type="text"
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
        />
      </label>

      <label className="form-field">
        <span className="form-field__label">Helper text</span>
        <input
          className="form-field__input"
          type="text"
          value={field.helperText ?? ""}
          onChange={(e) =>
            onChange({ ...field, helperText: e.target.value || undefined })
          }
        />
      </label>

      <label className="form-field">
        <span className="form-field__label">Type</span>
        <select
          className="form-field__input"
          value={field.type}
          onChange={(e) => onChange({ ...field, type: e.target.value as FieldType, options: field.options })}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      <label className="form-field">
        <span className="form-field__label">Required</span>
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => {
            const required = e.target.checked;
            // Protected fields must be required.
            if (!required && field.protected) return;
            onChange({ ...field, required });
          }}
        />
      </label>

      <label className="form-field">
        <span className="form-field__label">Protected</span>
        <input
          type="checkbox"
          checked={field.protected}
          onChange={(e) => {
            const protected_ = e.target.checked;
            onChange({
              ...field,
              protected: protected_,
              // Promoting to protected automatically sets required.
              required: protected_ ? true : field.required,
            });
          }}
        />
        <span className="form-field__hint">Protected fields appear in readiness rules; they can't be deleted without a migration.</span>
      </label>

      <label className="form-field">
        <span className="form-field__label">Order</span>
        <input
          className="form-field__input"
          type="number"
          value={field.order}
          onChange={(e) => onChange({ ...field, order: parseInt(e.target.value, 10) || field.order })}
        />
      </label>

      {field.type === "select" && (
        <div className="form-field">
          <span className="form-field__label">Options</span>
          <span className="form-field__hint">
            Format: <code>value:Label</code> (colon separates value from display label).
          </span>
          <ul className="creator__option-list">
            {(field.options ?? []).map((opt, i) => (
              <li key={opt.value} className="creator__option-item">
                <span>{opt.value}: {opt.label}</span>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => removeOption(i)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="creator__option-add">
            <input
              className="form-field__input"
              placeholder="value:Display Label"
              type="text"
              value={optionInput}
              onChange={(e) => setOptionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOption();
                }
              }}
            />
            <button className="button button--secondary button--small" type="button" onClick={addOption}>
              Add
            </button>
          </div>
        </div>
      )}

      <div className="form-field">
        <span className="form-field__label">Visible when (optional)</span>
        <span className="form-field__hint">
          Leave the controlling field blank to always show this field.
        </span>
        <div className="creator__visible-when">
          <input
            className="form-field__input creator__visible-when-field"
            list={`vw-fields-${field.systemKey}`}
            placeholder="Controlling field systemKey"
            type="text"
            value={visibleWhenField}
            onChange={(e) => {
              const updated = updateVisibleWhen(e.target.value, visibleWhenValue, visibleWhenMode);
              onChange({ ...field, visibleWhen: updated });
            }}
          />
          <datalist id={`vw-fields-${field.systemKey}`}>
            {allFields.filter((f) => f.systemKey !== field.systemKey).map((f) => (
              <option key={f.systemKey} value={f.systemKey} />
            ))}
          </datalist>
          <select
            className="form-field__input creator__visible-when-mode"
            value={visibleWhenMode}
            onChange={(e) => {
              const mode = e.target.value as "equals" | "oneOf";
              const updated = updateVisibleWhen(visibleWhenField, visibleWhenValue, mode);
              onChange({ ...field, visibleWhen: updated });
            }}
          >
            <option value="equals">equals</option>
            <option value="oneOf">one of</option>
          </select>
          <input
            className="form-field__input creator__visible-when-value"
            placeholder={visibleWhenMode === "equals" ? "exact value" : "val1, val2"}
            type="text"
            value={visibleWhenValue}
            onChange={(e) => {
              const updated = updateVisibleWhen(visibleWhenField, e.target.value, visibleWhenMode);
              onChange({ ...field, visibleWhen: updated });
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export interface CreatorModePageProps {
  initialPack: FormPack;
  onSave: (pack: FormPack) => void;
}

export function CreatorModePage({ initialPack, onSave }: CreatorModePageProps) {
  const [pack, setPack] = useState<FormPack>(initialPack);
  const [originalPack] = useState<FormPack>(initialPack);
  const [selection, setSelection] = useState<Selection>({ kind: "none", sectionKey: "" });
  const [previewValues, setPreviewValues] = useState<Record<string, SectionValues>>({});
  const [exportState, setExportState] = useState<"idle" | "success" | "error">("idle");
  const [exportErrors, setExportErrors] = useState<string[]>([]);
  const [exportJson, setExportJson] = useState("");
  const [migrationsJson, setMigrationsJson] = useState(
    () => JSON.stringify(initialPack.migrations, null, 2),
  );
  const [migrationsError, setMigrationsError] = useState("");

  // Resolve the selected section for the preview.
  const { resolved } = mergePackWithOverlay(pack);
  const previewSectionKey = selection.sectionKey || resolved.sections[0]?.sectionKey;
  const previewSection = resolved.sections.find((s) => s.sectionKey === previewSectionKey);
  const previewSectionValues =
    previewValues[previewSectionKey ?? ""] ??
    (previewSection ? syntheticSectionValues(previewSection) : undefined);

  // Collect all fields in the current section for visibleWhen autocomplete.
  const currentSection = selection.sectionKey
    ? pack.sections.find((s) => s.sectionKey === selection.sectionKey)
    : null;
  const allSectionFields: FieldDefinition[] = currentSection
    ? currentSection.groups.flatMap((g) => g.fields)
    : [];

  // -------------------------------------------------------------------------
  // Selection handlers
  // -------------------------------------------------------------------------

  function selectSection(sectionKey: string) {
    setSelection({ kind: "section", sectionKey });
  }

  function selectGroup(sectionKey: string, groupKey: string) {
    setSelection({ kind: "group", sectionKey, groupKey });
  }

  function selectField(sectionKey: string, groupKey: string, systemKey: string) {
    setSelection({ kind: "field", sectionKey, groupKey, systemKey });
  }

  // -------------------------------------------------------------------------
  // Pack mutation handlers
  // -------------------------------------------------------------------------

  function onSectionChange(updated: PackSection) {
    setPack((current) => ({
      ...current,
      sections: current.sections.map((s) => (s.sectionKey === updated.sectionKey ? updated : s)),
    }));
  }

  function onGroupChange(sectionKey: string, updated: FieldGroup) {
    setPack((current) => updateGroup(current, sectionKey, updated.groupKey, () => updated));
  }

  function onFieldChange(sectionKey: string, groupKey: string, updated: FieldDefinition) {
    setPack((current) => updateField(current, sectionKey, groupKey, updated.systemKey, () => updated));
    // Update selection to follow systemKey changes.
    if (selection.systemKey && selection.systemKey !== updated.systemKey) {
      setSelection({ ...selection, systemKey: updated.systemKey });
    }
  }

  function addSection() {
    const order = maxOrder(pack.sections) + 1;
    const key = `new-section-${order}`;
    const newSection: PackSection = {
      sectionKey: key,
      title: "New Section",
      lede: "",
      multiRecord: false,
      order,
      groups: [
        {
          groupKey: "main",
          title: "Main",
          repeatable: false,
          order: 1,
          fields: [
            {
              systemKey: "newField",
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
      kitMapping: { entries: [] },
    };
    setPack({ ...pack, sections: [...pack.sections, newSection] });
    setSelection({ kind: "section", sectionKey: key });
  }

  function addGroup(sectionKey: string) {
    setPack((current) => {
      const section = current.sections.find((s) => s.sectionKey === sectionKey);
      if (!section) return current;
      const order = maxOrder(section.groups) + 1;
      const groupKey = `group-${order}`;
      const newGroup: FieldGroup = {
        groupKey,
        title: "New Group",
        repeatable: false,
        order,
        fields: [
          {
            systemKey: `${sectionKey}NewField${order}`,
            label: "New Field",
            type: "text",
            required: false,
            protected: false,
            order: 1,
          },
        ],
      };
      return updateSection(current, sectionKey, (s) => ({
        ...s,
        groups: [...s.groups, newGroup],
      }));
    });
    setSelection({ kind: "group", sectionKey, groupKey: `group-${(currentSection ? maxOrder(currentSection.groups) : 0) + 1}` });
  }

  function addField(sectionKey: string, groupKey: string) {
    setPack((current) => {
      const section = current.sections.find((s) => s.sectionKey === sectionKey);
      const group = section?.groups.find((g) => g.groupKey === groupKey);
      if (!group) return current;
      const order = maxOrder(group.fields) + 1;
      const newField: FieldDefinition = {
        systemKey: `${groupKey}Field${order}`,
        label: "New Field",
        type: "text",
        required: false,
        protected: false,
        order,
      };
      return updateGroup(current, sectionKey, groupKey, (g) => ({
        ...g,
        fields: [...g.fields, newField],
      }));
    });
  }

  // -------------------------------------------------------------------------
  // Migrations JSON editor
  // -------------------------------------------------------------------------

  function applyMigrationsJson() {
    try {
      const parsed = JSON.parse(migrationsJson) as MigrationStep[];
      if (!Array.isArray(parsed)) {
        setMigrationsError("Migrations must be a JSON array.");
        return;
      }
      setPack({ ...pack, migrations: parsed });
      setMigrationsError("");
    } catch {
      setMigrationsError("Invalid JSON.");
    }
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  function handleExport() {
    const result = exportPack(pack, originalPack);
    if (!result.ok) {
      setExportState("error");
      setExportErrors(result.errors);
      setExportJson("");
      return;
    }
    setExportState("success");
    setExportErrors([]);
    setExportJson(result.json);
  }

  function handleSaveToVault() {
    if (!exportJson) return;
    const parsed = JSON.parse(exportJson) as FormPack;
    onSave(parsed);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const selectedPackSection =
    selection.sectionKey
      ? pack.sections.find((s) => s.sectionKey === selection.sectionKey)
      : null;
  const selectedGroup =
    selectedPackSection && selection.groupKey
      ? selectedPackSection.groups.find((g) => g.groupKey === selection.groupKey)
      : null;
  const selectedField =
    selectedGroup && selection.systemKey
      ? selectedGroup.fields.find((f) => f.systemKey === selection.systemKey)
      : null;

  return (
    <div className="creator">
      <header className="creator__header">
        <h1 className="creator__title">Pack Editor</h1>
        <span className="creator__badge">CREATOR MODE</span>
        <div className="creator__header-actions">
          <button className="button button--primary" type="button" onClick={handleExport}>
            Validate &amp; Export
          </button>
        </div>
      </header>

      <div className="creator__layout">
        {/* ---- Tree nav ---- */}
        <nav className="creator__nav" aria-label="Pack tree">
          <ul className="creator__tree">
            {[...pack.sections]
              .sort((a, b) => a.order - b.order)
              .map((section) => {
                const sectionActive = selection.sectionKey === section.sectionKey;
                return (
                  <li key={section.sectionKey} className="creator__tree-section">
                    <button
                      aria-current={sectionActive && selection.kind === "section" ? "true" : undefined}
                      className={`creator__tree-btn creator__tree-btn--section${sectionActive ? " creator__tree-btn--active" : ""}`}
                      type="button"
                      onClick={() => selectSection(section.sectionKey)}
                    >
                      {section.title}
                    </button>
                    {sectionActive && (
                      <ul className="creator__tree-groups">
                        {[...section.groups]
                          .sort((a, b) => a.order - b.order)
                          .map((group) => (
                            <li key={group.groupKey} className="creator__tree-group">
                              <button
                                aria-current={
                                  selection.kind === "group" && selection.groupKey === group.groupKey
                                    ? "true"
                                    : undefined
                                }
                                className={`creator__tree-btn creator__tree-btn--group${selection.groupKey === group.groupKey ? " creator__tree-btn--active" : ""}`}
                                type="button"
                                onClick={() => selectGroup(section.sectionKey, group.groupKey)}
                              >
                                {group.title}
                              </button>
                              <ul className="creator__tree-fields">
                                {[...group.fields]
                                  .sort((a, b) => a.order - b.order)
                                  .map((field) => (
                                    <li key={field.systemKey}>
                                      <button
                                        aria-current={
                                          selection.kind === "field" &&
                                          selection.systemKey === field.systemKey
                                            ? "true"
                                            : undefined
                                        }
                                        className={`creator__tree-btn creator__tree-btn--field${selection.systemKey === field.systemKey ? " creator__tree-btn--active" : ""}`}
                                        type="button"
                                        onClick={() =>
                                          selectField(section.sectionKey, group.groupKey, field.systemKey)
                                        }
                                      >
                                        {field.label}
                                        {field.protected ? " 🔒" : ""}
                                      </button>
                                    </li>
                                  ))}
                                <li>
                                  <button
                                    className="creator__tree-btn creator__tree-btn--add"
                                    type="button"
                                    onClick={() => addField(section.sectionKey, group.groupKey)}
                                  >
                                    + Field
                                  </button>
                                </li>
                              </ul>
                            </li>
                          ))}
                        <li>
                          <button
                            className="creator__tree-btn creator__tree-btn--add"
                            type="button"
                            onClick={() => addGroup(section.sectionKey)}
                          >
                            + Group
                          </button>
                        </li>
                      </ul>
                    )}
                  </li>
                );
              })}
            <li>
              <button
                className="creator__tree-btn creator__tree-btn--add"
                type="button"
                onClick={addSection}
              >
                + Section
              </button>
            </li>
          </ul>
        </nav>

        {/* ---- Property editor ---- */}
        <section className="creator__editor" aria-label="Property editor">
          {selection.kind === "field" && selectedField && selectedGroup ? (
            <FieldEditor
              field={selectedField}
              allFields={allSectionFields}
              onChange={(updated) =>
                onFieldChange(selection.sectionKey, selectedGroup.groupKey, updated)
              }
            />
          ) : selection.kind === "group" && selectedGroup ? (
            <GroupEditor
              group={selectedGroup}
              onChange={(updated) => onGroupChange(selection.sectionKey, updated)}
            />
          ) : selection.kind === "section" && selectedPackSection ? (
            <SectionEditor section={selectedPackSection} onChange={onSectionChange} />
          ) : (
            <p className="creator__editor-hint">
              Select a section, group, or field from the tree to edit its properties.
            </p>
          )}

          {/* ---- Migrations editor ---- */}
          <details className="creator__migrations" open={false}>
            <summary className="creator__migrations-summary">Migrations JSON</summary>
            <p className="creator__migrations-hint">
              Author renameField / retypeField / reduceCardinality / mapValue operations here.
              Changes here affect the entire pack, not just the selected section.
            </p>
            <textarea
              className="creator__migrations-textarea"
              rows={12}
              value={migrationsJson}
              onChange={(e) => setMigrationsJson(e.target.value)}
            />
            {migrationsError ? (
              <p className="creator__error">{migrationsError}</p>
            ) : null}
            <button
              className="button button--secondary button--small"
              type="button"
              onClick={applyMigrationsJson}
            >
              Apply migrations JSON
            </button>
          </details>
        </section>

        {/* ---- Live preview ---- */}
        <section className="creator__preview" aria-label="Live preview">
          <h2 className="creator__preview-title">Preview</h2>
          <div className="creator__preview-section-picker">
            <label htmlFor="preview-section-select" className="creator__preview-label">
              Section
            </label>
            <select
              className="form-field__input"
              id="preview-section-select"
              value={previewSectionKey}
              onChange={(e) => setSelection({ kind: "section", sectionKey: e.target.value })}
            >
              {resolved.sections.map((s) => (
                <option key={s.sectionKey} value={s.sectionKey}>{s.title}</option>
              ))}
            </select>
          </div>
          {previewSection && previewSectionValues ? (
            <FormRenderer
              section={previewSection}
              schemaVersion={pack.schemaVersion}
              values={previewSectionValues}
              onChange={(updated) =>
                setPreviewValues((prev) => ({
                  ...prev,
                  [previewSection.sectionKey]: updated,
                }))
              }
            />
          ) : (
            <p className="creator__preview-hint">Select a section to preview it here.</p>
          )}
        </section>
      </div>

      {/* ---- Export panel ---- */}
      {(exportState === "success" || exportState === "error") && (
        <section className="creator__export-panel" aria-labelledby="export-panel-heading">
          <h2 className="creator__export-title" id="export-panel-heading">
            {exportState === "success" ? "Export ready" : "Export blocked"}
          </h2>
          {exportState === "error" && (
            <ul className="creator__export-errors">
              {exportErrors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          )}
          {exportState === "success" && (
            <>
              <textarea
                aria-label="Exported pack JSON"
                className="creator__export-json"
                readOnly
                rows={16}
                value={exportJson}
              />
              <div className="creator__export-actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={handleSaveToVault}
                >
                  Save to vault
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(exportJson);
                  }}
                >
                  Copy JSON
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
