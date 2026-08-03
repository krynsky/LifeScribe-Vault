import { useState } from "react";
import {
  MASTER_PASSWORD_LENGTH_MESSAGE,
  MIN_MASTER_PASSWORD_LENGTH,
  masterPasswordLengthError,
} from "../../domain/passwordPolicy";

export interface ChangePasswordProps {
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

function changeErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  if (code === "InvalidMasterPassword") {
    return "The current master password is incorrect. Your password was not changed.";
  }
  if (code === "InvalidNewMasterPassword") {
    return MASTER_PASSWORD_LENGTH_MESSAGE;
  }
  return "The password could not be changed. Try again.";
}

export function ChangePassword({ onChangePassword }: ChangePasswordProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<
    { kind: "error" | "success"; message: string } | null
  >(null);

  function clearMessages() {
    setFeedback(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    const lengthError = masterPasswordLengthError(newPassword);
    if (lengthError) {
      setFeedback({ kind: "error", message: lengthError });
      return;
    }
    if (newPassword !== confirmation) {
      setFeedback({
        kind: "error",
        message: "The new passwords don't match. Re-enter both and try again.",
      });
      return;
    }

    setBusy(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setFeedback({ kind: "success", message: "Your master password has been changed." });
    } catch (caught) {
      setCurrentPassword("");
      setFeedback({ kind: "error", message: changeErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Master password</h2>
      <p className="settings-section__lede">
        Choose a new password for opening this vault. Existing backup files
        will still use the password they were created with.
      </p>
      <form className="settings-password-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="vault-form__field">
          <span>Current master password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            spellCheck={false}
            value={currentPassword}
            onChange={(event) => { clearMessages(); setCurrentPassword(event.currentTarget.value); }}
          />
        </label>
        <label className="vault-form__field">
          <span>New master password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            spellCheck={false}
            value={newPassword}
            onChange={(event) => { clearMessages(); setNewPassword(event.currentTarget.value); }}
          />
        </label>
        <label className="vault-form__field">
          <span>Confirm new master password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            spellCheck={false}
            value={confirmation}
            onChange={(event) => { clearMessages(); setConfirmation(event.currentTarget.value); }}
          />
        </label>
        <p className="settings-section__empty">
          Use at least {MIN_MASTER_PASSWORD_LENGTH} characters. A few unrelated words work well.
        </p>
        {feedback?.kind === "error" ? (
          <p className="form-error" role="alert">{feedback.message}</p>
        ) : null}
        {feedback?.kind === "success" ? (
          <p className="form-success" role="status">{feedback.message}</p>
        ) : null}
        <div className="settings-password-form__actions">
          <button className="button button--primary" type="submit" disabled={busy}>
            {busy ? "Changing password…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}
