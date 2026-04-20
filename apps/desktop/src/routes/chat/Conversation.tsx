import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { chatSend, type ChatSendEvent } from "../../api/chatSend";
import type {
  ChatSessionDTO,
  ChatTurnDTO,
  ChatCitationDTO,
  RetrievalChunkDTO,
} from "../../api/client";
import { backendUrl, backendToken } from "../../api/client";
import { useSettings } from "../../api/queries";
import { MessageBubble } from "./MessageBubble";
import { CitationChips } from "./CitationChips";
import { RetrievedPanel } from "./RetrievedPanel";
import { ChatInput } from "./ChatInput";
import { ModelPill } from "./ModelPill";

interface Props {
  sessionId: string | undefined;
  session: ChatSessionDTO | undefined;
  onSessionCreated: (id: string) => void;
}

type UIState =
  | { kind: "idle" }
  | {
      kind: "streaming";
      assistant: string;
      chunks: RetrievalChunkDTO[];
      citations: ChatCitationDTO[];
    }
  | { kind: "no_context" }
  | { kind: "error"; message: string };

export function Conversation({ sessionId, session, onSessionCreated }: Props) {
  const qc = useQueryClient();
  const [state, setState] = useState<UIState>({ kind: "idle" });
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [provider, setProvider] = useState<{ id: string; model: string; local: boolean } | null>(
    null,
  );
  const { data: settings } = useSettings();

  const history: ChatTurnDTO[] = session?.turns ?? [];

  async function send(message: string) {
    if (!provider) return;
    setPendingUser(message);
    setState({ kind: "streaming", assistant: "", chunks: [], citations: [] });
    try {
      const [url, token] = await Promise.all([backendUrl(), backendToken()]);
      const gen = await chatSend(`${url}/chat/send`, token, {
        session_id: sessionId ?? null,
        message,
        provider_id: provider.id,
        model: provider.model,
      });
      for await (const ev of gen) {
        applyEvent(ev);
      }
      qc.invalidateQueries({ queryKey: ["chat", "sessions"] });
      if (sessionId) qc.invalidateQueries({ queryKey: ["chat", "session", sessionId] });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "An unexpected error occurred while streaming.";
      setState({ kind: "error", message: msg });
    } finally {
      setPendingUser(null);
    }
  }

  function applyEvent(ev: ChatSendEvent) {
    if (ev.event === "session") {
      const id = (ev.data as { session_id: string }).session_id;
      if (!sessionId) onSessionCreated(id);
    } else if (ev.event === "retrieval") {
      const chunks = (ev.data as { chunks: RetrievalChunkDTO[] }).chunks;
      setState((s) => (s.kind === "streaming" ? { ...s, chunks } : s));
    } else if (ev.event === "chunk") {
      const delta = (ev.data as { delta: string }).delta;
      setState((s) => (s.kind === "streaming" ? { ...s, assistant: s.assistant + delta } : s));
    } else if (ev.event === "citations") {
      const citations = (ev.data as { citations: ChatCitationDTO[] }).citations;
      setState((s) => (s.kind === "streaming" ? { ...s, citations } : s));
    } else if (ev.event === "no_context") {
      setState({ kind: "no_context" });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ModelPill selected={provider} onChange={setProvider} />
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {history.map((t, i) => (
          <MessageBubble key={i} role={t.role} content={t.content} citations={t.citations} />
        ))}
        {pendingUser && <MessageBubble role="user" content={pendingUser} citations={[]} />}
        {state.kind === "streaming" && (
          <>
            <MessageBubble role="assistant" content={state.assistant} citations={state.citations} />
            <CitationChips citations={state.citations} />
            <RetrievedPanel chunks={state.chunks} />
          </>
        )}
        {state.kind === "no_context" && (
          <div style={{ color: "#888", padding: 16 }}>
            No relevant notes found in your vault. <a href="/settings">Rebuild index</a>
          </div>
        )}
        {state.kind === "error" && (
          <div
            style={{
              color: "#c00",
              background: "#fff0f0",
              padding: 12,
              margin: "8px 0",
              borderRadius: 6,
            }}
          >
            <strong>Error:</strong> {state.message}
          </div>
        )}
      </div>
      <ChatInput onSend={send} provider={provider} privacyMode={settings?.privacy_mode ?? false} />
    </div>
  );
}
