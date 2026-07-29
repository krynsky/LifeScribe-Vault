import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { checkVaultLocation } from "../../api/vaultApi";

export interface VaultLocationProps {
  vaultDir: string;
  /** Locks the vault, moves the data, and lands on the locked screen. */
  onRelocate: (dir: string) => Promise<void>;
}

/**
 * Turn a relocation error code into something the user can act on.
 *
 * The generic fallback is deliberately last: every code the move can refuse
 * with names a fixable mistake, and flattening them all into "could not be
 * moved" leaves the user guessing.
 */
function relocateErrorMessage(code: string): string {
  switch (code) {
    case "InvalidVaultLocation":
      return "That folder is inside — or contains — the folder your vault is in now. Pick a folder outside it.";
    case "VaultAlreadyExists":
      return "That folder already holds a vault. Moving there would overwrite it.";
    case "RestoreConflict":
      return "Finish or roll back the restore in progress before moving the vault.";
    default:
      return "That folder can't be used. Pick one you can write to.";
  }
}

/**
 * Settings section showing where vault data lives, with a move action.
 *
 * The chosen folder is validated BEFORE anything locks. The move itself needs a
 * locked vault (no save may be in flight during the copy), and that costs a
 * password re-entry — so a folder mistake must be caught while the user is
 * still here in Settings, with an error naming the actual problem.
 */
export function VaultLocation({ vaultDir, onRelocate }: VaultLocationProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleChoose() {
    const chosen = await openFolderPicker({ directory: true, multiple: false });
    if (!chosen || typeof chosen !== "string") return;
    setError("");
    setBusy(true);
    try {
      await checkVaultLocation(chosen);
      setPending(chosen);
    } catch (caught) {
      setError(relocateErrorMessage(caught instanceof Error ? caught.message : String(caught)));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await onRelocate(pending);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Vault location</h2>
      <p className="settings-section__lede">
        Your encrypted vault and its attachments live here.
      </p>
      <p className="setup-location__path">{vaultDir}</p>

      {pending ? (
        <div className="settings-confirm" role="alertdialog" aria-label="Confirm vault move">
          <p>
            Move your vault to <strong>{pending}</strong>? This will lock the
            vault, so you&rsquo;ll enter your master password again afterwards.
            Nothing is deleted from the old folder until the move is verified.
          </p>
          <div className="settings-confirm__actions">
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary button--small"
              disabled={busy}
              onClick={() => void handleConfirm()}
            >
              {busy ? "Moving…" : "Move and lock"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="button button--secondary"
          disabled={busy}
          onClick={() => void handleChoose()}
        >
          Move vault…
        </button>
      )}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
