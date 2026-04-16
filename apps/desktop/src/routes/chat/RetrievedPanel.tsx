import { useState } from "react";
import { Link } from "react-router-dom";

import type { RetrievalChunkDTO } from "../../api/client";

interface Props {
  chunks: RetrievalChunkDTO[];
}

export function RetrievedPanel({ chunks }: Props) {
  const [open, setOpen] = useState(false);
  if (!chunks.length) return null;
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Retrieved {chunks.length} chunks</summary>
      {open && (
        <ul>
          {chunks.map((c) => (
            <li key={c.chunk_id}>
              <Link to={`/browse/${c.note_id}?chunk=${c.chunk_id}`}>
                [{c.n}] {c.note_id} — {c.note_type} (score {c.score.toFixed(2)})
              </Link>
              <div
                style={{ fontSize: 12, color: "#666" }}
                dangerouslySetInnerHTML={{ __html: c.snippet }}
              />
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
