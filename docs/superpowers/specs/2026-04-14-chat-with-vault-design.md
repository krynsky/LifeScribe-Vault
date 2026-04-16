# Chat with Vault — Design Spec

> Sub-project §3.5 of the LifeScribe Vault umbrella spec
> (`2026-04-12-lifescribe-vault-overview.md`). Consumes §3.1 (Vault
> Foundation), §3.2 (Ingestion Pipeline), §3.4 (LLM Provider Framework).

## 1. Purpose

Let a user chat with their own vault. Every factual claim in an
answer is cited back to a specific note, and the answer is only ever
produced from content retrieved from the vault. "Chat with Vault" is
the product name — drifting into ungrounded answers dilutes the
identity.

Retrieval uses SQLite FTS5 (lexical) for v1. A vector sidecar is
deferred until real usage shows FTS is insufficient.

## 2. Scope

### In scope
- SQLite FTS5 index built from `DocumentRecord`, `SourceRecord`
  metadata, and `ChatSession` notes.
- Incremental reindex on ingest completion and on vault open when
  notes have changed.
- Manual "Rebuild index" affordance in Settings.
- `POST /chat/send` orchestrator: retrieve → grounding gate → stream
  LLM → persist `ChatSession` note.
- `POST /retrieval/search` introspection endpoint.
- `ChatSession` note type persisted at `70_chats/{id}.md`.
- Multi-turn conversations, capped at the 10 most-recent turns in
  prompt history.
- Inline `[N]` citations with post-hoc resolution; unresolved markers
  flagged in UI.
- Default chat model in Settings + per-session override.
- `/chat` route in the dashboard, split-pane UX.

### Deferred
- Vector retrieval sidecar.
- Conversation history beyond 10 turns (summarization, sliding window).
- Tag / note-type / folder filters on retrieval.
- Background async reindex with streaming progress.
- Tool-calling or agent loops.
- Hybrid retrieval signals (recency boost, pinned notes).
- Retrieval quality evaluation harness.

### Non-goals
- Indexing asset binaries directly (their extracted text already
  lives in `DocumentRecord`).
- Per-vault search UI outside of chat (the `/retrieval/search`
  endpoint is consumed only by the chat page's debug panel in v1).

## 3. Invariants honored

| Invariant (from umbrella §2) | How this spec honors it |
|---|---|
| Vault is the source of truth | FTS DB is rebuildable from markdown; no facts are stored only in the index. `ChatSession` notes are first-class markdown, not a sidecar table. |
| Provenance is first-class | Every chat answer carries inline `[N]` citations resolved to a `note_id` and `chunk_id`. Unresolved markers are flagged, never silently hidden. |
| Hand-edits are safe | Reindex detects drift by comparing note mtime to `note_index.note_mtime`. "Rebuild index" in Settings nukes and recomputes. `ChatSession` note conflicts follow the existing `.conflict.md` pattern. |
| Privacy is enforced end-to-end | `/chat/send` delegates to `LLMService`, inheriting the §3.4 two-layer privacy check. Frontend disables send when privacy is on and the selected provider is remote. |
| Every behavior is accessible to an agent and a human | All routes are HTTP + bearer auth; the orchestrator is a pure Python module that a CLI / MCP server can call. |

## 4. Architecture

### 4.1 Module layout

```
apps/backend/src/lifescribe/
  retrieval/
    __init__.py
    index.py          # SQLite FTS5 wrapper
    chunker.py        # paragraph-aligned, ~500-token chunks
    indexer.py        # "reindex these notes" / "reindex stale"
  chat/
    __init__.py
    prompt.py         # build system prompt with numbered sources
    orchestrator.py   # retrieve → gate → stream → persist
    sessions.py       # ChatSession CRUD atop VaultStore
  api/routers/
    retrieval.py      # POST /retrieval/search
    chat.py           # /chat/send (SSE), /chat/sessions*,
                      # /chat/reindex, /chat/index/status
```

### 4.2 Index storage

- Location: `<vault_root>/.lifescribe/fts.db`.
- `.lifescribe/` is added to `.gitignore` during `VaultStore.init()`
  (one line, idempotent).
- Rebuildable from markdown at any time.
- Tied to the manifest's `vault_id` via a `meta.vault_id` row to
  detect cross-vault confusion.

### 4.3 Index triggers

1. **Ingest completion** — `IngestPipeline` gains a post-commit step
   that calls `Indexer.reindex_notes(ids=[...])` synchronously before
   the job transitions to `completed`. The job is "done" only after
   the index is updated.
2. **Chat turn commit** — after each `ChatSession` note update
   (one turn-pair per commit), the orchestrator calls
   `Indexer.reindex_notes(ids=[session_id])` before emitting `event:
   done`. Past chats become searchable as soon as they're persisted.
3. **Vault open** — `app.py`'s open path walks notes, compares
   `stat().st_mtime` against `note_index.note_mtime`, and reindexes
   the drift. Runs synchronously during open.
4. **Manual rebuild** — `POST /chat/reindex` blocks until done.

A module-level `threading.Lock` serializes writes to `fts.db` across
all triggers (ingest, chat-turn, vault-open, manual rebuild). Read
connections use `PRAGMA query_only`. `/chat/reindex` acquires the
lock for the full rebuild; a second call while one is in flight
returns `409 reindex_in_progress` instead of blocking.

### 4.4 Chat flow

```
Client                    Backend /chat/send
  │                            │
  │ message + session_id ────→ │
  │                            │ 1. Load or create ChatSession
  │                            │ 2. retrieval.search(msg, k=6)
  │                            │ 3. if zero chunks pass threshold:
  │                            │      emit no_context, persist turn
  │                            │      (empty_retrieval=true), done
  │                            │ 4. Build numbered system prompt
  │                            │ 5. Append capped history
  │                            │ 6. LLMService.stream_chat(...)
  │   ←── SSE: session ───     │    (before first LLM byte)
  │   ←── SSE: retrieval ───   │    (before first LLM byte)
  │   ←── SSE: chunk ───       │ 7. Forward deltas, accumulate
  │   ←── SSE: citations ───   │ 8. Validate [N] markers
  │   ←── SSE: done ───        │ 9. Persist turn-pair to ChatSession
  │                            │    (one git commit per turn-pair)
```

### 4.5 Prompt template

```
You are LifeScribe Vault's research assistant. Answer the user's
question using ONLY the numbered sources below. Cite every factual
claim inline as [N] where N matches a source number. If the sources
do not contain the answer, say so — do not draw on outside knowledge.

Sources:
[1] (DocumentRecord doc_abc123, from "Q2-planning.pdf")
<chunk 1 text, trimmed to ~500 tokens>

[2] (DocumentRecord doc_def456, from "ops-notes.md")
<chunk 2 text>
...
```

Chunks are ordered by retrieval score (highest first). The per-chunk
preamble is plain English; LLMs cite better from readable context
than from structured JSON.

### 4.6 Grounding gate

1. Run FTS query with the user's message as the `MATCH` expression.
2. Apply BM25 cutoff: **`score ≤ -0.5`** (FTS5 returns negative scores;
   lower = more relevant). The cutoff is a module-level constant in v1,
   retuned with real usage.
3. If zero chunks pass: emit `event: no_context`, persist turn with
   `empty_retrieval: true`, emit `event: done`, return. **No LLM call.**
4. Otherwise pass the chunks to `prompt.build()` and call
   `LLMService.stream_chat`.

### 4.7 Citation validation

- Accumulate the full assistant `content` as the stream flows.
- On `finish_reason`, regex `\[(\d+)\]` over the completed text.
- For each unique `N`:
  - `1 ≤ N ≤ len(chunks_provided)` → `resolved: true`, link to that
    chunk's `note_id` / `chunk_id`.
  - Otherwise `resolved: false`.
- Emit `event: citations` with the resolved list **before** `event: done`.
- We do not retry on unresolved citations — the UI surfaces the issue.

### 4.8 Conversation history

- All turns of the current `ChatSession` are loaded as prior
  `ChatMessage`s in the request to `LLMService`, oldest first.
- Capped at the **last 10 turns total** (a turn is one message,
  user or assistant). If the session has 12 turns when the user
  sends a new message, turns 1 and 2 are dropped from the prompt
  but remain persisted in the note.
- Retrieval runs fresh on every user message using that turn's text
  as the query. Prior-turn chunks are not persisted as retrieval state.

## 5. Data model

### 5.1 `ChatSession` note

Schema additions in `apps/backend/src/lifescribe/vault/schemas.py`:

```python
class ChatCitation(BaseModel):
    marker: int            # the [N] in the answer, 1-indexed
    note_id: str
    chunk_id: str
    score: float           # bm25 score at retrieval time
    resolved: bool         # false if LLM cited [N] not provided

class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    citations: list[ChatCitation] = []   # populated for assistant turns
    empty_retrieval: bool = False        # true when user turn got no chunks

class ChatSession(VaultNote):
    type: Literal["ChatSession"] = "ChatSession"
    title: str                           # auto-generated from first user msg
    provider_id: str
    model: str
    turns: list[ChatTurn]
```

- ID format: `chat_<slug>_<6-hex>`.
- File path: `70_chats/{id}.md`.
- Frontmatter carries the structured data; markdown body is a
  human-readable rendering of the conversation (for git diffs and
  hand-editing).
- `70_chats/` is a new top-level folder in the vault layout.

### 5.2 FTS schema (`.lifescribe/fts.db`)

```sql
CREATE VIRTUAL TABLE chunks USING fts5(
  note_id         UNINDEXED,
  chunk_id        UNINDEXED,
  note_type       UNINDEXED,  -- DocumentRecord / SourceRecord / ChatSession
  tags            UNINDEXED,  -- comma-joined, reserved for filter UI
  imported_at     UNINDEXED,  -- ISO date, reserved for recency ranking
  content,
  tokenize = 'porter unicode61'
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- rows: schema_version (int), last_indexed_at (ISO), vault_id

CREATE TABLE note_index (
  note_id     TEXT PRIMARY KEY,
  note_mtime  REAL NOT NULL,
  chunk_count INTEGER NOT NULL
);
```

### 5.3 What gets indexed

- `DocumentRecord.body` — extracted text; the bulk of retrieval signal.
- `SourceRecord` synthetic chunk: `"{filename} imported {imported_at}
  tags {tags}"` so metadata queries land somewhere.
- `ChatSession.turns[*].content` — past chats are searchable and citable.

Not indexed in v1: `IngestJobLog`, `VaultSettings`, `LLMProvider`,
`VaultManifest`, asset binaries.

### 5.4 Chunking

- Target 500 tokens, ±20% tolerance.
- Split on paragraph boundaries (`\n\n`) first. If a paragraph is
  larger than the budget, fall back to sentence boundaries, then
  hard-wrap on token count.
- Each chunk: `note_id`, `start_offset`, `end_offset`,
  `chunk_id = sha1(f"{note_id}:{start}:{end}")[:12]`.
- Token counting is approximated as `len(content) // 4`. Accuracy is
  not critical — we are staying within model context, not optimizing
  cost.

### 5.5 `VaultSettings` additions

- `default_chat_provider_id: str | None`
- `default_chat_model: str | None`

Both nullable; UI shows a "select a default" prompt when unset.

## 6. API surface

All routes require the bearer token. All except `/chat/index/status`
fail `409 vault_not_open` when no vault is open.

### 6.1 `POST /chat/send` (SSE)

```jsonc
// request
{
  "session_id": "chat_abc123" | null,
  "message": "what did I import about quarterly planning?",
  "provider_id": "llm_lm_studio_55683d",
  "model": "qwen3-14b"
}
```

Event sequence (normal path):
```
event: session
data: {"session_id":"chat_mtgs_8f2a","title":"quarterly planning imports"}

event: retrieval
data: {"chunks":[{"n":1,"note_id":"doc_...","chunk_id":"...",
                  "score":8.2,"snippet":"...","note_type":"DocumentRecord",
                  "tags":["work"]}, ...]}

event: chunk
data: {"delta":"According to [1]...","finish_reason":null}
... more chunks ...

event: citations
data: {"citations":[{"marker":1,"note_id":"doc_...","chunk_id":"...",
                     "resolved":true}, ...]}

event: done
data: {"finish_reason":"stop"}
```

Empty-retrieval path:
```
event: session
data: {"session_id":"...","title":"..."}

event: no_context
data: {"message":"No relevant notes found in your vault."}

event: done
data: {"finish_reason":"no_context"}
```

Error frames match the §3.4 pattern:
```
event: error
data: {"code":"...","message":"..."}
```

### 6.2 `POST /retrieval/search`

```jsonc
// request
{"query": "quarterly planning", "k": 6}

// response 200
{
  "chunks": [
    {"n":1,"note_id":"doc_...","chunk_id":"...",
     "note_type":"DocumentRecord","score":8.2,
     "snippet":"...highlighted excerpt...","tags":["work"]}
  ],
  "index_last_updated_at": "2026-04-14T14:30:00Z"
}
```

### 6.3 `GET /chat/sessions`

Returns a list sorted newest-first:

```json
[{"id":"chat_...","title":"...","provider_id":"...","model":"...",
  "turn_count":6,"created_at":"...","updated_at":"..."}]
```

### 6.4 `GET /chat/sessions/{id}`

Returns the full `ChatSession` note as JSON (frontmatter form).

### 6.5 `DELETE /chat/sessions/{id}`

Removes the note file + commit. Returns `204`.

### 6.6 `POST /chat/reindex`

Synchronous. Returns when done:
```json
{"indexed_notes": 142, "elapsed_ms": 3814,
 "last_indexed_at": "2026-04-14T14:30:00Z"}
```
A second call while one is in flight returns `409 reindex_in_progress`.

### 6.7 `GET /chat/index/status`

```json
{"last_indexed_at":"2026-04-14T14:30:00Z",
 "note_count":142,"chunk_count":389,
 "db_size_bytes":1048576,"stale_notes":0}
```

Consumed by the Settings page to decide whether to nudge "Rebuild
index" and by the Chat page's empty-state link.

## 7. Frontend

### 7.1 Files

```
apps/desktop/src/routes/
  ChatRoute.tsx
  chat/
    SessionsList.tsx     # sidebar
    Conversation.tsx     # message list + streaming accumulator
    MessageBubble.tsx    # markdown + [N] chips
    CitationChips.tsx    # footer sources list
    RetrievedPanel.tsx   # collapsible "N chunks retrieved"
    ModelPill.tsx        # provider/model swap UI
    ChatInput.tsx        # textarea + send button (privacy-aware)

apps/desktop/src/api/
  chatSend.ts            # SSE parser for /chat/send's richer event set
```

Reuses the shared `ChatStreamError` and `parseSseStream` primitives
from `chatStream.ts` (§3.4) where possible.

### 7.2 React Query hooks (added to `api/queries.ts`)

- `useChatSessions()`
- `useChatSession(id)`
- `useDeleteChatSession()`
- `useReindex()`
- `useIndexStatus()`

### 7.3 Sidebar navigation

`SECTIONS` array grows by one entry:

```ts
{ path: "/chat", label: "Chat", icon: "💬" }
```

Placed between `/import` and `/logs`.

### 7.4 Layout

Split pane inside `/chat`: sessions sidebar on the left, active
conversation on the right. New session starts as a stub until the
first user message arrives (no empty notes written).

On `event: session`, the URL is updated to `/chat/:id` via
`history.replaceState` so sessions are deep-linkable.

### 7.5 Streaming render

`Conversation.tsx` event handling:

- `session`: if new, update URL; update sidebar via
  `queryClient.invalidateQueries(['chat','sessions'])`.
- `retrieval`: stash chunks for `RetrievedPanel`; do not render yet.
- `chunk`: append `delta` to the in-progress assistant turn,
  re-render markdown incrementally.
- `citations`: post-process the completed assistant markdown —
  each `[N]` becomes a `CitationChip` linking to the cited note.
- `no_context`: replace the in-progress assistant turn with the
  empty state + a link to Settings' "Rebuild index."
- `done` / `error`: finalize; invalidate `['chat','session',id]`.

### 7.6 Privacy-aware send button

When `settings.privacy_mode === true` AND the selected provider's
`local === false`:

- Send button disabled.
- Helper line under the input: *"Privacy is on. Switch to a local
  model or disable privacy in Settings."*
- Model pill clickable to open the provider picker.

### 7.7 Settings additions

- "Default chat model" — dropdown populated from `/llm/providers` +
  `/llm/providers/{id}/models`. Persists to `VaultSettings`.
- "Chat index" section — status from `/chat/index/status`, "Rebuild
  index" button calling `/chat/reindex`, disabled with spinner during
  reindex.

### 7.8 Citation rendering

`[N]` tokens in assistant markdown are replaced with a
`CitationChip` component that:

- Links to `/browse/{note_id}` for the cited note.
- Shows the note title on hover.
- Renders an unresolved-marker warning icon when the citation's
  `resolved: false`.

Browse route gains a `chunk_id` query param handler: when present,
scroll to the chunk's offset range and highlight it briefly.

## 8. Error handling

| Condition | Backend response | SSE frame |
|---|---|---|
| Vault not open | `409 vault_not_open` | n/a |
| Index missing / corrupt | `503 index_unavailable` | `error` code `index_unavailable` |
| LLM error (upstream/privacy/timeout) | §3.4 pass-through | `error` |
| Session id unknown | `404 session_not_found` | n/a |
| Reindex concurrency | `409 reindex_in_progress` | n/a |
| Chat note write conflict | `409 conflict_file_written` + `.conflict.md` | `error` |

If the LLM stream fails mid-response, the user turn is still persisted;
the assistant turn is persisted with whatever content arrived plus
`finish_reason: error`. The user retries by sending a new message.

## 9. Testing

### 9.1 Unit / module

- `retrieval/test_chunker.py` — paragraph splits, oversized-paragraph
  fallback, offset accuracy, chunk_id stability.
- `retrieval/test_index.py` — upsert/delete/search round-trip,
  BM25 ordering, stale-detection via mtime, `vault_id` mismatch.
- `chat/test_prompt.py` — template rendering, chunk ordering,
  tag-free input.
- `chat/test_orchestrator.py` — grounding gate (zero-chunk short-
  circuit), citation validation (resolved vs. unresolved), session
  creation on first turn, append on subsequent turns, privacy pass-
  through (monkeypatched `LLMService`).
- `chat/test_sessions.py` — auto-title, slug collisions (hex suffix),
  persistence format round-trip, delete flow.

### 9.2 API routers

- `test_api_retrieval.py` — `/retrieval/search` shape, empty results.
- `test_api_chat_send.py` — SSE frame sequence for normal, empty-
  retrieval, LLM-error paths.
- `test_api_chat_sessions.py` — list / get / delete happy paths and
  404s.
- `test_api_chat_reindex.py` — full rebuild, concurrent-call 409.

### 9.3 Integration

`tests/integration/test_chat_smoke.py`:

1. Init vault → ingest a tiny text source → FTS contains one chunk →
   `POST /chat/send` → SSE sequence matches → `GET
   /chat/sessions/{id}` returns persisted turns.
2. Empty vault → `POST /chat/send` → `event: no_context` → persisted
   turn has `empty_retrieval: true`.
3. `POST /retrieval/search` returns expected chunks independently of
   chat.

### 9.4 Frontend

Under `apps/desktop/src/routes/chat/__tests__/`:

- MSW-mocked `/chat/send` emitting a canned SSE sequence →
  Conversation renders user turn, streaming assistant content, then
  citation chips.
- `no_context` frame → empty state with rebuild link.
- Privacy on + remote provider → send disabled, helper shown.

## 10. Manual acceptance

Mirrors §3.4's §9.5. All steps run against a real backend + real
LM Studio + (where applicable) a GitHub Models PAT.

1. Vault with one imported PDF → `POST /chat/reindex` → `GET
   /chat/index/status` reports `note_count ≥ 1`.
2. Ask a question whose answer is in that PDF → response streams,
   `[1]` chip resolves to the correct `DocumentRecord`.
3. Ask a question not in the vault → `no_context` empty state shown,
   no LLM call (verify via LM Studio server log — zero requests).
4. Hand-edit the `DocumentRecord`'s body → reload vault → index status
   shows `stale_notes: 1` → "Rebuild index" → stale count returns to
   zero and the next chat reflects the edit.
5. Multi-turn: ask a question, then a follow-up ("tell me more about
   that") → second turn retrieves fresh chunks but history is
   included in the prompt (verify via LM Studio server log showing
   both turns in the request body).
6. Privacy ON + remote provider selected → send disabled, helper text
   shown. Flip privacy OFF → send enabled.
7. Delete a session from the sidebar → `70_chats/{id}.md` is removed
   from disk and a git commit is recorded.

## 11. Open questions (to tune with real usage)

- BM25 cutoff (-0.5 is a guess; may need retuning once we have
  realistic vaults).
- Top-K (6 is a guess; larger vaults may want 8–10 once context
  budgets allow).
- Chunk size (500 tokens, paragraph-aligned — good for prose, may be
  wrong for code-heavy notes).
- History cap (10 turns — fine for most chats, may need summarization
  for long research sessions).

These become the subject of a follow-up tuning pass once we have
instrumentation. They are deliberately not user-facing knobs in v1.
