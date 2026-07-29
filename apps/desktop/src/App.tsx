/**
 * Top-level lock state machine (U5):
 *
 *     loading -> setup | locked | status-error | vault-unavailable
 *     vault-unavailable --retry / choose folder--> loading
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
  saveVaultSnapshot,
  unlockVault,
  type VaultStatusResponse,
} from "./api/vaultApi";
import { buildSnapshot, emptySnapshot } from "./domain/snapshot";
import { Dashboard } from "./routes/Dashboard";
import { LockedScreen } from "./routes/LockedScreen";
import { SetupScreen } from "./routes/SetupScreen";
import { VaultUnavailableScreen } from "./routes/VaultUnavailableScreen";

type AppScreen = "loading" | "setup" | "locked" | "dashboard" | "status-error" | "vault-unavailable";

function screenFromStatus(status: VaultStatusResponse): AppScreen {
  // An unreachable folder takes precedence over every other state: falling
  // back to the default folder would show first-run setup to a user whose
  // vault is intact but disconnected.
  if (!status.vaultDirAvailable) {
    return "vault-unavailable";
  }
  if (status.unlocked) {
    return "dashboard";
  }
  return status.vaultExists ? "locked" : "setup";
}

function App() {
  const [screen, setScreen] = useState<AppScreen>("loading");
  const [ownerNameHint, setOwnerNameHint] = useState("");
  const [moduleSelectionsHint, setModuleSelectionsHint] = useState<Record<string, string>>({ secrets: "off" });
  // One-off explanation for a lock the user did not ask for directly (a vault
  // move locks as a precondition). Cleared on the next successful unlock so it
  // never outlives the event it describes.
  const [lockNotice, setLockNotice] = useState("");
  // Recorded so the unavailable-folder screen can name the folder it cannot reach.
  const [vaultDir, setVaultDir] = useState("");

  useEffect(() => {
    let isCurrent = true;
    async function loadInitialStatus() {
      try {
        const status = await getVaultStatus();
        if (isCurrent) {
          setVaultDir(status.vaultDir);
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
      setVaultDir(status.vaultDir);
      setScreen(screenFromStatus(status));
    } catch {
      setScreen("status-error");
    }
  }

  async function handleCreate(masterPassword: string, ownerName: string, moduleSelections: Record<string, string>) {
    const status = await createVault(masterPassword, ownerName);
    setOwnerNameHint(ownerName);
    setModuleSelectionsHint(moduleSelections);
    // The Form Editor preference persists in localStorage (app-global, not
    // vault-scoped). A freshly created vault must start with it OFF, so clear
    // any flag left over from a previous vault on this machine.
    localStorage.removeItem("lifescribe.packEditorEnabled");
    // Persist the onboarding choices (owner name + module selections) into an
    // initial generation-0 snapshot so they survive a relaunch even before any
    // data is entered. Best-effort: createVault has already succeeded, so a
    // failure here must not block reaching the vault — moduleSelectionsHint still
    // carries the choice for this session and the first data save will persist it.
    try {
      await saveVaultSnapshot(buildSnapshot(emptySnapshot(ownerName, moduleSelections)), 0);
    } catch {
      // Non-fatal: the vault exists; the selections are held in
      // moduleSelectionsHint until the first save writes them.
    }
    setScreen(screenFromStatus(status));
  }

  async function handleUnlock(masterPassword: string) {
    const status = await unlockVault(masterPassword);
    setLockNotice("");
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

  if (screen === "vault-unavailable") {
    return (
      <VaultUnavailableScreen
        vaultDir={vaultDir}
        onRetry={() => void handleRetryStatus()}
        onRelocated={() => void handleRetryStatus()}
      />
    );
  }

  if (screen === "setup") {
    return <SetupScreen onCreate={handleCreate} onVaultFound={() => setScreen("locked")} />;
  }

  if (screen === "locked") {
    return <LockedScreen onUnlock={handleUnlock} notice={lockNotice} />;
  }

  return (
    <Dashboard
      ownerNameHint={ownerNameHint}
      moduleSelectionsHint={moduleSelectionsHint}
      onLocked={(notice) => {
        setLockNotice(notice ?? "");
        setScreen("locked");
      }}
    />
  );
}

export default App;
