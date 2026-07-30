import { useEffect, useState } from "react";
import type { FormPack } from "../domain/formModel";
import { loadDefaultPack } from "../domain/loadDefaultPack";
import { VaultOptions } from "./settings/VaultOptions";

export interface SettingsPageProps {
  selections: Record<string, string>;
  onApply: (next: Record<string, string>) => Promise<void>;
}

/**
 * Settings view rendered in the dashboard's main pane (the left nav stays put;
 * navigation is via the sidebar). Loads the bundled base pack for its module
 * definitions and renders the generic Vault options section. Future settings
 * sections (e.g. change master password) stack below as siblings.
 */
export function SettingsPage({ selections, onApply }: SettingsPageProps) {
  const [base, setBase] = useState<FormPack | null>(null);
  useEffect(() => {
    let isCurrent = true;
    loadDefaultPack()
      .then((pack) => { if (isCurrent) setBase(pack); })
      .catch(() => { /* VaultOptions shows an empty state if the pack can't load */ });
    return () => { isCurrent = false; };
  }, []);

  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1 className="settings-page__title">Settings</h1>
      </header>
      <VaultOptions base={base} selections={selections} onApply={onApply} />
    </div>
  );
}
