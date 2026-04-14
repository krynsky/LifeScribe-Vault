import { describe, it, expect } from "vitest";
import { parseChatSendStream } from "../chatSend";

function stream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

const CANNED = [
  `event: session\ndata: {"session_id":"chat_a","title":"t"}\n\n`,
  `event: retrieval\ndata: {"chunks":[{"n":1,"note_id":"doc_a","chunk_id":"c1","note_type":"DocumentRecord","score":-8,"snippet":"s","tags":[]}]}\n\n`,
  `event: chunk\ndata: {"delta":"hello ","finish_reason":null}\n\n`,
  `event: chunk\ndata: {"delta":"[1]","finish_reason":null}\n\n`,
  `event: citations\ndata: {"citations":[{"marker":1,"note_id":"doc_a","chunk_id":"c1","score":-8,"resolved":true}]}\n\n`,
  `event: done\ndata: {"finish_reason":"stop"}\n\n`,
].join("");

describe("parseChatSendStream", () => {
  it("emits events in order", async () => {
    const events: string[] = [];
    for await (const ev of parseChatSendStream(stream(CANNED))) {
      events.push(ev.event);
    }
    expect(events).toEqual(["session", "retrieval", "chunk", "chunk", "citations", "done"]);
  });

  it("parses chunk deltas", async () => {
    const deltas: string[] = [];
    for await (const ev of parseChatSendStream(stream(CANNED))) {
      if (ev.event === "chunk") deltas.push((ev.data as { delta: string }).delta);
    }
    expect(deltas).toEqual(["hello ", "[1]"]);
  });

  it("propagates error frames as exceptions", async () => {
    const frame = `event: error\ndata: {"code":"upstream_error","message":"boom"}\n\n`;
    await expect(
      (async () => {
        for await (const _ev of parseChatSendStream(stream(frame))) {
          // drain
        }
      })(),
    ).rejects.toThrow(/boom/);
  });

  it("emits no_context", async () => {
    const frames = [
      `event: session\ndata: {"session_id":"x","title":"t"}\n\n`,
      `event: no_context\ndata: {"message":"empty"}\n\n`,
      `event: done\ndata: {"finish_reason":"no_context"}\n\n`,
    ].join("");
    const names: string[] = [];
    for await (const ev of parseChatSendStream(stream(frames))) {
      names.push(ev.event);
    }
    expect(names).toEqual(["session", "no_context", "done"]);
  });
});
