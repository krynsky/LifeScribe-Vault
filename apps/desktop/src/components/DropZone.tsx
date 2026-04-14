import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

interface Props {
  onPaths: (paths: string[]) => void;
  label?: string;
}

interface DropEvent {
  payload: { type: string; paths?: string[] };
}

export default function DropZone({ onPaths, label = "Drop files anywhere" }: Props) {
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await getCurrentWebviewWindow().onDragDropEvent((evt: unknown) => {
        const e = evt as DropEvent;
        const kind = e.payload.type;
        if (kind === "enter" || kind === "over") setHover(true);
        else if (kind === "leave") setHover(false);
        else if (kind === "drop") {
          setHover(false);
          if (e.payload.paths?.length) onPaths(e.payload.paths);
        }
      });
    })();
    return () => {
      unlisten?.();
    };
  }, [onPaths]);

  return (
    <div
      style={{
        border: `2px dashed ${hover ? "#36c" : "#bbb"}`,
        borderRadius: 8,
        padding: 32,
        textAlign: "center",
        color: "#666",
      }}
    >
      {label}
    </div>
  );
}
