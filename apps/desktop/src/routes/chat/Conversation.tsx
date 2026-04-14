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
  | { kind: "streaming"; assistant: string; chunks: RetrievalChunkDTO[];
      citations: ChatCitationDTO[] }
  | { kind: "no_context" };

export function Conversation({ sessionId, session, onSessionCreated }: Props) {
  const qc = useQueryClient();
  const [state, setState] = useState<UIState>({ kind: "idle" });
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [provider, setProvider] = useState<{ id: string; model: string; local: boolean } | null>(null);

  const history: ChatTurnDTO[] = session?.turns ?? [];

  async function send(message: string) {
    if (!provider) return;
    setPendingUser(message);
    setState({ kind: "streaming", assistant: "", chunks: [], citations: [] });
    try {
      const [url, token] = await Promise.all([backendUrl(), backendToken()]);
      const gen = await chatSend(
        `${url}/chat/send`,
        token,
        {
          session_id: sessionId ?? null,
          message,
          provider_id: provider.id,
          model: provider.model,
        },
      );
      for await (const ev of gen) {
        applyEvent(ev);
      }
      qc.invalidateQueries({ queryKey: ["chat", "sessions"] });
      if (sessionId) qc.invalidateQueries({ queryKey: ["chat", "session", sessionId] });
    } catch (_err) {
      // error is surfaced via MessageBubble render of the partial assistant content
    } finally {
      setPendingUser(null);
      setState({ kind: "idle" });
    }
  }

  function applyEvent(ev: ChatSendEvent) {
    if (ev.event === "session") {
      const id = (ev.data as { session_id: string }).session_id;
      if (!sessionId) onSessionCreated(id);
    } else if (ev.event === "retrieval") {
      const chunks = (ev.data as { chunks: RetrievalChunkDTO[] }).chunks;
      setState((s) =>
        s.kind === "streaming" ? { ...s, chunks } : s,
      );
    } else if (ev.event === "chunk") {
      const delta = (ev.data as { delta: string }).delta;
      setState((s) =>
        s.kind === "streaming"
          ? { ...s, assistant: s.assistant + delta }
          : s,
      );
    } else if (ev.event === "citations") {
      const citations = (ev.data as { citations: ChatCitationDTO[] }).citations;
      setState((s) =>
        s.kind === "streaming" ? { ...s, citations } : s,
      );
    } else if (ev.event === "no_context") {
      setState({ kind: "no_context" });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ModelPill selected={provider} onChange={setProvider} />
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {history.map((t, i) => (
          <MessageBubble
            key={i}
            role={t.role}
            content={t.content}
            citations={t.citations}
          />
        ))}
        {pendingUser && <MessageBubble role="user" content={pendingUser} citations={[]} />}
        {state.kind === "streaming" && (
          <>
            <MessageBubble
              role="assistant"
              content={state.assistant}
              citations={state.citations}
            />
            <CitationChips citations={state.citations} />
            <RetrievedPanel chunks={state.chunks} />
          </>
        )}
        {state.kind === "no_context" && (
          <div style={{ color: "#888", padding: 16 }}>
            No relevant notes found in your vault.{" "}
            <a href="/settings">Rebuild index</a>
          </div>
        )}
      </div>
      <ChatInput onSend={send} provider={provider} privacyMode={false} />
    </div>
  );
}
