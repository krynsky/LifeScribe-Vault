import { type FormEvent, useState } from "react";
import type { FormMode } from "../domain/snapshot";

export interface SetupScreenProps {
  onCreate: (masterPassword: string, ownerName: string, formMode: FormMode) => Promise<void>;
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
 * First-run setup: master password + confirmation + an explicit
 * "there is no recovery" acknowledgment before the vault can be created.
 */
export function SetupScreen({ onCreate }: SetupScreenProps) {
  const [ownerName, setOwnerName] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmMasterPassword, setConfirmMasterPassword] = useState("");
  const [acknowledgedNoRecovery, setAcknowledgedNoRecovery] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("hint");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const passwordType = showPasswords ? "text" : "password";
  const describedBy = error ? `${GUIDANCE_ID} ${ERROR_ID}` : GUIDANCE_ID;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (masterPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
      setError(
        `Use a master password with at least ${MIN_MASTER_PASSWORD_LENGTH} characters — a few unrelated words work well.`,
      );
      return;
    }
    if (masterPassword !== confirmMasterPassword) {
      setError("The passwords don't match. Re-enter both before creating your vault.");
      return;
    }
    if (!acknowledgedNoRecovery) {
      setError("Please confirm you understand the password cannot be reset.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onCreate(masterPassword, ownerName.trim(), formMode);
    } catch (caughtError) {
      setError(createErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="centered-screen">
      <section className="vault-panel" aria-labelledby="setup-title">
        <p className="vault-panel__eyebrow">LifeScribe Vault</p>
        <h1 className="vault-panel__title" id="setup-title">
          Let's set up your vault
        </h1>
        <p className="vault-panel__lede">
          Everything you record here is encrypted on this computer with one
          master password. A little planning now can save the people you love
          weeks of stressful detective work later.
        </p>
        <ul className="vault-panel__guidance" id={GUIDANCE_ID}>
          <li>A long passphrase of a few unrelated words is strong and memorable.</li>
          <li>Pasting from a password manager works too.</li>
          <li>
            This vault never touches the cloud — which also means nobody can
            reset the password for you. Keep it somewhere safe.
          </li>
        </ul>

        <form className="vault-form" onSubmit={handleSubmit}>
          <div className="vault-form__field">
            <label htmlFor="owner-name">Your name</label>
            <input
              autoComplete="name"
              id="owner-name"
              type="text"
              value={ownerName}
              onChange={(event) => setOwnerName(event.currentTarget.value)}
            />
          </div>

          <div className="vault-form__field">
            <label htmlFor="master-password">Master password</label>
            <input
              aria-describedby={describedBy}
              aria-invalid={error ? "true" : undefined}
              autoComplete="new-password"
              id="master-password"
              required
              spellCheck={false}
              type={passwordType}
              value={masterPassword}
              onChange={(event) => {
                setError("");
                setMasterPassword(event.currentTarget.value);
              }}
            />
          </div>

          <div className="vault-form__field">
            <label htmlFor="confirm-master-password">Confirm master password</label>
            <input
              aria-describedby={describedBy}
              aria-invalid={error ? "true" : undefined}
              autoComplete="new-password"
              id="confirm-master-password"
              required
              spellCheck={false}
              type={passwordType}
              value={confirmMasterPassword}
              onChange={(event) => {
                setError("");
                setConfirmMasterPassword(event.currentTarget.value);
              }}
            />
          </div>

          <label className="checkbox-control">
            <input
              checked={showPasswords}
              type="checkbox"
              onChange={(event) => setShowPasswords(event.currentTarget.checked)}
            />
            <span>Show passwords</span>
          </label>

          <label className="checkbox-control checkbox-control--acknowledge">
            <input
              checked={acknowledgedNoRecovery}
              type="checkbox"
              onChange={(event) => {
                setError("");
                setAcknowledgedNoRecovery(event.currentTarget.checked);
              }}
            />
            <span>
              I understand there is no recovery — this password cannot be
              reset, and losing it means losing access to the vault.
            </span>
          </label>

          <fieldset className="setup-mode">
            <legend>What should this vault store?</legend>
            <label className="setup-mode__option">
              <input
                type="radio"
                name="formMode"
                value="hint"
                checked={formMode === "hint"}
                onChange={() => setFormMode("hint")}
              />
              <span className="setup-mode__title">Store locations only (safer)</span>
              <span className="setup-mode__desc">
                Records where to find passwords and PINs, never the secrets themselves.
              </span>
            </label>
            <label className="setup-mode__option">
              <input
                type="radio"
                name="formMode"
                value="credential"
                checked={formMode === "credential"}
                onChange={() => setFormMode("credential")}
              />
              <span className="setup-mode__title">Store the actual secrets</span>
              <span className="setup-mode__desc">
                Keeps real passwords, PINs, and codes inside this encrypted vault.
              </span>
            </label>
          </fieldset>

          {error ? (
            <p className="form-error" id={ERROR_ID} role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="button button--primary"
            disabled={isSubmitting || !acknowledgedNoRecovery}
            type="submit"
          >
            {isSubmitting ? "Creating your vault…" : "Create vault"}
          </button>
        </form>
      </section>
    </div>
  );
}
