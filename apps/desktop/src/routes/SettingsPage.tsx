import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { VaultLocation } from "./settings/VaultLocation";
import { ChangePassword } from "./settings/ChangePassword";

export interface SettingsPageProps {
  /** Folder the vault's data files currently live in. */
  vaultDir: string;
  /** Locks the vault, moves the data, and lands on the locked screen. */
  onRelocate: (dir: string) => Promise<void>;
  /** Verifies the current password and rewraps the vault key. */
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

/**
 * Settings view rendered in the dashboard's main pane (the left nav stays put;
 * navigation is via the sidebar). Settings sections stack below as siblings.
 */
export function SettingsPage({ vaultDir, onRelocate, onChangePassword }: SettingsPageProps) {
  // Read from Tauri at runtime rather than hardcoding a copy here: the real
  // version already has three sources of truth to keep in sync (package.json,
  // Cargo.toml, tauri.conf.json) — a fourth, hand-maintained string in the UI
  // is exactly how "Settings says 1.0, the installer says 1.0.3" happens.
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1 className="settings-page__title">Settings</h1>
      </header>
      <VaultLocation vaultDir={vaultDir} onRelocate={onRelocate} />
      <ChangePassword onChangePassword={onChangePassword} />
      <section className="settings-section" aria-label="App version">
        <h2 className="settings-section__title">App version</h2>
        <p className="settings-section__lede">
          {appVersion ? `Version ${appVersion}` : "Version —"}
        </p>
      </section>
    </div>
  );
}
