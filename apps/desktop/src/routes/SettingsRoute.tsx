import { useEffect, useState } from "react";

import { useSaveSettings, useSettings } from "../api/queries";

export default function SettingsRoute() {
  const { data, isLoading, error } = useSettings();
  const save = useSaveSettings();
  const [privacy, setPrivacy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (data) setPrivacy(data.privacy_mode);
  }, [data]);

  if (error)
    return (
      <div role="alert" style={{ color: "#b00" }}>
        Failed to load settings: {(error as Error).message}
      </div>
    );
  if (isLoading || !data) return <div>Loading…</div>;

  async function onSave() {
    await save.mutateAsync({ privacy_mode: privacy });
    setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <div>
      <h1>Settings</h1>
      <section style={{ marginBottom: 24 }}>
        <h2>Privacy</h2>
        <label>
          <input
            type="checkbox"
            checked={privacy}
            onChange={(e) => setPrivacy(e.target.checked)}
          />{" "}
          Privacy mode (master switch; no enforcement yet)
        </label>
      </section>
      <button type="button" onClick={onSave} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save"}
      </button>
      {savedAt && <span style={{ marginLeft: 12, color: "#080" }}>Saved at {savedAt}</span>}
    </div>
  );
}
