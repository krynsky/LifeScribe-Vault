import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

export interface VaultLocationProps {
  vaultDir: string;
  /** Locks the vault, moves the data, and lands on the locked screen. */
  onRelocate: (dir: string) => Promise<void>;
}

/**
 * Settings section showing where vault data lives, with a move action.
 *
 * Moving requires a locked vault (no save may be in flight during the copy),
 * so the confirmation states that cost up front rather than surprising the
 * user with a password prompt afterwards.
 */
export function VaultLocation({ vaultDir, onRelocate }: VaultLocationProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleChoose() {
    const chosen = await openFolderPicker({ directory: true, multiple: false });
    if (!chosen || typeof chosen !== "string") return;
    setPending(chosen);
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
          onClick={() => void handleChoose()}
        >
          Move vault…
        </button>
      )}
    </section>
  );
}
