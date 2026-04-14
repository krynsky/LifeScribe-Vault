import type { ChatCitationDTO } from "../../api/client";

interface Props {
  citations: ChatCitationDTO[];
}

export function CitationChips({ citations }: Props) {
  if (!citations.length) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
      Sources: {citations.map((c) => (
        <span key={c.marker} style={{ marginRight: 8 }}>
          [{c.marker}] {c.resolved ? c.note_id : "unresolved"}
        </span>
      ))}
    </div>
  );
}
