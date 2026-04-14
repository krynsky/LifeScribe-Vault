import { Link, useParams } from "react-router-dom";

import MarkdownViewer from "../components/MarkdownViewer";
import { ApiError } from "../api/client";
import { useNote } from "../api/queries";

export default function NoteViewerRoute() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useNote(id);

  if (error) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <div role="alert">
        <h1>{is404 ? "Note not found" : "Failed to load note"}</h1>
        <p>{(error as Error).message}</p>
        <Link to="/browse">← Back to Browse</Link>
      </div>
    );
  }

  if (isLoading || !data) return <div>Loading…</div>;

  return (
    <article>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ marginBottom: 4 }}>
          {(data.note.title as string | undefined) ??
            (data.note.original_filename as string | undefined) ??
            data.note.id}
        </h1>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#666" }}>
          {data.note.id} · {data.note.type}
        </div>
      </header>
      <MarkdownViewer body={data.body} />
    </article>
  );
}
