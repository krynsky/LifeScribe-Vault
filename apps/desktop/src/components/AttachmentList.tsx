/**
 * Attachment list for a section record (U8).
 *
 * - "Add file" opens the OS file picker (Tauri dialog), encrypts the chosen
 *   file via `addAttachment`, and notifies the parent to embed the ref in the
 *   record before the next snapshot save.
 * - Delete removes the ciphertext file via `deleteAttachment` and notifies
 *   the parent to drop the ref from the record.
 * - No in-app viewer: the plan defers "export decrypted copy" behind the
 *   export security decision.
 *
 * All vault-value copies go through `copyVaultValue` (clipboard hygiene);
 * `navigator.clipboard.writeText` is banned for vault content.
 */

import { useState } from "react";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import {
  addAttachment,
  deleteAttachment,
  type AttachmentRefResponse,
} from "../api/vaultApi";
import type { AttachmentRef } from "../domain/valuesStore";

export interface AttachmentListProps {
  attachments: AttachmentRef[];
  /** Called after adding — parent must embed the new ref in the record and save. */
  onAdd: (ref: AttachmentRef) => void;
  /** Called after deleting — parent must remove the ref and save. */
  onDelete: (attachmentId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentList({ attachments, onAdd, onDelete }: AttachmentListProps) {
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleAdd() {
    setAddError(null);
    const path = await openFilePicker({ multiple: false, directory: false });
    if (!path) return;
    const sourcePath = typeof path === "string" ? path : null;
    if (!sourcePath) return;

    setAdding(true);
    try {
      const ref: AttachmentRefResponse = await addAttachment(sourcePath);
      onAdd({ id: ref.id, fileName: ref.fileName, sizeBytes: ref.sizeBytes });
    } catch {
      setAddError("Could not add the file. Make sure the vault is unlocked and the file is readable.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!pendingDeleteId) return;
    setDeleting(true);
    try {
      await deleteAttachment(pendingDeleteId);
      onDelete(pendingDeleteId);
    } catch {
      // File may already be gone — treat as success so the ref can be removed.
      onDelete(pendingDeleteId);
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  }

  const pendingName =
    pendingDeleteId != null
      ? (attachments.find((a) => a.id === pendingDeleteId)?.fileName ?? "this file")
      : null;

  return (
    <div className="attachment-list">
      {attachments.length > 0 && (
        <ul className="attachment-list__items" role="list">
          {attachments.map((att) => (
            <li key={att.id} className="attachment-list__item">
              <span className="attachment-list__icon" aria-hidden>📎</span>
              <span className="attachment-list__name">{att.fileName}</span>
              <span className="attachment-list__size">{formatBytes(att.sizeBytes)}</span>
              <button
                type="button"
                className="attachment-list__delete"
                aria-label={`Remove ${att.fileName}`}
                onClick={() => setPendingDeleteId(att.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {pendingDeleteId && (
        <div className="attachment-list__confirm" role="alertdialog" aria-modal="true">
          <p>Remove <strong>{pendingName}</strong>? This cannot be undone.</p>
          <div className="attachment-list__confirm-actions">
            <button
              type="button"
              className="btn btn--danger"
              onClick={handleDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? "Removing…" : "Remove"}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setPendingDeleteId(null)}
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {addError && (
        <p className="attachment-list__error" role="alert">{addError}</p>
      )}

      <button
        type="button"
        className="btn btn--secondary attachment-list__add"
        onClick={handleAdd}
        disabled={adding}
      >
        {adding ? "Adding…" : "Add file"}
      </button>
    </div>
  );
}
