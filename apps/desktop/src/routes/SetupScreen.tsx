import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { getVaultStatus, setVaultLocation } from "../api/vaultApi";
import { BrandLogo } from "../components/BrandLogo";
import { masterPasswordLengthError } from "../domain/passwordPolicy";

export interface SetupScreenProps {
  onCreate: (masterPassword: string, ownerName: string) => Promise<void>;
  /** The chosen folder already holds a vault — hand off to the unlock screen. */
  onVaultFound: () => void;
}

/** Eye glyph; a slash is overlaid when the password is currently visible. */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <line x1="3" y1="3" x2="21" y2="21" /> : null}
    </svg>
  );
}

/** In-field button that toggles a password input between masked and visible. */
function RevealToggle({
  fieldLabel,
  shown,
  onToggle,
}: {
  fieldLabel: string;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="password-field__toggle"
      aria-label={`${shown ? "Hide" : "Show"} ${fieldLabel}`}
      aria-pressed={shown}
      onClick={onToggle}
    >
      <EyeIcon off={shown} />
    </button>
  );
}

const GUIDANCE_ID = "setup-password-guidance";
const ERROR_ID = "setup-error";

function createErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "VaultAlreadyExists") {
    return "A vault already exists on this computer. Unlock it with your master password instead.";
  }
  return "The vault could not be created. Check the details and try again.";
}

/**
 * First-run setup on a single screen: where the vault's data lives, the owner's
 * name, the master password (twice), and the "there is no recovery"
 * acknowledgment. Create vault is the only action.
 *
 * The folder control is read first, above the identity fields, so that a folder
 * already holding a vault is detected — and handed off to unlock the moment it
 * is chosen — before the user invests in typing and confirming a 15-character
 * master password.
 */
export function SetupScreen({ onCreate, onVaultFound }: SetupScreenProps) {
  const [ownerName, setOwnerName] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmMasterPassword, setConfirmMasterPassword] = useState("");
  const [acknowledgedNoRecovery, setAcknowledgedNoRecovery] = useState(false);
  const [revealMaster, setRevealMaster] = useState(false);
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [vaultDir, setVaultDir] = useState("");
  const [locationError, setLocationError] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    getVaultStatus()
      .then((status) => { if (isCurrent) setVaultDir(status.vaultDir); })
      .catch(() => { /* the screen still renders; Change folder remains usable */ });
    return () => { isCurrent = false; };
  }, []);

  const describedBy = error ? `${GUIDANCE_ID} ${ERROR_ID}` : GUIDANCE_ID;

  async function handleChooseFolder() {
    setLocationError("");
    const chosen = await openFolderPicker({ directory: true, multiple: false });
    if (!chosen || typeof chosen !== "string") return;
    try {
      const status = await setVaultLocation(chosen);
      setVaultDir(status.vaultDir);
      // A folder that already holds a vault is opened, never overwritten.
      if (status.vaultExists) onVaultFound();
    } catch {
      setLocationError("That folder can't be used. Pick one you can write to.");
    }
  }

  function validateIdentity(): boolean {
    const lengthError = masterPasswordLengthError(masterPassword);
    if (lengthError) {
      setError(lengthError);
      return false;
    }
    if (masterPassword !== confirmMasterPassword) {
      setError("The passwords don't match. Re-enter both before continuing.");
      return false;
    }
    if (!acknowledgedNoRecovery) {
      setError("Please confirm you understand the password cannot be reset.");
      return false;
    }
    return true;
  }

  async function handleCreate() {
    setError("");
    if (!validateIdentity()) return;
    setIsSubmitting(true);
    try {
      await onCreate(masterPassword, ownerName.trim());
    } catch (caught) {
      setError(createErrorMessage(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="centered-screen">
      <section className="vault-panel" aria-labelledby="setup-title">
        <BrandLogo className="brand-logo--panel" />
        <h1 className="vault-panel__title" id="setup-title">Let's set up your vault</h1>

        <div className="vault-form">
          <h2 className="setup-location__heading">Where your vault is stored</h2>
          <p className="setup-location__lede">
            Your encrypted vault lives in this folder. The default is fine for
            most people — choose another to keep it on an external drive or a
            folder you back up yourself.
          </p>
          <p className="setup-location__path">{vaultDir || "Loading…"}</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void handleChooseFolder()}
          >
            Change folder
          </button>
          {locationError ? <p className="form-error" role="alert">{locationError}</p> : null}

          <div className="vault-form__field">
            <label htmlFor="owner-name">Your name</label>
            <input id="owner-name" type="text" autoComplete="name" value={ownerName}
              onChange={(e) => setOwnerName(e.currentTarget.value)} />
          </div>
          <div className="vault-form__field">
            <label htmlFor="master-password">Master password</label>
            <div className="password-field">
              <input id="master-password" aria-describedby={describedBy} aria-invalid={error ? "true" : undefined}
                autoComplete="new-password" required spellCheck={false}
                type={revealMaster ? "text" : "password"} value={masterPassword}
                onChange={(e) => { setError(""); setMasterPassword(e.currentTarget.value); }} />
              <RevealToggle fieldLabel="master password" shown={revealMaster} onToggle={() => setRevealMaster((s) => !s)} />
            </div>
          </div>
          <div className="vault-form__field">
            <label htmlFor="confirm-master-password">Confirm master password</label>
            <div className="password-field">
              <input id="confirm-master-password" aria-describedby={describedBy} aria-invalid={error ? "true" : undefined}
                autoComplete="new-password" required spellCheck={false}
                type={revealConfirm ? "text" : "password"} value={confirmMasterPassword}
                onChange={(e) => { setError(""); setConfirmMasterPassword(e.currentTarget.value); }} />
              <RevealToggle fieldLabel="confirmation password" shown={revealConfirm} onToggle={() => setRevealConfirm((s) => !s)} />
            </div>
          </div>
          <ul className="vault-panel__guidance" id={GUIDANCE_ID}>
            <li>A long passphrase of a few unrelated words is strong and memorable.</li>
            <li>This vault never touches the cloud — nobody can reset the password for you.</li>
          </ul>
          <label className="checkbox-control checkbox-control--acknowledge">
            <input type="checkbox" checked={acknowledgedNoRecovery}
              onChange={(e) => { setError(""); setAcknowledgedNoRecovery(e.currentTarget.checked); }} />
            <span>I understand there is no recovery — this password cannot be reset, and losing it means losing access to the vault.</span>
          </label>
        </div>

        {error ? <p className="form-error" id={ERROR_ID} role="alert">{error}</p> : null}

        <div className="setup-nav">
          <button type="button" className="button button--primary"
            disabled={isSubmitting || !acknowledgedNoRecovery}
            onClick={() => void handleCreate()}>
            {isSubmitting ? "Creating your vault…" : "Create vault"}
          </button>
        </div>
      </section>
    </div>
  );
}
