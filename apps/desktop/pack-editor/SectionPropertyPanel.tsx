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
}

/** Edits a section's title/lede/multiRecord. Mirrors FieldPropertyPanel's shape. */
export function SectionPropertyPanel({ section, onChange }: SectionPropertyPanelProps) {
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
    </div>
  );
}
