/**
 * InlineGroupControls — group-level controls rendered above a field list
 * in the inline form editor. Purely presentational.
 */

export interface InlineGroupControlsProps {
  groupTitle: string;
  repeatable: boolean;
  onAddField: () => void;
  onGroupTitleChange: (title: string) => void;
}

export function InlineGroupControls({
  groupTitle,
  repeatable,
  onAddField,
  onGroupTitleChange,
}: InlineGroupControlsProps) {
  return (
    <div className="inline-group-controls">
      <label className="form-field form-field--inline">
        <span className="form-field__label">Group title</span>
        <input
          className="form-field__input"
          type="text"
          value={groupTitle}
          onChange={(e) => onGroupTitleChange(e.target.value)}
        />
      </label>

      {repeatable && (
        <span className="inline-group-controls__repeatable-badge">Repeatable</span>
      )}

      <button
        aria-label={`Add field to ${groupTitle}`}
        className="button button--secondary button--small"
        type="button"
        onClick={onAddField}
      >
        + Add field
      </button>
    </div>
  );
}
