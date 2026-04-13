import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api/client";

interface Props {
  onOpened: () => void;
}

export default function FirstRunWizard({ onOpened }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickDirectory(): Promise<string | null> {
    const result = await openDialog({ directory: true, multiple: false });
    if (typeof result === "string") return result;
    return null;
  }

  async function handleCreate() {
    setError(null);
    const path = await pickDirectory();
    if (!path) return;
    setBusy(true);
    try {
      await api.init(path);
      onOpened();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen() {
    setError(null);
    const path = await pickDirectory();
    if (!path) return;
    setBusy(true);
    try {
      await api.open(path);
      onOpened();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: "4rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Welcome to LifeScribe Vault</h1>
      <p>Choose how to get started:</p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button disabled={busy} onClick={handleCreate}>
          Create new vault
        </button>
        <button disabled={busy} onClick={handleOpen}>
          Open existing vault
        </button>
      </div>
      {error && <p style={{ color: "crimson", marginTop: 16 }}>Error: {error}</p>}
    </div>
  );
}
