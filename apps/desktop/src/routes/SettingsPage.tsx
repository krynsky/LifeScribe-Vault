import { VaultLocation } from "./settings/VaultLocation";

export interface SettingsPageProps {
  /** Folder the vault's data files currently live in. */
  vaultDir: string;
  /** Locks the vault, moves the data, and lands on the locked screen. */
  onRelocate: (dir: string) => Promise<void>;
}

/**
 * Settings view rendered in the dashboard's main pane (the left nav stays put;
 * navigation is via the sidebar). Renders the Vault location section. Future
 * settings sections (e.g. change master password) stack below as siblings.
 */
export function SettingsPage({ vaultDir, onRelocate }: SettingsPageProps) {
  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1 className="settings-page__title">Settings</h1>
      </header>
      <VaultLocation vaultDir={vaultDir} onRelocate={onRelocate} />
    </div>
  );
}
