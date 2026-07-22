import { useState } from "react";
import { open as openPicker } from "@tauri-apps/plugin-dialog";

export interface PathFieldProps {
  fieldId: string;
  /** The stored path string (folder or file). */
  value: string;
  describedBy?: string;
  onChange: (value: string) => void;
}

/**
 * A filesystem-path field: an editable text input plus native "Choose folder…"
 * / "Choose file…" buttons that open the OS picker and populate the path.
 *
 * Only the chosen PATH STRING is captured — no bytes are read from the folder
 * or file and nothing is copied into the vault (unlike FileField, which
 * encrypts an attachment). The text input stays editable so a path can be
 * corrected or pasted by hand, and so the field degrades to plain text when the
 * native picker is unavailable (web/test environments).
 */
export function PathField({ fieldId, value, describedBy, onChange }: PathFieldProps) {
  const [error, setError] = useState("");

  async function browse(directory: boolean) {
    setError("");
    try {
      const picked = await openPicker({ directory, multiple: false });
      if (typeof picked === "string") {
        onChange(picked);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="path-field">
      <div className="path-field__row">
        <input
          className="field__control"
          id={fieldId}
          type="text"
          value={value}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="path-field__actions">
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => void browse(true)}
          >
            Choose folder…
          </button>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => void browse(false)}
          >
            Choose file…
          </button>
        </div>
      </div>
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
