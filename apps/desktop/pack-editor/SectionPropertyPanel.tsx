import { useState } from "react";
import type { PackSection } from "../src/domain/formModel";

/**
 * The subset of PackSection this panel edits. Deliberately a plain, narrow
 * type (not EditorViewSection) — callers build it by picking exactly these
 * three fields off the view section, so the view-only `source`/`removed`
 * keys and the section's `groups` can never ride along into `onChange` and
 * leak into the persisted pack (mirrors the stripViewKeys pattern used for
 * fields in OverlayDesign.tsx).
 */
export type SectionProperties = Pick<PackSection, "title" | "lede" | "multiRecord">;

export interface SectionPropertyPanelProps {
  section: SectionProperties;
  onChange: (updated: SectionProperties) => void;
  /** If provided, a Remove section button with two-step confirm is shown. */
  onRemove?: () => void;
}

/** Edits a section's title/lede/multiRecord. Mirrors FieldPropertyPanel's shape. */
export function SectionPropertyPanel({ section, onChange, onRemove }: SectionPropertyPanelProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="field-panel">
      <label className="field-panel__control">
        <span>Section title</span>
        <input
          type="text"
          value={section.title}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
        />
      </label>

      <label className="field-panel__control">
        <span>Lede</span>
        <textarea
          rows={3}
          value={section.lede}
          onChange={(e) => onChange({ ...section, lede: e.target.value })}
        />
      </label>

      <label className="field-panel__check">
        <input
          type="checkbox"
          checked={section.multiRecord}
          onChange={(e) => onChange({ ...section, multiRecord: e.target.checked })}
        />
        <span>Allows multiple records</span>
      </label>

      {onRemove ? (
        <div className="module-panel__footer">
          {confirming ? (
            <div className="module-panel__confirm" role="alert">
              <p>Remove section <strong>{section.title}</strong>? This cannot be undone until you close the editor without saving.</p>
              <div className="module-panel__confirm-actions">
                <button
                  type="button"
                  className="button button--ghost button--small"
                  aria-label={`Cancel remove section ${section.title}`}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button--small module-panel__delete"
                  aria-label={`Confirm remove section ${section.title}`}
                  onClick={onRemove}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="button button--ghost button--small module-panel__delete"
              aria-label={`Remove section ${section.title}`}
              onClick={() => setConfirming(true)}
            >
              Remove section
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
