/**
 * InlineFieldEditor — compact per-field editor for the form entry inline editor.
 *
 * Security contract:
 * - systemKey is NEVER shown or editable here (inline editor is user-facing).
 * - Protected fields cannot be removed and cannot have required unchecked.
 * - No expression strings, no custom JS — options are plain FieldOption objects.
 */

import { useState } from "react";
import type { FieldDefinition, FieldOption, FieldType } from "../../domain/formModel";
import { FIELD_TYPES } from "../../domain/formModel";

export interface InlineFieldEditorProps {
  field: FieldDefinition;
  onChange: (updated: FieldDefinition) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function InlineFieldEditor({
  field,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: InlineFieldEditorProps) {
  const [optionValue, setOptionValue] = useState("");
  const [optionLabel, setOptionLabel] = useState("");

  function handleLabelChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ ...field, label: e.target.value });
  }

  function handleHelperTextChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ ...field, helperText: e.target.value || undefined });
  }

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onChange({ ...field, type: e.target.value as FieldType });
  }

  function handleRequiredChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Protected fields must stay required — guard at the event level.
    if (!e.target.checked && field.protected) return;
    onChange({ ...field, required: e.target.checked });
  }

  function addOption() {
    const value = optionValue.trim();
    const label = optionLabel.trim();
    if (!value || !label) return;
    const newOption: FieldOption = { value, label };
    onChange({ ...field, options: [...(field.options ?? []), newOption] });
    setOptionValue("");
    setOptionLabel("");
  }

  function removeOption(index: number) {
    onChange({
      ...field,
      options: (field.options ?? []).filter((_, i) => i !== index),
    });
  }

  return (
    <div className="inline-field-editor">
      <div className="inline-field-editor__move-controls">
        <button
          aria-label="Move field up"
          className="button button--ghost button--small"
          type="button"
          onClick={onMoveUp}
        >
          ↑
        </button>
        <button
          aria-label="Move field down"
          className="button button--ghost button--small"
          type="button"
          onClick={onMoveDown}
        >
          ↓
        </button>
        {field.protected ? null : (
          <button
            aria-label="Remove field"
            className="button button--ghost button--small inline-field-editor__remove"
            type="button"
            onClick={onRemove}
          >
            ✕
          </button>
        )}
      </div>

      <div className="inline-field-editor__controls">
        <label className="form-field">
          <span className="form-field__label">Label</span>
          <input
            className="form-field__input"
            type="text"
            value={field.label}
            onChange={handleLabelChange}
          />
        </label>

        <label className="form-field">
          <span className="form-field__label">Helper text</span>
          <input
            className="form-field__input"
            type="text"
            value={field.helperText ?? ""}
            onChange={handleHelperTextChange}
          />
        </label>

        <label className="form-field">
          <span className="form-field__label">Type</span>
          <select
            className="form-field__input"
            value={field.type}
            onChange={handleTypeChange}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field form-field--inline">
          <input
            type="checkbox"
            checked={field.required}
            disabled={field.protected}
            onChange={handleRequiredChange}
          />
          <span className="form-field__label">Required</span>
        </label>

        {field.type === "select" && (
          <div className="form-field">
            <span className="form-field__label">Options</span>
            {(field.options ?? []).length > 0 && (
              <ul className="inline-field-editor__option-list">
                {(field.options ?? []).map((opt, i) => (
                  <li key={`${opt.value}-${i}`} className="inline-field-editor__option-item">
                    <span className="inline-field-editor__option-text">
                      <strong>{opt.value}</strong>: {opt.label}
                    </span>
                    <button
                      aria-label={`Remove option ${opt.label}`}
                      className="button button--ghost button--small"
                      type="button"
                      onClick={() => removeOption(i)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="inline-field-editor__option-add">
              <input
                aria-label="Option value"
                className="form-field__input"
                placeholder="value"
                type="text"
                value={optionValue}
                onChange={(e) => setOptionValue(e.target.value)}
              />
              <input
                aria-label="Option label"
                className="form-field__input"
                placeholder="Display label"
                type="text"
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
                className="button button--secondary button--small"
                type="button"
                onClick={addOption}
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
