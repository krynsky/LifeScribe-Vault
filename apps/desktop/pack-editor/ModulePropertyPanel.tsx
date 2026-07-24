import type { FormModule } from "../src/domain/formModel";

export interface ModulePropertyPanelProps {
  module: FormModule;
  onChangeDetails: (patch: Partial<Pick<FormModule, "title" | "question" | "helperText">>) => void;
  onChangeOptionLabel: (optionId: string, label: string) => void;
  onSetDefaultOption: (optionId: string) => void;
  onAddOption: () => void;
  onRemoveOption: (optionId: string) => void;
  onClose: () => void;
}

/**
 * Edits a module's title/question/helperText and its options (label, which
 * one is the default, add/remove). All mutation logic lives in editorEdits.ts
 * — this panel only dispatches intents, so the "never drop below two options
 * / never orphan defaultOptionId" gating lives in one place. The Remove
 * button is only rendered when removal is actually actionable (module has
 * more than two options) — an enabled-but-no-op control is exactly the bug
 * class this branch has hit repeatedly.
 */
export function ModulePropertyPanel({
  module,
  onChangeDetails,
  onChangeOptionLabel,
  onSetDefaultOption,
  onAddOption,
  onRemoveOption,
  onClose,
}: ModulePropertyPanelProps) {
  const canRemoveOption = module.options.length > 2;

  return (
    <div className="module-panel">
      <div className="module-panel__header">
        <h3>{`Edit module: ${module.title}`}</h3>
        <button type="button" className="button button--ghost button--small" onClick={onClose}>
          Done
        </button>
      </div>

      <label className="field-panel__control">
        <span>Module title</span>
        <input
          type="text"
          value={module.title}
          onChange={(e) => onChangeDetails({ title: e.target.value })}
        />
      </label>

      <label className="field-panel__control">
        <span>Question</span>
        <input
          type="text"
          value={module.question}
          onChange={(e) => onChangeDetails({ question: e.target.value })}
        />
      </label>

      <label className="field-panel__control">
        <span>Helper text</span>
        <textarea
          rows={3}
          value={module.helperText ?? ""}
          onChange={(e) => onChangeDetails({ helperText: e.target.value || undefined })}
        />
      </label>

      <div className="module-panel__options">
        <span className="field-panel__options-title">Options</span>
        <ul>
          {module.options.map((option) => (
            <li key={option.optionId}>
              <input
                type="radio"
                name={`default-option-${module.moduleId}`}
                aria-label={`Set ${option.label ?? option.optionId} as default`}
                checked={module.defaultOptionId === option.optionId}
                onChange={() => onSetDefaultOption(option.optionId)}
              />
              <input
                type="text"
                aria-label={`Label for option ${option.optionId}`}
                value={option.label ?? ""}
                onChange={(e) => onChangeOptionLabel(option.optionId, e.target.value)}
              />
              {canRemoveOption ? (
                <button
                  type="button"
                  className="button button--ghost button--small"
                  aria-label={`Remove option ${option.label ?? option.optionId}`}
                  onClick={() => onRemoveOption(option.optionId)}
                >
                  ✕
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <button type="button" className="button button--secondary button--small" onClick={onAddOption}>
          + Add option
        </button>
      </div>
    </div>
  );
}
