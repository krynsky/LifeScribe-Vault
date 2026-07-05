import { useState } from "react";
import type { FieldDefinition, FieldOption, FieldType } from "../src/domain/formModel";
import { FIELD_TYPES } from "../src/domain/formModel";

export interface FieldPropertyPanelProps {
  field: FieldDefinition | null;
  onChange: (updated: FieldDefinition) => void;
}

export function FieldPropertyPanel({ field, onChange }: FieldPropertyPanelProps) {
  const [optionValue, setOptionValue] = useState("");
  const [optionLabel, setOptionLabel] = useState("");

  if (!field) {
    return (
      <div className="field-panel field-panel--empty">
        <p>Select a field to edit its properties.</p>
      </div>
    );
  }

  function addOption() {
    const value = optionValue.trim();
    const label = optionLabel.trim();
    if (!value || !label) return;
    const next: FieldOption = { value, label };
    onChange({ ...field!, options: [...(field!.options ?? []), next] });
    setOptionValue("");
    setOptionLabel("");
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
          onChange={(e) => onChange({ ...field, type: e.target.value as FieldType })}
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

      {field.type === "select" ? (
        <div className="field-panel__options">
          <span className="field-panel__options-title">Options</span>
          {(field.options ?? []).length > 0 ? (
            <ul>
              {(field.options ?? []).map((opt, i) => (
                <li key={opt.value}>
                  <span>
                    <strong>{opt.value}</strong>: {opt.label}
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
              aria-label="Option value"
              placeholder="value"
              value={optionValue}
              onChange={(e) => setOptionValue(e.target.value)}
            />
            <input
              type="text"
              aria-label="Option label"
              placeholder="Display label"
              value={optionLabel}
              onChange={(e) => setOptionLabel(e.target.value)}
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
    </div>
  );
}
