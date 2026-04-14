import { useEffect } from "react";
import { useLLMProviders, useLLMModels, useSettings } from "../../api/queries";

interface Selected {
  id: string;
  model: string;
  local: boolean;
}

interface Props {
  selected: Selected | null;
  onChange: (p: Selected | null) => void;
}

export function ModelPill({ selected, onChange }: Props) {
  const { data: providers } = useLLMProviders();
  const { data: settings } = useSettings();
  const { data: models } = useLLMModels(selected?.id);

  // default from settings if not yet selected
  useEffect(() => {
    if (!selected && providers && settings?.default_chat_provider_id) {
      const p = providers.find((x) => x.id === settings.default_chat_provider_id);
      if (p && settings.default_chat_model) {
        onChange({ id: p.id, model: settings.default_chat_model as string, local: p.local });
      }
    }
  }, [selected, providers, settings, onChange]);

  return (
    <div style={{ padding: 8, borderBottom: "1px solid #eee", fontSize: 12 }}>
      <label>
        Provider:{" "}
        <select
          value={selected?.id ?? ""}
          onChange={(e) => {
            const p = providers?.find((x) => x.id === e.target.value);
            if (!p) return;
            onChange({ id: p.id, model: selected?.model ?? "", local: p.local });
          }}
        >
          <option value="">— pick —</option>
          {providers?.map((p) => (
            <option key={p.id} value={p.id}>{p.display_name}</option>
          ))}
        </select>
      </label>{" "}
      <label>
        Model:{" "}
        <select
          value={selected?.model ?? ""}
          onChange={(e) =>
            selected && onChange({ ...selected, model: e.target.value })
          }
          disabled={!selected}
        >
          <option value="">— pick —</option>
          {models?.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
        </select>
      </label>
    </div>
  );
}
