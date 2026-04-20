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

- [ ] **Reasoning-model support.** `openai_compatible.py:151` only reads `delta.content`. Reasoning models (qwen3, glm-4.5-air with thinking enabled) emit tokens into `delta.reasoning_content` until they commit to an answer; if they hit a token limit during the thinking phase, `content` stays empty and the user sees a blank assistant bubble. Options: (a) surface `reasoning_content` as a collapsible "thinking" section in `MessageBubble`, (b) filter it out and only stream `content` (current behavior — but document the limitation), (c) add a provider-level toggle.
- [ ] **Chat error swallowing.** `Conversation.tsx` catches stream errors silently (`// error is surfaced via MessageBubble render of the partial assistant content`). If the LLM fails after retrieval succeeds, the user sees an empty bubble with no indication of failure. Render `ChatStreamError.code` and `message` inline.
- [ ] **Sidecar zombie cleanup on dev reload.** Closing the Tauri window sometimes leaves `lifescribe-backend.exe` processes running, which then lock the binary and break the next `tauri dev` rebuild. Add a kill on Tauri `on_window_event(Destroyed)` or a pre-dev-launch task that clears lingering sidecars.

## §3.6 Connector Framework — deferred manual acceptance

Branch `feat/connector-framework` shipped with automated gauntlet green (backend 259/259, frontend 59/59, mypy + ruff + eslint + tsc all clean) but the six hands-on acceptance steps from §8.5 of [2026-04-16-connector-framework-design.md](specs/2026-04-16-connector-framework-design.md) require a dev build to walk through:

- [x] **Step 1 — ingest a PDF.** Pass: PDF imported as SourceRecord, single-commit bundling confirmed.
- [x] **Step 2 — dedupe.** Pass: re-import skipped with `skipped_count == 1`.
- [x] **Step 3 — catalog rendering.** Pass: File Drop card shown with description, metadata, export instructions, and sample file links.
- [x] **Step 4 — privacy-mode pass-through.** Pass: `local_only` connector unblocked under privacy mode.
- [ ] **Step 5 — blocked badge + 409.** Skipped: no `requires_network` connector in catalog; logic is unit-tested.
- [x] **Step 6 — missing manifest resilience.** Pass: empty manifest reported missing fields, File Drop still loaded.

Packaging follow-ups (unblock Step 1 on packaged builds):

- [ ] **Rebuild sidecar + smoke-test packaged app.** `scripts/build-backend.sh` + `scripts/build-backend.ps1` now copy `connectors/` alongside `lifescribe-backend[.exe]`, and `connectors_dir()` already falls back to `<executable_dir>/connectors`. Confirm end-to-end: run the build script, launch the packaged Tauri app, and verify Settings → Connectors lists `file_drop`.

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

**Reference:** [umbrella spec §3.7](specs/2026-04-12-lifescribe-vault-overview.md), cross-cutting invariants #7 (privacy switch), #8 (per-source privacy labels), #9 (publisher extension point).
