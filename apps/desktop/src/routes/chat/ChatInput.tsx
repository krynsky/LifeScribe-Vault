import { useState, type KeyboardEvent } from "react";

interface Provider {
  id: string;
  model: string;
  local: boolean;
}

interface Props {
  onSend: (message: string) => void;
  provider: Provider | null;
  privacyMode: boolean;
}

export function ChatInput({ onSend, provider, privacyMode }: Props) {
  const [draft, setDraft] = useState("");
  const blocked =
    !provider || (privacyMode && !provider.local);

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    if (!draft.trim() || blocked) return;
    onSend(draft);
    setDraft("");
  }

  return (
    <div style={{ borderTop: "1px solid #ddd", padding: 12 }}>
      {privacyMode && provider && !provider.local && (
        <div style={{ color: "#c00", marginBottom: 8, fontSize: 12 }}>
          Privacy is on. Switch to a local model or disable privacy in Settings.
        </div>
      )}
      <textarea
        placeholder="Ask about your vault..."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        style={{ width: "100%", minHeight: 64 }}
      />
      <button disabled={blocked || !draft.trim()} onClick={submit}>
        Send
      </button>
    </div>
  );
}
