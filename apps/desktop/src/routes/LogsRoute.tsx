import { useNavigate } from "react-router-dom";

import NoteList, { NoteListRow } from "../components/NoteList";
import { useNotes } from "../api/queries";

export default function LogsRoute() {
  const navigate = useNavigate();
  const { data, error, isLoading } = useNotes("IngestJobLog");

  if (error)
    return (
      <div role="alert" style={{ color: "#b00" }}>
        Failed to load logs: {(error as Error).message}
      </div>
    );

  if (isLoading || !data) return <div>Loading…</div>;

  const sorted = [...data].sort((a, b) => {
    const sa = (a.started_at as string | undefined) ?? "";
    const sb = (b.started_at as string | undefined) ?? "";
    return sb.localeCompare(sa);
  });

  const rows: NoteListRow[] = sorted.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.id,
    subtitle: `${n.status as string} · ${n.succeeded ?? 0}✓ ${n.failed ?? 0}✗ ${n.skipped ?? 0}⏭`,
  }));

  return (
    <div>
      <h1>Logs</h1>
      <NoteList
        rows={rows}
        onSelect={(id) => navigate(`/logs/${encodeURIComponent(id)}`)}
        emptyLabel="No ingest jobs yet."
      />
    </div>
  );
}
