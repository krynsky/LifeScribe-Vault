import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { getVaultStatus, setVaultLocation } from "../api/vaultApi";
import type { FormModule, FormPack } from "../domain/formModel";
import { loadDefaultPack } from "../domain/loadDefaultPack";
import { useComposedPreview } from "../domain/useComposedPreview";
import { ModuleQuestion } from "../forms/ModuleQuestion";

export interface SetupScreenProps {
  onCreate: (masterPassword: string, ownerName: string, moduleSelections: Record<string, string>) => Promise<void>;
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

const MIN_MASTER_PASSWORD_LENGTH = 15;
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
 * First-run setup as a stepped wizard: step 0 chooses where the vault's data
 * lives; step 1 collects name + master password + the "there is no recovery"
 * acknowledgment; steps 2..N+1 present one onboarding module question each
 * (defaults pre-selected). The final step creates the vault, emitting the
 * module selections map. A combination the pack rejects blocks Create
 * (composeError) rather than failing silently at load.
 *
 * The folder step comes first so that a folder already holding a vault is
 * detected — and handed off to unlock — before the user invests in typing and
 * confirming a 15-character master password.
 */
export function SetupScreen({ onCreate, onVaultFound }: SetupScreenProps) {
  const [base, setBase] = useState<FormPack | null>(null);
  const [step, setStep] = useState(0);
  const [ownerName, setOwnerName] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmMasterPassword, setConfirmMasterPassword] = useState("");
  const [acknowledgedNoRecovery, setAcknowledgedNoRecovery] = useState(false);
  const [revealMaster, setRevealMaster] = useState(false);
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [vaultDir, setVaultDir] = useState("");
  const [locationError, setLocationError] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modules = useMemo(() => [...(base?.modules ?? [])].sort((a, b) => a.order - b.order), [base]);
  const composeError = useComposedPreview(base, selections).error;

  useEffect(() => {
    let isCurrent = true;
    loadDefaultPack()
      .then((pack) => {
        if (!isCurrent) return;
        setBase(pack);
        setSelections(Object.fromEntries((pack.modules ?? []).map((m) => [m.moduleId, m.defaultOptionId])));
      })
      .catch(() => { /* preview/steps degrade to identity-only */ });
    return () => { isCurrent = false; };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    getVaultStatus()
      .then((status) => { if (isCurrent) setVaultDir(status.vaultDir); })
      .catch(() => { /* the step still renders; Change folder remains usable */ });
    return () => { isCurrent = false; };
  }, []);

  const describedBy = error ? `${GUIDANCE_ID} ${ERROR_ID}` : GUIDANCE_ID;
  const lastStep = modules.length + 1;
  const currentModule: FormModule | undefined = step > 1 ? modules[step - 2] : undefined;

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
    if (masterPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
      setError(`Use a master password with at least ${MIN_MASTER_PASSWORD_LENGTH} characters — a few unrelated words work well.`);
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

  function goNext() {
    setError("");
    if (step === 1 && !validateIdentity()) return;
    setStep((s) => Math.min(s + 1, lastStep));
  }
  function goBack() {
    setError("");
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleCreate() {
    setError("");
    if (!validateIdentity()) { setStep(1); return; }
    setIsSubmitting(true);
    try {
      await onCreate(masterPassword, ownerName.trim(), selections);
    } catch (caught) {
      setError(createErrorMessage(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  const onFinalStep = step === lastStep;

  return (
    <div className="centered-screen">
      <section className="vault-panel" aria-labelledby="setup-title">
        <p className="vault-panel__eyebrow">LifeScribe Vault</p>
        <h1 className="vault-panel__title" id="setup-title">Let's set up your vault</h1>

        <ol className="setup-steps" aria-label={`Step ${step + 1} of ${modules.length + 2}`}>
          {Array.from({ length: modules.length + 2 }, (_, i) => (
            <li key={i} className={i === step ? "setup-steps__dot setup-steps__dot--current" : "setup-steps__dot"} />
          ))}
        </ol>

        {step === 0 ? (
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
          </div>
        ) : step === 1 ? (
          <div className="vault-form">
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
        ) : currentModule ? (
          <div className="vault-form">
            <ModuleQuestion
              module={currentModule}
              selected={selections[currentModule.moduleId] ?? currentModule.defaultOptionId}
              onChange={(optionId) => setSelections((prev) => ({ ...prev, [currentModule.moduleId]: optionId }))}
            />
          </div>
        ) : null}

        {error ? <p className="form-error" id={ERROR_ID} role="alert">{error}</p> : null}

        <div className="setup-nav">
          {step > 0 ? (
            <button type="button" className="button button--secondary" onClick={goBack}>Back</button>
          ) : null}
          {onFinalStep ? (
            <button type="button" className="button button--primary"
              disabled={
                isSubmitting ||
                Boolean(composeError) ||
                // Step 1 is the identity step. It is only ALSO the final step
                // when the pack failed to load (no module steps), and the
                // acknowledgment must still gate the button there.
                (step === 1 && !acknowledgedNoRecovery)
              }
              onClick={() => void handleCreate()}>
              {isSubmitting ? "Creating your vault…" : "Create vault"}
            </button>
          ) : (
            <button type="button" className="button button--primary" onClick={goNext}>
              Next
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
