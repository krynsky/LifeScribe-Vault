import { useEffect, useState } from "react";
import { readAttachment } from "../api/vaultApi";

export interface AttachmentViewerProps {
  attachmentId: string;
  fileName: string;
  onClose: () => void;
}

type Kind = "image" | "pdf" | "text" | "other";

function kindFor(fileName: string): Kind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["txt", "md", "csv", "log", "json"].includes(ext)) return "text";
  return "other";
}

function mimeFor(kind: Kind, fileName: string): string {
  if (kind === "image") {
    const ext = fileName.toLowerCase().split(".").pop() ?? "";
    return ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
  }
  if (kind === "pdf") return "application/pdf";
  return "text/plain";
}

export function AttachmentViewer({ attachmentId, fileName, onClose }: AttachmentViewerProps) {
  const kind = kindFor(fileName);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let objectUrl: string | null = null;
    let current = true;
    readAttachment(attachmentId)
      .then((bytes) => {
        if (!current) return;
        if (kind === "text") {
          setText(new TextDecoder().decode(bytes));
          return;
        }
        if (kind === "other") return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeFor(kind, fileName) }));
        setUrl(objectUrl);
      })
      .catch((e: unknown) => {
        if (current) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId, fileName, kind]);

  return (
    <div className="modal modal--viewer" role="dialog" aria-modal="true" aria-label={`View ${fileName}`}>
      <div className="modal__body attachment-viewer">
        <div className="attachment-viewer__header">
          <span>{fileName}</span>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : kind === "image" && url ? (
          <img className="attachment-viewer__image" src={url} alt={fileName} />
        ) : kind === "pdf" && url ? (
          <iframe className="attachment-viewer__frame" title={fileName} src={url} />
        ) : kind === "text" && text !== null ? (
          <pre className="attachment-viewer__text">{text}</pre>
        ) : kind === "other" ? (
          <p className="attachment-viewer__none">
            No inline preview for this file type — use "Open externally".
          </p>
        ) : (
          <p className="attachment-viewer__loading">Decrypting…</p>
        )}
      </div>
    </div>
  );
}
