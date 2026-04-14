import type { ChatChunkDTO } from "./client";

export class ChatStreamError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface ParsedFrame {
  event: string;
  data: Record<string, unknown>;
}

function parseFrame(raw: string): ParsedFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatChunkDTO> {
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
        if (parsed.event === "done") return;
        if (parsed.event === "chunk") {
          yield parsed.data as unknown as ChatChunkDTO;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function chatStream(
  url: string,
  token: string,
  req: unknown,
  signal?: AbortSignal,
): Promise<AsyncGenerator<ChatChunkDTO>> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
    signal,
  });
  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({
      detail: { code: "http_error", message: resp.statusText },
    }))) as { detail?: { code?: string; message?: string } };
    throw new ChatStreamError(
      body.detail?.code ?? "http_error",
      body.detail?.message ?? resp.statusText,
    );
  }
  if (!resp.body) throw new ChatStreamError("no_body", "upstream response has no body");
  return parseSseStream(resp.body);
}
