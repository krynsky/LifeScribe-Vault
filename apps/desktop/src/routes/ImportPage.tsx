/**
 * ImportPage (U11): three-step UI for importing a v1 vault.
 *
 * Step 1 (pick): choose the v1 vault file + enter the v1 master password.
 * Step 2 (review): dry-run report showing what was found; user confirms.
 * Step 3 (done/error): success summary or error message.
 *
 * The merge is non-destructive by default: records are appended, never
 * overwriting the user's existing v2 data. The caller (Dashboard) handles
 * the CAS save.
 */

import { useState } from "react";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { importV1Snapshot } from "../api/vaultApi";
import {
  buildDryRunReport,
  mapV1ToV2,
  mergeImportedValues,
  type V1AttachmentImported,
  type V1DryRunReport,
  type V1Snapshot,
} from "../domain/v1Mapping";
import type { VaultValues } from "../domain/valuesStore";

type ImportStep = "pick" | "importing" | "review" | "saving" | "done" | "error";

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  if (code === "InvalidMasterPassword") {
    return "Wrong password, or the file is not a valid v1 vault.";
  }
  if (code === "DatabaseLocked") {
    return "The v1 vault is open in another application. Close LifeScribe Vault v1 and try again.";
  }
  if (code === "CorruptVault") {
    return "The vault file appears to be corrupt or is not a v1 LifeScribe Vault file.";
  }
  if (code === "VaultLocked") {
    return "Your current vault is locked. Please unlock it before importing.";
  }
  return "Something went wrong during import. No changes were made to your vault.";
}

export interface ImportPageProps {
  savedValues: VaultValues;
  saving: boolean;
  onSave: (nextValues: VaultValues) => Promise<void>;
  onCancel: () => void;
}

export function ImportPage({ savedValues, saving, onSave, onCancel }: ImportPageProps) {
  const [step, setStep] = useState<ImportStep>("pick");
  const [v1VaultPath, setV1VaultPath] = useState("");
  const [v1Password, setV1Password] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Populated after the Tauri command returns
  const [report, setReport] = useState<V1DryRunReport | null>(null);
  const [pendingSnapshot, setPendingSnapshot] = useState<V1Snapshot | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<V1AttachmentImported[]>([]);

  // -------------------------------------------------------------------------
  // Step 1 → Step 2: pick file + run import command
  // -------------------------------------------------------------------------

  async function handlePickFile() {
    const picked = await openFilePicker({
      multiple: false,
      directory: false,
      filters: [
        { name: "LifeScribe Vault (v1)", extensions: ["sqlite3", "db"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (picked && typeof picked === "string") {
      setV1VaultPath(picked);
      setErrorMsg("");
    }
  }

  async function handleImport() {
    if (!v1VaultPath || !v1Password) {
      return;
    }
    setStep("importing");
    setErrorMsg("");
    try {
      const result = await importV1Snapshot(v1VaultPath, v1Password);
      const snapshot = result.snapshot as V1Snapshot;
      const attachments: V1AttachmentImported[] = result.attachments.map((a) => ({
        v1Id: a.v1Id,
        v2Id: a.v2Id,
        fileName: a.fileName,
        sizeBytes: a.sizeBytes,
      }));
      const dryRun = buildDryRunReport(snapshot, attachments);
      setReport(dryRun);
      setPendingSnapshot(snapshot);
      setPendingAttachments(attachments);
      setV1Password("");
      setStep("review");
    } catch (error) {
      setErrorMsg(errorMessage(error));
      setStep("error");
    }
  }

  // -------------------------------------------------------------------------
  // Step 2 → Step 3: confirm merge + save
  // -------------------------------------------------------------------------

  async function handleConfirm() {
    if (!pendingSnapshot) {
      return;
    }
    setStep("saving");
    try {
      const { sections } = mapV1ToV2(pendingSnapshot, pendingAttachments);
      const nextValues = mergeImportedValues(savedValues, sections, []);
      await onSave(nextValues);
      setStep("done");
    } catch {
      setErrorMsg("The import data could not be saved. Please try again.");
      setStep("error");
    }
  }

  function handleReset() {
    setStep("pick");
    setV1VaultPath("");
    setV1Password("");
    setErrorMsg("");
    setReport(null);
    setPendingSnapshot(null);
    setPendingAttachments([]);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <article className="import-page">
      <h1 className="import-page__title">Import from v1</h1>
      <p className="import-page__lede">
        Bring your data from an older LifeScribe Vault installation into this
        vault. Your existing data is preserved — imported records are added
        alongside it.
      </p>

      {step === "pick" || step === "importing" ? (
        <section className="import-page__section" aria-labelledby="import-pick-heading">
          <h2 className="import-page__section-title" id="import-pick-heading">
            Choose vault file
          </h2>

          <div className="import-page__form">
            <div className="import-page__file-pick">
              <label className="form-field__label" htmlFor="import-file-display">
                v1 vault file
              </label>
              <div className="import-page__file-row">
                <input
                  className="form-field__input import-page__file-input"
                  id="import-file-display"
                  readOnly
                  type="text"
                  value={v1VaultPath || "No file selected"}
                />
                <button
                  className="button button--secondary"
                  disabled={step === "importing"}
                  type="button"
                  onClick={() => void handlePickFile()}
                >
                  Browse…
                </button>
              </div>
              <span className="form-field__hint">
                The vault file from LifeScribe Vault v1, typically named
                vault.sqlite3 in the app data folder.
              </span>
            </div>

            <label className="form-field" htmlFor="import-v1-password">
              <span className="form-field__label">v1 master password</span>
              <input
                autoComplete="current-password"
                className="form-field__input"
                disabled={step === "importing"}
                id="import-v1-password"
                type="password"
                value={v1Password}
                onChange={(e) => setV1Password(e.target.value)}
              />
              <span className="form-field__hint">
                The master password from your old vault — not your current one.
              </span>
            </label>

            <div className="import-page__actions">
              <button
                className="button button--primary"
                disabled={!v1VaultPath || !v1Password || step === "importing"}
                type="button"
                onClick={() => void handleImport()}
              >
                {step === "importing" ? "Reading vault…" : "Read v1 vault"}
              </button>
              <button
                className="button button--ghost"
                disabled={step === "importing"}
                type="button"
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        </section>
      ) : (step === "review" || step === "saving") && report ? (
        <section className="import-page__section" aria-labelledby="import-review-heading">
          <h2 className="import-page__section-title" id="import-review-heading">
            Review import
          </h2>
          {report.ownerName ? (
            <p className="import-page__owner">
              Vault owner: <strong>{report.ownerName}</strong>
            </p>
          ) : null}

          {report.sections.length === 0 && report.totalAttachments === 0 ? (
            <p className="import-page__empty">
              No data was found in the v1 vault that can be imported.
            </p>
          ) : (
            <>
              <p className="import-page__summary">
                The following data was found and will be added to your current
                vault:
              </p>
              <ul className="import-page__section-list">
                {report.sections.map((s) => (
                  <li key={s.sectionKey} className="import-page__section-item">
                    <span className="import-page__section-name">{s.sectionTitle}</span>
                    <span className="import-page__section-count">
                      {s.itemCount} {s.itemCount === 1 ? "record" : "records"}
                    </span>
                    {s.unmappableFields.length > 0 ? (
                      <span className="import-page__section-note">
                        Note: {s.unmappableFields.join("; ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {report.totalAttachments > 0 ? (
                <p className="import-page__attachments">
                  {report.totalAttachments} attachment
                  {report.totalAttachments === 1 ? "" : "s"} re-encrypted under
                  your current master password.
                </p>
              ) : null}
              {report.customFieldCount > 0 ? (
                <p className="import-page__notice">
                  {report.customFieldCount} custom field value
                  {report.customFieldCount === 1 ? "" : "s"} found — these will
                  not be imported (custom field definitions are not transferred
                  from v1).
                </p>
              ) : null}
            </>
          )}

          <div className="import-page__actions">
            <button
              className="button button--primary"
              disabled={saving || step === "saving" || report.sections.length === 0}
              type="button"
              onClick={() => void handleConfirm()}
            >
              {step === "saving" ? "Saving…" : "Import data"}
            </button>
            <button
              className="button button--ghost"
              disabled={step === "saving"}
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : step === "done" ? (
        <section className="import-page__section" aria-labelledby="import-done-heading" role="status">
          <h2 className="import-page__section-title" id="import-done-heading">
            Import complete
          </h2>
          <p className="import-page__success-text">
            Your v1 data has been added to the vault. You can review each
            section from the sidebar checklist.
          </p>
          <div className="import-page__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={handleReset}
            >
              Import another vault
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={onCancel}
            >
              Return to vault
            </button>
          </div>
        </section>
      ) : step === "error" ? (
        <section className="import-page__section" aria-labelledby="import-error-heading" role="alert">
          <h2 className="import-page__section-title" id="import-error-heading">
            Import failed
          </h2>
          <p className="import-page__error">{errorMsg}</p>
          <div className="import-page__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={handleReset}
            >
              Try again
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}
    </article>
  );
}
