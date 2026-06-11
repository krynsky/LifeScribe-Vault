import type { ReactNode } from "react";

export interface FieldProps {
  /** id of the form control inside `children`; the label points at it. */
  fieldId: string;
  label: string;
  helperText?: string;
  /** Inline validation message; rendered in the error slot when present. */
  error?: string;
  children: ReactNode;
}

/**
 * Label + helper-text + error wrapper around a single form control.
 *
 * All strings (label, helper text, error) render as text nodes only — a
 * hostile pack label containing markup must stay inert.
 */
export function Field({ fieldId, label, helperText, error, children }: FieldProps) {
  return (
    <div className={error ? "field field--error" : "field"}>
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      {children}
      {helperText ? (
        <p className="field__hint" id={`${fieldId}-hint`}>
          {helperText}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
