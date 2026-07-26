import { useMemo, useState } from "react";
import type { FormPack } from "../../domain/formModel";
import { useComposedPreview } from "../../domain/useComposedPreview";
import { ModuleQuestion } from "../../forms/ModuleQuestion";

export interface VaultOptionsProps {
  base: FormPack | null;
  selections: Record<string, string>;
  onApply: (next: Record<string, string>) => Promise<void>;
}

export function VaultOptions({ base, selections, onApply }: VaultOptionsProps) {
  const modules = useMemo(() => [...(base?.modules ?? [])].sort((a, b) => a.order - b.order), [base]);
  const [working, setWorking] = useState<Record<string, string>>(selections);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const { error } = useComposedPreview(base, working);

  const dirty = modules.some(
    (m) => (working[m.moduleId] ?? m.defaultOptionId) !== (selections[m.moduleId] ?? m.defaultOptionId),
  );

  if (modules.length === 0) {
    return (
      <section className="settings-section">
        <h2 className="settings-section__title">Vault options</h2>
        <p className="settings-section__empty">This vault has no vault options to change.</p>
      </section>
    );
  }

  async function handleApply() {
    setApplying(true);
    try {
      await onApply(working);
      setConfirming(false);
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Vault options</h2>
      <p className="settings-section__lede">
        These choices shape which sections and fields your vault includes. Changing one rebuilds your
        forms — entered data is kept (orphaned values are archived); any custom form edits are replaced.
      </p>
      {modules.map((m) => (
        <ModuleQuestion
          key={m.moduleId}
          module={m}
          selected={working[m.moduleId] ?? m.defaultOptionId}
          onChange={(optionId) => setWorking((prev) => ({ ...prev, [m.moduleId]: optionId }))}
        />
      ))}
      {error ? <p className="form-error" role="alert">{`This combination isn't valid: ${error}`}</p> : null}

      {confirming ? (
        <div className="settings-confirm" role="alertdialog" aria-label="Confirm vault options change">
          <p>Rebuild your forms with these options? Entered data is kept; custom form edits are replaced.</p>
          <div className="settings-confirm__actions">
            <button type="button" className="button button--ghost button--small" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--small"
              disabled={applying}
              aria-label="Confirm apply changes"
              onClick={() => void handleApply()}
            >
              {applying ? "Applying…" : "Confirm"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="button button--primary"
          disabled={!dirty || Boolean(error)}
          onClick={() => setConfirming(true)}
        >
          Apply changes
        </button>
      )}
    </section>
  );
}
