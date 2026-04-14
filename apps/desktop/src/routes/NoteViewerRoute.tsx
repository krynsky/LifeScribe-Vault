import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useRef } from "react";

import MarkdownViewer from "../components/MarkdownViewer";
import { ApiError } from "../api/client";
import { useNote } from "../api/queries";

export default function NoteViewerRoute() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useNote(id);
  const [params] = useSearchParams();
  const chunk = params.get("chunk");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chunk || !contentRef.current) return;
    contentRef.current.classList.add("chunk-highlight");
    contentRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = setTimeout(() => {
      contentRef.current?.classList.remove("chunk-highlight");
    }, 2000);
    return () => clearTimeout(t);
  }, [chunk]);

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
    <>
      <style>{`
        .chunk-highlight { background: #fff3cd; transition: background 2s; }
      `}</style>
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
        <div ref={contentRef}>
          <MarkdownViewer body={data.body} />
        </div>
      </article>
    </>
  );
}
