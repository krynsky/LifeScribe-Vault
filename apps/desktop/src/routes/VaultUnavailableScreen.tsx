import { useState } from "react";
import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { setVaultLocation } from "../api/vaultApi";
import { BrandLogo } from "../components/BrandLogo";

export interface VaultUnavailableScreenProps {
  vaultDir: string;
  onRetry: () => void;
  onRelocated: () => void;
}

/**
 * Shown when the recorded vault folder cannot be reached — an unplugged drive,
 * or a folder renamed or deleted outside the app.
 *
 * Deliberately NOT a silent fallback to the default folder: that would land
 * the user on first-run setup and read as total data loss when the vault is
 * in fact intact.
 */
export function VaultUnavailableScreen({ vaultDir, onRetry, onRelocated }: VaultUnavailableScreenProps) {
  const [error, setError] = useState("");

  async function handleChoose() {
    setError("");
    const chosen = await openFolderPicker({ directory: true, multiple: false });
    if (!chosen || typeof chosen !== "string") {
      return;
    }
    try {
      await setVaultLocation(chosen);
      onRelocated();
    } catch {
      setError("That folder can't be used. Pick one you can write to.");
    }
  }

  return (
    <main className="centered-screen">
      <section className="vault-panel" aria-labelledby="vault-unavailable-title">
        <BrandLogo className="brand-logo--panel" />
        <h1 className="vault-panel__title" id="vault-unavailable-title">
          Your vault folder can't be reached
        </h1>
        <p className="vault-panel__lede">
          Your vault is stored here, but this location isn't available right now.
          If it's on an external drive, reconnect it and retry. Nothing has been
          changed or deleted.
        </p>
        <p className="setup-location__path">{vaultDir}</p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="setup-nav">
          <button type="button" className="button button--primary" onClick={onRetry}>
            Retry
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void handleChoose()}
          >
            Choose folder…
          </button>
        </div>
      </section>
    </main>
  );
}
