import { useNavigate } from "react-router-dom";

import NoteList, { NoteListRow } from "../components/NoteList";
import { useNotes } from "../api/queries";

export default function BrowseRoute() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useNotes("SourceRecord");

  if (error) {
    return (
      <div role="alert" style={{ color: "#b00" }}>
        Failed to load notes: {(error as Error).message}
      </div>
    );
  }

  if (isLoading || !data) {
    return <div>Loading…</div>;
  }

  const rows: NoteListRow[] = data.map((n) => {
    const title =
      (n.title as string | undefined) ?? (n.original_filename as string | undefined) ?? n.id;
    const subtitleCandidate =
      (n.original_filename as string | undefined) ?? (n.imported_at as string | undefined);
    return {
      id: n.id,
      type: n.type,
      title,
      subtitle: subtitleCandidate !== title ? subtitleCandidate : undefined,
    };
  });

  return (
    <div>
      <h1>Browse</h1>
      <NoteList
        rows={rows}
        onSelect={(id) => navigate(`/browse/${encodeURIComponent(id)}`)}
        emptyLabel="No ingested notes yet — go to Import."
      />
    </div>
  );
}
