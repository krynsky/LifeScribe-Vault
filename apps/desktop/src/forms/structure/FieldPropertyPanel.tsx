import { useState } from "react";
import type { FieldDefinition, FieldOption, FieldType } from "../../domain/formModel";
import { FIELD_TYPES } from "../../domain/formModel";
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
}

export function FieldPropertyPanel({
  field,
  onChange,
  isReadinessAnchor,
  onToggleReadinessAnchor,
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
    </div>
  );
}
