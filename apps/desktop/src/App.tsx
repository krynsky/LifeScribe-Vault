/**
 * Top-level lock state machine (U5):
 *
 *     loading -> setup | locked | status-error
 *     setup --create--> dashboard
 *     locked --unlock--> dashboard
 *     dashboard --lock (manual / 15-min inactivity)--> locked
 *
 * The inactivity timer lives inside Dashboard, so it is structurally inert
 * on the setup and locked screens. The dirty-draft stash-then-lock sequence
 * is owned by Dashboard too (it holds the dirty state).
 */

import { useEffect, useState } from "react";
import {
  createVault,
  getVaultStatus,
  unlockVault,
  type VaultStatusResponse,
} from "./api/vaultApi";
import type { FormMode } from "./domain/snapshot";
import { Dashboard } from "./routes/Dashboard";
import { LockedScreen } from "./routes/LockedScreen";
import { SetupScreen } from "./routes/SetupScreen";

type AppScreen = "loading" | "setup" | "locked" | "dashboard" | "status-error";

function screenFromStatus(status: VaultStatusResponse): AppScreen {
  if (status.unlocked) {
    return "dashboard";
  }
  return status.vaultExists ? "locked" : "setup";
}

function App() {
  const [screen, setScreen] = useState<AppScreen>("loading");
  const [ownerNameHint, setOwnerNameHint] = useState("");
  const [formModeHint, setFormModeHint] = useState<FormMode>("hint");

  useEffect(() => {
    let isCurrent = true;
    async function loadInitialStatus() {
      try {
        const status = await getVaultStatus();
        if (isCurrent) {
          setScreen(screenFromStatus(status));
        }
      } catch {
        if (isCurrent) {
          setScreen("status-error");
        }
      }
    }
    void loadInitialStatus();
    return () => {
      isCurrent = false;
    };
  }, []);

  async function handleRetryStatus() {
    setScreen("loading");
    try {
      const status = await getVaultStatus();
      setScreen(screenFromStatus(status));
    } catch {
      setScreen("status-error");
    }
  }

  async function handleCreate(masterPassword: string, ownerName: string, formMode: FormMode) {
    const status = await createVault(masterPassword, ownerName);
    setOwnerNameHint(ownerName);
    setFormModeHint(formMode);
    setScreen(screenFromStatus(status));
  }

  async function handleUnlock(masterPassword: string) {
    const status = await unlockVault(masterPassword);
    setScreen(screenFromStatus(status));
  }

  if (screen === "loading") {
    return (
      <main className="centered-screen app-loading" aria-busy="true">
        <p className="app-loading__title">LifeScribe Vault</p>
        <p className="app-loading__hint">Preparing your vault…</p>
      </main>
    );
  }

  if (screen === "status-error") {
    return (
      <main className="centered-screen">
        <section className="vault-panel" aria-labelledby="status-error-title">
          <p className="vault-panel__eyebrow">LifeScribe Vault</p>
          <h1 className="vault-panel__title" id="status-error-title">
            Vault status unavailable
          </h1>
          <p className="form-error" role="alert">
            The vault status could not be loaded.
          </p>
          <p className="vault-panel__lede">
            The local vault could not be checked. Retry before entering a
            master password.
          </p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => void handleRetryStatus()}
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (screen === "setup") {
    return <SetupScreen onCreate={handleCreate} />;
  }

  if (screen === "locked") {
    return <LockedScreen onUnlock={handleUnlock} />;
  }

  return (
    <Dashboard ownerNameHint={ownerNameHint} formModeHint={formModeHint} onLocked={() => setScreen("locked")} />
  );
}

export default App;
