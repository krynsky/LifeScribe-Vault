# Backlog

Work carried over from completed features. Each entry links to the spec or plan that originated it.

## §3.5 Chat with Vault — deferred acceptance steps

Branch `feat/chat-with-vault` shipped with manual acceptance partially completed. Remaining steps from §10 of [2026-04-14-chat-with-vault-design.md](specs/2026-04-14-chat-with-vault-design.md):

- [x] **Step 3 — empty retrieval path.** Soft pass: BM25 matched common words so short-circuit didn't fire, but LLM correctly responded "not in sources." Tuning item: add stopword filtering or raise BM25 cutoff threshold.
- [x] **Step 4 — stale detection.** Pass: edited a vault note, stale indicator appeared in Settings → Index, Rebuild cleared it.
- [x] **Step 5 — multi-turn history.** Pass: 3-turn conversation referenced prior turns with citations.
- [x] **Step 6 — privacy gate.** Half-pass: local provider (LM Studio) correctly remained unblocked under privacy mode. Remote-provider blocking untestable (no remote provider configured); logic is unit-tested.
- [x] **Step 7 — session deletion.** Pass: delete button added to sidebar (was missing), session removed from sidebar and `70_chats/` `.md` file deleted.

## §3.5 follow-ups discovered during acceptance

- [x] **Reasoning-model support.** Fixed: OpenAI-compatible streams now preserve `delta.reasoning_content` / `delta.reasoning`, chat sends it as `reasoning` SSE events, assistant turns persist `reasoning_content`, and the desktop chat UI renders it in a collapsible "Thinking" section.
- [x] **Chat error swallowing.** Fixed: added `error` state to `UIState` in `Conversation.tsx`. Stream errors now render inline with red error banner showing the error message instead of a blank bubble.
- [x] **Sidecar zombie cleanup on dev reload.** Fixed: added `on_window_event(Destroyed)` handler in `main.rs` that kills the sidecar `CommandChild` when the window closes.

## §3.6 Connector Framework — deferred manual acceptance

Branch `feat/connector-framework` shipped with automated gauntlet green (backend 259/259, frontend 59/59, mypy + ruff + eslint + tsc all clean) but the six hands-on acceptance steps from §8.5 of [2026-04-16-connector-framework-design.md](specs/2026-04-16-connector-framework-design.md) require a dev build to walk through:

- [x] **Step 1 — ingest a PDF.** Pass: PDF imported as SourceRecord, single-commit bundling confirmed.
- [x] **Step 2 — dedupe.** Pass: re-import skipped with `skipped_count == 1`.
- [x] **Step 3 — catalog rendering.** Pass: File Drop card shown with description, metadata, export instructions, and sample file links.
- [x] **Step 4 — privacy-mode pass-through.** Pass: `local_only` connector unblocked under privacy mode.
- [x] **Step 5 — blocked badge + 409.** Pass: catalog blocking is covered with a temporary `requires_network` connector, and the generic `POST /imports` route now returns HTTP 409 before instantiating network connectors when Privacy Mode is on.
- [x] **Step 6 — missing manifest resilience.** Pass: empty manifest reported missing fields, File Drop still loaded.

Packaging follow-ups (unblock Step 1 on packaged builds):

- [x] **Rebuild sidecar + smoke-test packaged app.** Pass: rebuilt the backend sidecar and Tauri installer, reinstalled the app, removed the external installed `connectors/` folder, and verified the packaged backend can still load embedded connectors and import test files.

## §3.7 Publishing Framework — deferred to v2

**Decision (2026-04-16):** §3.7 is deferred entirely. v1.0 ships with §3.1–§3.6. Rationale: the primary destination (lifescribe.us) does not yet have a receiving API, so the publisher framework would have no real integration target. Building a framework against a hypothetical API risks misalignment when the real API lands.

**Blocked on:**
- [ ] lifescribe.us API for receiving published content (external dependency)

**When unblocked, scope includes:**
- Publisher ABC (configure → dry-run → publish → receipt lifecycle)
- Privacy-label enforcement gate (`PUBLISHABLE` notes only, or user-confirmed override)
- Publish receipts stored in `60_publish/` (reserved folder already exists in vault layout)
- Idempotent retries with receipt-based dedupe
- Mapping UI for selecting/curating notes before publish
- LifeScribe destination (first real publisher)
- Optional MCP bridge (expose curated vault content to external AI tools)

**Reference:** [umbrella spec §3.7](specs/2026-04-12-lifescribe-archive-overview.md), cross-cutting invariants #7 (privacy switch), #8 (per-source privacy labels), #9 (publisher extension point).
