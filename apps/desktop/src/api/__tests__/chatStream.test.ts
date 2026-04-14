import { describe, expect, it } from "vitest";
import { parseSseStream, ChatStreamError } from "../chatStream";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("parseSseStream", () => {
  it("yields chunk events in order", async () => {
    const s = streamFromChunks([
      'event: chunk\ndata: {"delta":"Hel"}\n\n',
      'event: chunk\ndata: {"delta":"lo"}\n\n',
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]);
    const out = [];
    for await (const c of parseSseStream(s)) out.push(c);
    expect(out.map((c) => c.delta)).toEqual(["Hel", "lo"]);
  });

  it("throws ChatStreamError on mid-stream error event", async () => {
    const s = streamFromChunks([
      'event: chunk\ndata: {"delta":"Hi"}\n\n',
      'event: error\ndata: {"code":"upstream_502","message":"bad"}\n\n',
    ]);
    const out = [];
    try {
      for await (const c of parseSseStream(s)) out.push(c);
      throw new Error("expected ChatStreamError");
    } catch (e) {
      expect(e).toBeInstanceOf(ChatStreamError);
      expect((e as ChatStreamError).code).toBe("upstream_502");
    }
    expect(out.map((c) => c.delta)).toEqual(["Hi"]);
  });
});
