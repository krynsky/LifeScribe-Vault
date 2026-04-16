import { useEffect, useState } from "react";

import {
  useCreateLLMProvider,
  useDeleteLLMProvider,
  useIndexStatus,
  useLLMModels,
  useLLMProviders,
  useReindex,
  useSaveSettings,
  useSettings,
} from "../api/queries";

function DefaultChatModel() {
  const { data: providers } = useLLMProviders();
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const [providerId, setProviderId] = useState(settings?.default_chat_provider_id ?? "");
  const { data: models } = useLLMModels(providerId || undefined);
  const [model, setModel] = useState(settings?.default_chat_model ?? "");

  // Sync local state when settings load
  useEffect(() => {
    if (settings) {
      setProviderId(settings.default_chat_provider_id ?? "");
      setModel(settings.default_chat_model ?? "");
    }
  }, [settings]);

  return (
    <fieldset>
      <legend>Default chat model</legend>
      <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
        <option value="">— none —</option>
        {providers?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name}
          </option>
        ))}
      </select>{" "}
      <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!providerId}>
        <option value="">— none —</option>
        {models?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            privacy_mode: settings?.privacy_mode ?? false,
            default_chat_provider_id: providerId || null,
            default_chat_model: model || null,
          })
        }
      >
        Save
      </button>
    </fieldset>
  );
}

function LLMProvidersSection() {
  const { data: providers } = useLLMProviders();
  const create = useCreateLLMProvider();
  const del = useDeleteLLMProvider();
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:1234/v1");
  const [local, setLocal] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function onAdd() {
    setErr(null);
    try {
      await create.mutateAsync({ display_name: displayName, base_url: baseUrl, local });
      setDisplayName("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <fieldset>
      <legend>LLM Providers</legend>
      {providers && providers.length === 0 && (
        <div style={{ color: "#888", marginBottom: 8 }}>No providers yet.</div>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
        {providers?.map((p) => (
          <li key={p.id} style={{ marginBottom: 4 }}>
            <strong>{p.display_name}</strong>{" "}
            <span style={{ color: "#666" }}>
              ({p.local ? "local" : "remote"}) — {p.base_url}
            </span>{" "}
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete provider "${p.display_name}"?`)) del.mutate(p.id);
              }}
              disabled={del.isPending}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Display name (e.g. LM Studio)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input
          placeholder="Base URL"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          style={{ width: 260 }}
        />
        <label>
          <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />{" "}
          Local
        </label>
        <button
          type="button"
          disabled={!displayName || !baseUrl || create.isPending}
          onClick={onAdd}
        >
          {create.isPending ? "Adding…" : "Add provider"}
        </button>
      </div>
      {err && (
        <div role="alert" style={{ color: "#b00", marginTop: 8 }}>
          {err}
        </div>
      )}
    </fieldset>
  );
}

function ChatIndex() {
  const { data: status } = useIndexStatus();
  const reindex = useReindex();
  if (!status) return null;
  return (
    <fieldset>
      <legend>Chat index</legend>
      <div>Notes indexed: {status.note_count}</div>
      <div>Chunks: {status.chunk_count}</div>
      <div>DB size: {(status.db_size_bytes / 1024).toFixed(1)} KB</div>
      <div>Last indexed: {status.last_indexed_at || "never"}</div>
      {status.stale_notes > 0 && (
        <div style={{ color: "#c00" }}>
          {status.stale_notes} stale note(s) — rebuild recommended.
        </div>
      )}
      <button type="button" disabled={reindex.isPending} onClick={() => reindex.mutate()}>
        {reindex.isPending ? "Rebuilding…" : "Rebuild index"}
      </button>
    </fieldset>
  );
}

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
          <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />{" "}
          Privacy mode (master switch; no enforcement yet)
        </label>
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {savedAt && <span style={{ marginLeft: 12, color: "#080" }}>Saved at {savedAt}</span>}
        </div>
      </section>
      <section style={{ marginBottom: 24 }}>
        <h2>LLM Providers</h2>
        <LLMProvidersSection />
      </section>
      <section style={{ marginBottom: 24 }}>
        <h2>Chat</h2>
        <DefaultChatModel />
      </section>
      <section style={{ marginBottom: 24 }}>
        <h2>Index</h2>
        <ChatIndex />
      </section>
    </div>
  );
}
