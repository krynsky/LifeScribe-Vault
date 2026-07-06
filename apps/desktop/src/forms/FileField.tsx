import { useState } from "react";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { AttachmentViewer } from "../components/AttachmentViewer";
import { addAttachment, openAttachmentExternal } from "../api/vaultApi";
import type { AttachmentRef } from "../domain/valuesStore";

export interface FileFieldProps {
  fieldId: string;
  attachment: AttachmentRef | null;
  /** Called with the new ref after a file is attached (replaces any current). */
  onAttach: (ref: AttachmentRef) => void;
  /** Called after the current file is removed (value cleared, ref pulled). */
  onRemove: () => void;
}

// Remove/Replace never delete the ciphertext file here — the ref change lives
// only in unsaved working values at this point, and the SAVED snapshot may
// still point at the file (deleting now would break it if the user discards
// or the save conflicts). The Dashboard deletes dropped files after the save
// commits; never-saved files are cleaned by the unlock-time orphan sweep.

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileField({ fieldId, attachment, onAttach, onRemove }: FileFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(false);
  const [confirmExternal, setConfirmExternal] = useState(false);

  async function pickAndAttach() {
    setError("");
    const picked = await openFilePicker({ multiple: false, directory: false });
    if (typeof picked !== "string") return;
    setBusy(true);
    try {
      const ref = await addAttachment(picked);
      onAttach(ref);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!attachment) return;
    setError("");
    onRemove();
  }

  if (!attachment) {
    return (
      <div className="file-field" id={fieldId}>
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={busy}
          onClick={() => void pickAndAttach()}
        >
          Attach file
        </button>
        {error ? <span className="form-error" role="alert">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="file-field" id={fieldId}>
      <div className="file-field__meta">
        <span className="file-field__name">{attachment.fileName}</span>
        <span className="file-field__size">{humanSize(attachment.sizeBytes)}</span>
      </div>
      <div className="file-field__actions">
        <button type="button" className="button button--ghost button--small" onClick={() => setViewing(true)}>
          View
        </button>
        <button type="button" className="button button--ghost button--small" onClick={() => setConfirmExternal(true)}>
          Open externally
        </button>
        <button type="button" className="button button--ghost button--small" disabled={busy} onClick={() => void pickAndAttach()}>
          Replace
        </button>
        <button type="button" className="button button--ghost button--small" disabled={busy} onClick={remove}>
          Remove
        </button>
      </div>
      {error ? <span className="form-error" role="alert">{error}</span> : null}

      {viewing ? (
        <AttachmentViewer
          attachmentId={attachment.id}
          fileName={attachment.fileName}
          onClose={() => setViewing(false)}
        />
      ) : null}

      {confirmExternal ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm open externally">
          <div className="modal__body">
            <p>
              Opening externally decrypts this file to a temporary location on disk and launches
              your default app. The temp copy is deleted afterward. Continue?
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  setConfirmExternal(false);
                  void openAttachmentExternal(attachment.id, attachment.fileName).catch(
                    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
                  );
                }}
              >
                Open externally
              </button>
              <button type="button" className="button button--ghost" onClick={() => setConfirmExternal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
