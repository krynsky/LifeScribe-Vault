import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";

import type { ChatCitationDTO } from "../../api/client";

interface Props {
  role: "user" | "assistant";
  content: string;
  citations: ChatCitationDTO[];
}

export function MessageBubble({ role, content, citations }: Props) {
  const byMarker = new Map(citations.map((c) => [c.marker, c]));
  const rendered = renderWithChips(content, byMarker);
  return (
    <div
      style={{
        padding: 12,
        margin: "8px 0",
        background: role === "user" ? "#e8f0fe" : "#f5f5f5",
        borderRadius: 6,
      }}
    >
      <strong>{role === "user" ? "You" : "Assistant"}</strong>
      <div>{rendered}</div>
    </div>
  );
}

function renderWithChips(text: string, byMarker: Map<number, ChatCitationDTO>) {
  // split on [N]; inject Link or warning icon
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (!m) return <ReactMarkdown key={i}>{part}</ReactMarkdown>;
    const n = Number(m[1]);
    const cite = byMarker.get(n);
    if (cite && cite.resolved) {
      return (
        <Link
          key={i}
          to={`/browse/${cite.note_id}?chunk=${cite.chunk_id}`}
          style={{ display: "inline-block", padding: "0 4px" }}
          aria-label={String(n)}
        >
          [{n}]
        </Link>
      );
    }
    return (
      <span
        key={i}
        title="unresolved citation"
        style={{ color: "#c00" }}
      >
        [{n}⚠]
      </span>
    );
  });
}
