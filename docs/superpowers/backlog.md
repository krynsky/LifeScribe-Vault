# Backlog

Work carried over from completed features. Each entry links to the spec or plan that originated it.

## §3.5 Chat with Vault — deferred acceptance steps

Branch `feat/chat-with-vault` shipped with manual acceptance partially completed. Remaining steps from §10 of [2026-04-14-chat-with-vault-design.md](specs/2026-04-14-chat-with-vault-design.md):

- [ ] **Step 3 — empty retrieval path.** Ask a question with no match in the vault (e.g. "What's the capital of Latvia?"). Expect the `no_context` UI banner and **zero** new chat completions in the LM Studio request log (backend must short-circuit before calling the LLM).
- [ ] **Step 4 — stale detection.** Hand-edit the body of a `DocumentRecord` `.md` in the vault (bump its mtime). Reload the app. Settings → Index should show `stale_notes >= 1`. Click Rebuild; the counter returns to 0.
- [ ] **Step 5 — multi-turn history.** Send 3+ turns in a single session. Inspect LM Studio's prompt log and confirm prior assistant/user turns are included in the request (capped at `_HISTORY_CAP = 10` per `chat/orchestrator.py`).
- [ ] **Step 6 — privacy gate.** Turn Privacy ON with a remote provider selected: the Send button must be disabled with an explanatory tooltip. Turn Privacy OFF: Send re-enables. With a local provider, Privacy ON must not block send.
- [ ] **Step 7 — session deletion.** Delete a chat session from the sidebar. Verify the corresponding `.md` in `70_chats/` is removed *and* a `chat: delete session <id>` git commit appears in the vault repo.

## §3.5 follow-ups discovered during acceptance

- [ ] **Reasoning-model support.** `openai_compatible.py:151` only reads `delta.content`. Reasoning models (qwen3, glm-4.5-air with thinking enabled) emit tokens into `delta.reasoning_content` until they commit to an answer; if they hit a token limit during the thinking phase, `content` stays empty and the user sees a blank assistant bubble. Options: (a) surface `reasoning_content` as a collapsible "thinking" section in `MessageBubble`, (b) filter it out and only stream `content` (current behavior — but document the limitation), (c) add a provider-level toggle.
- [ ] **Chat error swallowing.** `Conversation.tsx` catches stream errors silently (`// error is surfaced via MessageBubble render of the partial assistant content`). If the LLM fails after retrieval succeeds, the user sees an empty bubble with no indication of failure. Render `ChatStreamError.code` and `message` inline.
- [ ] **Sidecar zombie cleanup on dev reload.** Closing the Tauri window sometimes leaves `lifescribe-backend.exe` processes running, which then lock the binary and break the next `tauri dev` rebuild. Add a kill on Tauri `on_window_event(Destroyed)` or a pre-dev-launch task that clears lingering sidecars.

## §3.6 Connector Framework — deferred manual acceptance

Branch `feat/connector-framework` shipped with automated gauntlet green (backend 259/259, frontend 59/59, mypy + ruff + eslint + tsc all clean) but the six hands-on acceptance steps from §8.5 of [2026-04-16-connector-framework-design.md](specs/2026-04-16-connector-framework-design.md) require a dev build to walk through:

- [ ] **Step 1 — ingest a PDF.** Drop a PDF into the inbox. Expect it to appear as a SourceRecord note; `git log` in the vault should show both an `import: file_drop (1)` commit and a separate `ingest: <job_id>` commit (these currently land together via `VaultImporter.extra_notes`; confirm the single-commit bundling still holds).
- [ ] **Step 2 — dedupe.** Drop the same PDF a second time. The ingest log should report `skipped_count == 1`. No new `import:` commit expected. (A new `ingest:` log commit may still appear — that is current behavior and fine.)
- [ ] **Step 3 — catalog rendering.** Settings → Connectors shows the `file_drop` card with its description, supported formats, and an expandable export-instructions panel that renders the manifest markdown via `react-markdown`.
- [ ] **Step 4 — privacy-mode pass-through.** Toggle Privacy Mode on. `file_drop` remains fully usable because its manifest declares `privacy_posture = "local_only"`.
- [ ] **Step 5 — blocked badge + 409.** Create a stub manifest at `connectors/test_remote/manifest.toml` with `privacy_posture = "requires_network"`. With Privacy Mode on, the catalog card should render greyed out with the "blocked by privacy mode" badge; a POST that attempts to run that connector should return HTTP 409.
- [ ] **Step 6 — missing manifest resilience.** Delete `connectors/file_drop/manifest.toml`, restart the backend. Startup should succeed; `GET /connectors` should return an empty `entries` array with `warnings` listing the skipped directory.

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
