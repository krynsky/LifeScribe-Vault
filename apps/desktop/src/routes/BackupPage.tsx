/**
 * BackupPage (U9): create an encrypted backup or restore from one.
 *
 * Create flow: master password → folder picker → create_backup → shows output path.
 * Restore flow: file picker → backup password → confirm → restore_backup → done.
 */

import { useState } from "react";
import { open as openFilePicker, open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { createBackup, restoreBackup } from "../api/vaultApi";

type CreatePhase = "idle" | "running" | "done" | "error";
type RestorePhase = "idle" | "confirm" | "running" | "done" | "error";

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  if (code === "InvalidMasterPassword") {
    return "Wrong password, or the backup file is corrupt.";
  }
  if (code === "BackupVersionTooNew") {
    return "This backup requires a newer version of LifeScribe Vault. Please upgrade the app first.";
  }
  if (code === "RestoreConflict") {
    return "A restore is already in progress. Lock and reopen the app to resolve it.";
  }
  return "Something went wrong. The vault has not been changed.";
}

export function BackupPage() {
  // -- create state --
  const [createPassword, setCreatePassword] = useState("");
  const [createPhase, setCreatePhase] = useState<CreatePhase>("idle");
  const [createOutputPath, setCreateOutputPath] = useState("");
  const [createError, setCreateError] = useState("");

  // -- restore state --
  const [restoreFilePath, setRestoreFilePath] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [restorePhase, setRestorePhase] = useState<RestorePhase>("idle");
  const [restoreError, setRestoreError] = useState("");

  // -------------------------------------------------------------------------
  // Create backup
  // -------------------------------------------------------------------------

  async function handleCreateBackup() {
    if (!createPassword) {
      return;
    }
    const destDir = await openFolderPicker({ directory: true, multiple: false });
    if (!destDir || typeof destDir !== "string") {
      return;
    }
    setCreatePhase("running");
    setCreateError("");
    try {
      const result = await createBackup(createPassword, destDir);
      setCreateOutputPath(result.outputPath);
      setCreatePhase("done");
      setCreatePassword("");
    } catch (error) {
      setCreateError(errorMessage(error));
      setCreatePhase("error");
    }
  }

  function resetCreate() {
    setCreatePhase("idle");
    setCreateError("");
    setCreateOutputPath("");
    setCreatePassword("");
  }

  // -------------------------------------------------------------------------
  // Restore from backup
  // -------------------------------------------------------------------------

  async function handlePickRestoreFile() {
    const picked = await openFilePicker({
      multiple: false,
      directory: false,
      filters: [{ name: "LifeScribe Vault backup", extensions: ["lsvbackup"] }],
    });
    if (picked && typeof picked === "string") {
      setRestoreFilePath(picked);
      setRestorePhase("idle");
      setRestoreError("");
    }
  }

  function handleRestoreConfirm() {
    if (!restoreFilePath || !restorePassword) {
      return;
    }
    setRestorePhase("confirm");
  }

  async function handleRestoreExecute() {
    setRestorePhase("running");
    setRestoreError("");
    try {
      await restoreBackup(restoreFilePath, restorePassword);
      setRestorePhase("done");
      setRestorePassword("");
    } catch (error) {
      setRestoreError(errorMessage(error));
      setRestorePhase("error");
    }
  }

  function resetRestore() {
    setRestoreFilePath("");
    setRestorePassword("");
    setRestorePhase("idle");
    setRestoreError("");
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <article className="backup-page">
      <h1 className="backup-page__title">Backup</h1>
      <p className="backup-page__lede">
        Create an encrypted backup you can store anywhere — an external drive,
        USB stick, or cloud storage. The backup is locked with your master
        password and cannot be read without it.
      </p>

      {/* ---- Create backup ---- */}
      <section className="backup-page__section" aria-labelledby="backup-create-heading">
        <h2 className="backup-page__section-title" id="backup-create-heading">
          Create backup
        </h2>

        {createPhase === "done" ? (
          <div className="backup-page__success" role="status">
            <p className="backup-page__success-text">
              Backup saved to:
            </p>
            <p className="backup-page__success-path">{createOutputPath}</p>
            <button
              className="button button--secondary backup-page__reset-btn"
              type="button"
              onClick={resetCreate}
            >
              Create another backup
            </button>
          </div>
        ) : (
          <div className="backup-page__form">
            <label className="form-field" htmlFor="backup-master-password">
              <span className="form-field__label">Master password</span>
              <input
                autoComplete="current-password"
                className="form-field__input"
                disabled={createPhase === "running"}
                id="backup-master-password"
                type="password"
                value={createPassword}
                onChange={(e) => {
                  setCreatePassword(e.target.value);
                  if (createPhase === "error") {
                    setCreatePhase("idle");
                    setCreateError("");
                  }
                }}
              />
              <span className="form-field__hint">
                The password in effect right now. Old backups keep working with
                the password that was active when they were created.
              </span>
            </label>

            {createError ? (
              <p className="backup-page__error" role="alert">{createError}</p>
            ) : null}

            <button
              className="button button--primary"
              disabled={!createPassword || createPhase === "running"}
              type="button"
              onClick={() => void handleCreateBackup()}
            >
              {createPhase === "running" ? "Creating backup…" : "Choose folder and create backup"}
            </button>
          </div>
        )}
      </section>

      {/* ---- Restore from backup ---- */}
      <section className="backup-page__section" aria-labelledby="backup-restore-heading">
        <h2 className="backup-page__section-title" id="backup-restore-heading">
          Restore from backup
        </h2>
        <p className="backup-page__warning">
          Restoring replaces everything in the current vault. The current vault
          is automatically saved as a safety copy before anything is changed.
        </p>

        {restorePhase === "done" ? (
          <div className="backup-page__success" role="status">
            <p className="backup-page__success-text">
              Restore complete. The vault has been replaced with the contents of
              the backup. Lock and reopen to verify.
            </p>
            <button
              className="button button--secondary backup-page__reset-btn"
              type="button"
              onClick={resetRestore}
            >
              Restore another backup
            </button>
          </div>
        ) : restorePhase === "confirm" ? (
          <div className="backup-page__confirm" role="alertdialog" aria-labelledby="restore-confirm-heading">
            <h3 className="backup-page__confirm-title" id="restore-confirm-heading">
              Replace the current vault?
            </h3>
            <p>
              The vault will be replaced with the backup at:
            </p>
            <p className="backup-page__success-path">{restoreFilePath}</p>
            <p>
              A safety copy is saved automatically before the swap. This cannot
              be undone through the app after the restore completes.
            </p>
            <div className="backup-page__confirm-actions">
              <button
                className="button button--danger"
                type="button"
                onClick={() => void handleRestoreExecute()}
              >
                Yes, restore from backup
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setRestorePhase("idle")}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="backup-page__form">
            <div className="backup-page__file-pick">
              <label className="form-field__label" htmlFor="restore-file-display">
                Backup file
              </label>
              <div className="backup-page__file-row">
                <input
                  className="form-field__input backup-page__file-input"
                  id="restore-file-display"
                  readOnly
                  type="text"
                  value={restoreFilePath || "No file selected"}
                />
                <button
                  className="button button--secondary"
                  disabled={restorePhase === "running"}
                  type="button"
                  onClick={() => void handlePickRestoreFile()}
                >
                  Browse…
                </button>
              </div>
            </div>

            <label className="form-field" htmlFor="restore-backup-password">
              <span className="form-field__label">Backup password</span>
              <input
                autoComplete="current-password"
                className="form-field__input"
                disabled={restorePhase === "running"}
                id="restore-backup-password"
                type="password"
                value={restorePassword}
                onChange={(e) => {
                  setRestorePassword(e.target.value);
                  if (restorePhase === "error") {
                    setRestorePhase("idle");
                    setRestoreError("");
                  }
                }}
              />
              <span className="form-field__hint">
                The password that was active when this backup was created.
              </span>
            </label>

            {restoreError ? (
              <p className="backup-page__error" role="alert">{restoreError}</p>
            ) : null}

            <button
              className="button button--secondary"
              disabled={!restoreFilePath || !restorePassword || restorePhase === "running"}
              type="button"
              onClick={handleRestoreConfirm}
            >
              {restorePhase === "running" ? "Restoring…" : "Restore from this backup…"}
            </button>
          </div>
        )}
      </section>
    </article>
  );
}
