import { type FormEvent, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";

export interface LockedScreenProps {
  onUnlock: (masterPassword: string) => Promise<void>;
  /** One-off message explaining why the vault locked (e.g. after a move). */
  notice?: string;
}

const ERROR_ID = "unlock-error";

function unlockErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "InvalidMasterPassword") {
    return "That password didn't unlock the vault. Take a breath and try again — there is no reset for this password, so it has to be the one you chose at setup.";
  }
  if (message === "VaultNotInitialized" || message === "CorruptVault") {
    return "The vault file could not be read. If this keeps happening, restore from a backup.";
  }
  return "The vault could not be unlocked. Please try again.";
}

/**
 * Lock screen. Deliberately renders no vault plaintext anywhere — nothing
 * here is copyable vault content (clipboard-hygiene law).
 */
export function LockedScreen({ onUnlock, notice }: LockedScreenProps) {
  const [masterPassword, setMasterPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await onUnlock(masterPassword);
    } catch (caughtError) {
      setError(unlockErrorMessage(caughtError));
      setMasterPassword("");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="centered-screen">
      <section className="vault-panel" aria-labelledby="locked-title">
        <BrandLogo className="brand-logo--panel" />
        <h1 className="vault-panel__title" id="locked-title">
          Vault locked
        </h1>
        <p className="vault-panel__lede">
          Your information is encrypted and safe. Enter your master password
          to pick up where you left off.
        </p>

        {notice ? (
          <p className="vault-panel__lede" role="status">
            {notice}
          </p>
        ) : null}

        <form className="vault-form" onSubmit={handleSubmit}>
          <div className="vault-form__field">
            <label htmlFor="unlock-password">Master password</label>
            <input
              aria-describedby={error ? ERROR_ID : undefined}
              aria-invalid={error ? "true" : undefined}
              autoComplete="current-password"
              autoFocus
              id="unlock-password"
              required
              spellCheck={false}
              type="password"
              value={masterPassword}
              onChange={(event) => {
                setError("");
                setMasterPassword(event.currentTarget.value);
              }}
            />
          </div>

          {error ? (
            <p className="form-error" id={ERROR_ID} role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="button button--primary"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      </section>
    </div>
  );
}
