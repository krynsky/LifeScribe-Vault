import { type FormEvent, useEffect, useState } from "react";
import { composePack } from "../domain/composePack";
import type { FormPack } from "../domain/formModel";
import { loadDefaultPack } from "../domain/loadDefaultPack";
import type { FormMode } from "../domain/snapshot";

/**
 * Map the onboarding mode toggle to the module selections `composePack`
 * expects. Mirrors `moduleSelectionsFromFormMode` in domain/snapshot.ts —
 * the onboarding preview has no persisted profile yet, so it derives the
 * same selections from the in-progress mode choice.
 */
function moduleSelectionsForPreview(formMode: FormMode): Record<string, string> {
  return { secrets: formMode === "credential" ? "on" : "off" };
}

export interface SetupScreenProps {
  onCreate: (masterPassword: string, ownerName: string, formMode: FormMode) => Promise<void>;
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

/**
 * Collapsible outline of what the selected mode's pack will ask about:
 * section titles, ledes, and field counts, read from the validated bundled
 * pack. Loaded lazily on first expand; a load failure degrades to a short
 * notice (the preview is informative only — setup still works without it).
 */
function PackPreview({ formMode }: { formMode: FormMode }) {
  const [open, setOpen] = useState(false);
  // The base pack is mode-independent (one bundled pack); "failed" is cached
  // too so the effect never needs a synchronous state reset
  // (react-hooks/set-state-in-effect).
  const [base, setBase] = useState<FormPack | "failed" | undefined>(undefined);

  useEffect(() => {
    if (!open || base) {
      return;
    }
    let isCurrent = true;
    loadDefaultPack()
      .then((pack) => {
        if (isCurrent) {
          setBase(pack);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setBase("failed");
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [open, base]);

  const failed = base === "failed";
  const pack =
    base && !failed
      ? composePack(base, base.modules ?? [], moduleSelectionsForPreview(formMode))
      : undefined;
  const sections = pack
    ? [...pack.sections].sort((a, b) => a.order - b.order)
    : [];

  return (
    <details
      className="setup-preview"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="setup-preview__summary">See what this vault covers</summary>
      {pack ? (
        <ul className="setup-preview__sections">
          {sections.map((section) => {
            const fieldCount = section.groups.reduce(
              (count, group) => count + group.fields.length,
              0,
            );
            return (
              <li key={section.sectionKey} className="setup-preview__section">
                <span className="setup-preview__section-title">
                  {section.title}
                  <span className="setup-preview__count">
                    {fieldCount} {fieldCount === 1 ? "field" : "fields"}
                  </span>
                </span>
                {section.lede ? (
                  <span className="setup-preview__lede">{section.lede}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="setup-preview__status">
          {failed
            ? "The preview could not be loaded — you can still create your vault."
            : "Loading…"}
        </p>
      )}
    </details>
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
 * First-run setup: master password + confirmation + an explicit
 * "there is no recovery" acknowledgment before the vault can be created.
 */
export function SetupScreen({ onCreate }: SetupScreenProps) {
  const [ownerName, setOwnerName] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmMasterPassword, setConfirmMasterPassword] = useState("");
  const [acknowledgedNoRecovery, setAcknowledgedNoRecovery] = useState(false);
  const [revealMaster, setRevealMaster] = useState(false);
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("hint");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
            <div className="password-field">
              <input
                aria-describedby={describedBy}
                aria-invalid={error ? "true" : undefined}
                autoComplete="new-password"
                id="master-password"
                required
                spellCheck={false}
                type={revealMaster ? "text" : "password"}
                value={masterPassword}
                onChange={(event) => {
                  setError("");
                  setMasterPassword(event.currentTarget.value);
                }}
              />
              <RevealToggle
                fieldLabel="master password"
                shown={revealMaster}
                onToggle={() => setRevealMaster((shown) => !shown)}
              />
            </div>
          </div>

          <div className="vault-form__field">
            <label htmlFor="confirm-master-password">Confirm master password</label>
            <div className="password-field">
              <input
                aria-describedby={describedBy}
                aria-invalid={error ? "true" : undefined}
                autoComplete="new-password"
                id="confirm-master-password"
                required
                spellCheck={false}
                type={revealConfirm ? "text" : "password"}
                value={confirmMasterPassword}
                onChange={(event) => {
                  setError("");
                  setConfirmMasterPassword(event.currentTarget.value);
                }}
              />
              <RevealToggle
                fieldLabel="confirmation password"
                shown={revealConfirm}
                onToggle={() => setRevealConfirm((shown) => !shown)}
              />
            </div>
          </div>

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

          <PackPreview formMode={formMode} />

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
