import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";

import { api } from "../client";
import { BASE, server } from "../../test/mswServer";

describe("api.chat", () => {
  it("listSessions", async () => {
    server.use(
      http.get(`${BASE}/chat/sessions`, () =>
        HttpResponse.json([{ id: "chat_a", title: "t", provider_id: "p",
                             model: "m", turn_count: 2,
                             created_at: "", updated_at: "" }]),
      ),
    );
    const sessions = await api.chat.listSessions();
    expect(sessions[0].id).toBe("chat_a");
  });

  it("getSession", async () => {
    server.use(
      http.get(`${BASE}/chat/sessions/chat_a`, () =>
        HttpResponse.json({ id: "chat_a", type: "ChatSession",
                             title: "t", provider_id: "p", model: "m",
                             turns: [] }),
      ),
    );
    const session = await api.chat.getSession("chat_a");
    expect(session.id).toBe("chat_a");
  });

  it("deleteSession", async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/chat/sessions/chat_a`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await api.chat.deleteSession("chat_a");
    expect(called).toBe(true);
  });

  it("reindex", async () => {
    server.use(
      http.post(`${BASE}/chat/reindex`, () =>
        HttpResponse.json({ indexed_notes: 5, elapsed_ms: 200,
                             last_indexed_at: "now" }),
      ),
    );
    const r = await api.chat.reindex();
    expect(r.indexed_notes).toBe(5);
  });

  it("indexStatus", async () => {
    server.use(
      http.get(`${BASE}/chat/index/status`, () =>
        HttpResponse.json({ last_indexed_at: "now", note_count: 10,
                             chunk_count: 30, db_size_bytes: 1024,
                             stale_notes: 0 }),
      ),
    );
    const r = await api.chat.indexStatus();
    expect(r.note_count).toBe(10);
  });
});

describe("api.retrieval", () => {
  it("search", async () => {
    server.use(
      http.post(`${BASE}/retrieval/search`, () =>
        HttpResponse.json({ chunks: [{ n: 1, note_id: "doc_a",
                                        chunk_id: "c", note_type: "DocumentRecord",
                                        score: -8, snippet: "s", tags: [] }],
                             index_last_updated_at: "now" }),
      ),
    );
    const r = await api.retrieval.search({ query: "x", k: 3 });
    expect(r.chunks[0].note_id).toBe("doc_a");
  });
});
