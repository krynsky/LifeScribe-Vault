import type { FormModule } from "../domain/formModel";

export interface ModuleQuestionProps {
  module: FormModule;
  selected: string;
  onChange: (optionId: string) => void;
}

/**
 * Presentational render of one onboarding module as a labelled radio group.
 * Pure — no composition or persistence. Shared by the setup wizard and the
 * Settings "Vault options" section.
 */
export function ModuleQuestion({ module, selected, onChange }: ModuleQuestionProps) {
  return (
    <fieldset className="module-question">
      <legend className="module-question__title">{module.title}</legend>
      <p className="module-question__prompt">{module.question}</p>
      {module.helperText ? (
        <p className="module-question__help">{module.helperText}</p>
      ) : null}
      <div className="module-question__options">
        {module.options.map((option) => {
          const label = option.label ?? option.optionId;
          return (
            <label key={option.optionId} className="module-question__option">
              <input
                type="radio"
                name={`module-${module.moduleId}`}
                value={option.optionId}
                checked={selected === option.optionId}
                onChange={() => onChange(option.optionId)}
              />
              <span className="module-question__option-label">{label}</span>
              {option.description ? (
                <span className="module-question__option-desc">{option.description}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
