import { useState } from "react";
import type {
  FieldDefinition,
  FieldOption,
  FieldType,
  PackSection,
  RecordReferenceDisplayField,
  RecordReferenceFormat,
} from "../../domain/formModel";
import { FIELD_TYPES, RECORD_REFERENCE_FORMATS } from "../../domain/formModel";
import {
  defaultRecordReference,
  recordReferenceSourceFields,
} from "../../domain/recordReferences";
import { uniqueOptionValue } from "./optionValue";

export interface FieldPropertyPanelProps {
  field: FieldDefinition | null;
  onChange: (updated: FieldDefinition) => void;
  /**
   * Whether this field counts toward its section's readiness (the dashboard
   * checklist and the Recovery Kit's default record label both key off this).
   * Omit both this and `onToggleReadinessAnchor` when the caller has no
   * section context to offer — the control is hidden rather than shown inert.
   */
  isReadinessAnchor?: boolean;
  onToggleReadinessAnchor?: () => void;
  /** Full pack context for declaratively configuring recordRef fields. */
  sections?: PackSection[];
  currentSectionKey?: string;
}

export function FieldPropertyPanel({
  field,
  onChange,
  isReadinessAnchor,
  onToggleReadinessAnchor,
  sections = [],
  currentSectionKey,
}: FieldPropertyPanelProps) {
  const [optionLabel, setOptionLabel] = useState("");

  if (!field) {
    return (
      <div className="field-panel field-panel--empty">
        <p>Select a field to edit its properties.</p>
      </div>
    );
  }

  function addOption() {
    const label = optionLabel.trim();
    if (!label) return;
    // The creator types only the display text; the stored value is a slug
    // generated from it, made unique against the field's existing values.
    const existingValues = (field!.options ?? []).map((option) => option.value);
    const next: FieldOption = { value: uniqueOptionValue(label, existingValues), label };
    onChange({ ...field!, options: [...(field!.options ?? []), next] });
    setOptionLabel("");
  }

  const referenceSourceSections = sections.filter(
    (section) => section.sectionKey !== currentSectionKey,
  );
  const referenceSource = referenceSourceSections.find(
    (section) => section.sectionKey === field.reference?.sectionKey,
  );
  const referenceSourceFields = referenceSource
    ? recordReferenceSourceFields(referenceSource)
    : [];

  function changeType(type: FieldType) {
    const next: FieldDefinition = { ...field!, type };
    if (type === "recordRef") {
      delete next.options;
      const source = referenceSourceSections[0];
      next.reference = defaultRecordReference(source);
    } else {
      delete next.reference;
      if (type === "select") {
        next.options = next.options ?? [];
      }
    }
    onChange(next);
  }

  function updateReferenceDisplayFields(displayFields: RecordReferenceDisplayField[]) {
    if (!field!.reference) return;
    onChange({
      ...field!,
      reference: { ...field!.reference, displayFields },
    });
  }

  return (
    <div className="field-panel">
      <label className="field-panel__control">
        <span>Label</span>
        <input
          type="text"
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
        />
      </label>

      <label className="field-panel__control">
        <span>Helper text</span>
        <textarea
          rows={3}
          value={field.helperText ?? ""}
          onChange={(e) =>
            onChange({ ...field, helperText: e.target.value || undefined })
          }
        />
      </label>

      <label className="field-panel__control">
        <span>Type</span>
        <select
          value={field.type}
          onChange={(e) => changeType(e.target.value as FieldType)}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="field-panel__check">
        <input
          type="checkbox"
          checked={field.required}
          disabled={field.protected}
          onChange={(e) => {
            if (!e.target.checked && field.protected) return;
            onChange({ ...field, required: e.target.checked });
          }}
        />
        <span>Required</span>
      </label>

      {onToggleReadinessAnchor ? (
        <div className="field-panel__anchor">
          <label className="field-panel__check">
            <input
              type="checkbox"
              checked={isReadinessAnchor ?? false}
              onChange={onToggleReadinessAnchor}
            />
            <span>Required for section readiness</span>
          </label>
          <p className="field-panel__note">
            The section shows "ready" on the dashboard once every field marked
            here has a value. Checking this also locks the field as required
            and un-removable; unchecking releases it back to an ordinary
            optional field.
          </p>
        </div>
      ) : null}

      {field.type === "select" ? (
        <div className="field-panel__options">
          <span className="field-panel__options-title">Options</span>
          {(field.options ?? []).length > 0 ? (
            <ul>
              {(field.options ?? []).map((opt, i) => (
                <li key={opt.value}>
                  <span>
                    <strong>{opt.label}</strong>
                    <span className="field-panel__option-value"> stored as {opt.value}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove option ${opt.label}`}
                    className="button button--ghost button--small"
                    onClick={() =>
                      onChange({
                        ...field,
                        options: (field.options ?? []).filter((_, j) => j !== i),
                      })
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="field-panel__option-add">
            <input
              type="text"
              aria-label="Value"
              placeholder="e.g. Checking account"
              value={optionLabel}
              onChange={(e) => setOptionLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOption();
                }
              }}
            />
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={addOption}
            >
              Add option
            </button>
          </div>
        </div>
      ) : null}

      {field.type === "recordRef" ? (
        <div className="field-panel__options">
          <span className="field-panel__options-title">Record source</span>
          <label className="field-panel__control">
            <span>Source section</span>
            <select
              value={field.reference?.sectionKey ?? ""}
              onChange={(event) => {
                const source = referenceSourceSections.find(
                  (candidate) => candidate.sectionKey === event.target.value,
                );
                const nextReference = defaultRecordReference(source);
                onChange({
                  ...field,
                  reference: nextReference
                    ? {
                        ...nextReference,
                        separator: field.reference?.separator ?? nextReference.separator,
                      }
                    : undefined,
                });
              }}
            >
              <option value="">Select a source section</option>
              {referenceSourceSections.map((section) => (
                <option key={section.sectionKey} value={section.sectionKey}>
                  {section.title}
                </option>
              ))}
            </select>
          </label>

          {referenceSource ? (
            <div className="field-panel__options">
              <span className="field-panel__options-title">Display fields</span>
              {referenceSourceFields.map((sourceField) => {
                const selectedIndex =
                  field.reference?.displayFields.findIndex(
                    (candidate) => candidate.systemKey === sourceField.systemKey,
                  ) ?? -1;
                const selected = selectedIndex >= 0;
                const displayField = selected
                  ? field.reference!.displayFields[selectedIndex]
                  : undefined;
                return (
                  <div className="field-panel__anchor" key={sourceField.systemKey}>
                    <label className="field-panel__check">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => {
                          if (!field.reference) return;
                          if (!event.target.checked) {
                            updateReferenceDisplayFields(
                              field.reference.displayFields.filter(
                                (candidate) => candidate.systemKey !== sourceField.systemKey,
                              ),
                            );
                            return;
                          }
                          updateReferenceDisplayFields(
                            [
                              ...field.reference.displayFields,
                              { systemKey: sourceField.systemKey },
                            ],
                          );
                        }}
                      />
                      <span>Include {sourceField.label}</span>
                    </label>
                    {selected && displayField ? (
                      <div className="field-panel__option-add">
                        <label className="field-panel__control">
                          <span className="sr-only">Format {sourceField.label}</span>
                          <select
                            aria-label={`Format ${sourceField.label}`}
                            value={displayField.format ?? "plain"}
                            onChange={(event) => {
                              const format = event.target.value as RecordReferenceFormat;
                              updateReferenceDisplayFields(
                                field.reference!.displayFields.map((candidate) =>
                                  candidate.systemKey === sourceField.systemKey
                                    ? {
                                        systemKey: candidate.systemKey,
                                        ...(format === "plain" ? {} : { format }),
                                      }
                                    : candidate,
                                ),
                              );
                            }}
                          >
                            {RECORD_REFERENCE_FORMATS.map((format) => (
                              <option key={format} value={format}>
                                {format === "last4" ? "Mask except last 4" : "Plain text"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          disabled={selectedIndex === 0}
                          onClick={() => {
                            const next = [...field.reference!.displayFields];
                            [next[selectedIndex - 1], next[selectedIndex]] = [
                              next[selectedIndex]!,
                              next[selectedIndex - 1]!,
                            ];
                            updateReferenceDisplayFields(next);
                          }}
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          disabled={selectedIndex === field.reference!.displayFields.length - 1}
                          onClick={() => {
                            const next = [...field.reference!.displayFields];
                            [next[selectedIndex], next[selectedIndex + 1]] = [
                              next[selectedIndex + 1]!,
                              next[selectedIndex]!,
                            ];
                            updateReferenceDisplayFields(next);
                          }}
                        >
                          Move down
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <label className="field-panel__control">
            <span>Separator</span>
            <input
              type="text"
              value={field.reference?.separator ?? " — "}
              onChange={(event) => {
                if (!field.reference) return;
                onChange({
                  ...field,
                  reference: { ...field.reference, separator: event.target.value },
                });
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
