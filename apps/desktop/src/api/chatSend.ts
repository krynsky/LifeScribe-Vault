import { ChatStreamError } from "./chatStream";

export type ChatSendEventName =
  | "session"
  | "retrieval"
  | "chunk"
  | "citations"
  | "no_context"
  | "done"
  | "error";

export interface ChatSendEvent {
  event: ChatSendEventName;
  data: Record<string, unknown>;
}

function parseFrame(raw: string): ChatSendEvent | null {
  let event: ChatSendEventName = "chunk";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim() as ChatSendEventName;
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export async function* parseChatSendStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatSendEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const parsed = parseFrame(frame);
        if (!parsed) continue;
        if (parsed.event === "error") {
          throw new ChatStreamError(
            String(parsed.data.code ?? "upstream_error"),
            String(parsed.data.message ?? ""),
          );
        }
        yield parsed;
        if (parsed.event === "done") return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function chatSend(
  url: string,
  token: string,
  body: {
    session_id: string | null;
    message: string;
    provider_id: string;
    model: string;
  },
  signal?: AbortSignal,
): Promise<AsyncGenerator<ChatSendEvent>> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    const errBody = (await resp.json().catch(() => ({
      detail: { code: "http_error", message: resp.statusText },
    }))) as { detail?: { code?: string; message?: string } };
    throw new ChatStreamError(
      errBody.detail?.code ?? "http_error",
      errBody.detail?.message ?? resp.statusText,
    );
  }
  if (!resp.body) throw new ChatStreamError("no_body", "no response body");
  return parseChatSendStream(resp.body);
}
