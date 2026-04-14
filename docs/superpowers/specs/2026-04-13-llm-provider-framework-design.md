# LLM Provider Framework — Design

**Status:** Draft — 2026-04-13
**Parent umbrella:** `docs/superpowers/specs/2026-04-12-lifescribe-vault-overview.md` §3.4
**Depends on:** Vault Foundation, Ingestion Pipeline, Dashboard Shell (all merged in M1).
**Unblocks:** §3.5 Chat with Vault.

## 1. Purpose

Deliver a provider-agnostic LLM abstraction that LifeScribe Vault can use for
chat, and eventually for agent and retrieval features. Ships with two built-in
providers — **LM Studio** (local) and **GitHub Models** (remote, via a GitHub
Copilot Pro PAT) — exercising one local and one remote adapter so the privacy
master-switch is meaningfully tested end-to-end. Lays enough of the interface
that §3.5 Chat with Vault can start on day one.

## 2. Scope

**In scope (v1):**

- `LLMProvider` ABC + `PrivacyGuard` transport wrapper.
- Built-in adapters: LM Studio and GitHub Models. Both speak OpenAI-compatible
  HTTP (`/v1/chat/completions`, `/v1/models`).
- New note type `LLMProvider` at `system/providers/<id>.md` with
  `schema_version: 1`.
- OS keyring integration via the `keyring` package for credentials.
- HTTP routes under `/llm`: full CRUD for providers, credential route, model
  discovery, non-streaming chat, and SSE streaming chat.
- Two-layer enforcement of the privacy master-switch (existing
  `VaultSettings.privacy_mode`): a fast-fail check in the service layer and a
  URL allow-list in the transport wrapper.
- Typed TypeScript client bindings and react-query hooks in
  `apps/desktop/src/api/`. No UI this sub-project — §3.5 builds on top.

**Explicitly deferred:**

- Tool/function calling — added in §3.5 when a real consumer exists.
- Embeddings — separate sub-project.
- OAuth device-code sign-in for GitHub Models — PAT paste only in v1.
- Additional built-in providers (OpenAI, Anthropic, Ollama) — each a small
  follow-up sub-project.
- Python-plugin extensibility — third parties supply an OpenAI-compatible URL.
- Usage/cost tracking, rate limits, retry-with-backoff.
- Frontend UI.

## 3. Invariants honored

| # | Invariant | How this sub-project honors it |
|---|---|---|
| 1 | Vault is system of record | Provider configs live as `LLMProvider` notes. No app-side config DB. Credentials are the single exception (secrets cannot live in a git-tracked, hand-inspectable plaintext store). |
| 4 | Schema-versioned frontmatter | `LLMProvider` adds `schema_version: 1` and joins the discriminated union. |
| 5 | Hand-edit safety | `PUT /llm/providers/{id}` routes through `VaultStore.write_note`, so hand edits in Obsidian produce conflict files. |
| 12 | Git-backed vault | Every provider config change is one commit. Credentials are excluded by living in the OS keyring. |
| 13 | Inspectable in plain Obsidian | Provider notes are plain Markdown with YAML frontmatter. Secrets are referenced by a `secret_ref` keyring key, not embedded. |
| — | "Never leave the machine" (umbrella §3.4) | Two-layer enforcement: service-layer fast-fail on declared `local`, plus transport-layer URL allow-list that ignores the declaration. |

## 4. Architecture

### 4.1 Backend module layout

```
apps/backend/src/lifescribe/
├── llm/
│   ├── __init__.py
│   ├── base.py                 # LLMProvider ABC, ChatMessage, ChatChunk, ChatRequest, ModelInfo
│   ├── privacy.py              # PrivacyGuard: URL allow-list + local-flag check
│   ├── openai_compatible.py    # shared HTTP client (streaming SSE + non-streaming)
│   ├── providers/
│   │   ├── __init__.py
│   │   ├── lmstudio.py         # LMStudioProvider
│   │   └── github_models.py    # GitHubModelsProvider
│   ├── registry.py             # loads LLMProvider notes, resolves secrets, instantiates providers
│   ├── secrets.py              # keyring wrapper (get/set/delete by ref)
│   └── service.py              # façade used by the router; performs the fast-fail privacy check
├── api/routers/
│   └── llm.py                  # /llm/* HTTP endpoints
└── vault/schemas.py            # + LLMProvider discriminated-union branch
```

### 4.2 Boundaries

- `base.py` — only abstract types and dataclasses. No I/O. Depends on `pydantic`.
- `privacy.py` — a pure function of `(url, privacy_mode, local_declared)`. No I/O. 100% unit-testable.
- `openai_compatible.py` — thin `httpx.AsyncClient` wrapper exposing
  `stream_chat(req) -> AsyncIterator[ChatChunk]` and `list_models()`. Every
  outbound call runs through `PrivacyGuard` first.
- `providers/*.py` — each ~30 lines: a config dataclass plus a factory that
  wires the OpenAI-compatible client with base URL and auth headers.
- `registry.py` — reads the latest provider note on every `get()` (no
  cross-write cache) and builds the concrete provider object. Credential
  resolution happens here.
- `secrets.py` — facade: `get(ref) -> str | None`, `set(ref, value)`,
  `delete(ref)`. Backed by `keyring.get_password("lifescribe-vault", ref)`.
  Tests inject an in-memory backend.
- `service.py` — the only thing the router calls. Orchestrates registry +
  privacy. Never lets the router touch providers directly.
- `api/routers/llm.py` — paper-thin FastAPI handlers. No business logic.

### 4.3 Two-layer privacy enforcement

1. **Fast-fail (`service.py`).** Before constructing the provider, if
   `settings.privacy_mode and not provider.local` → raise
   `PrivacyViolation("remote_provider_disabled")` → HTTP 403 with clear
   `detail`. Cheapest possible rejection; never opens a socket.
2. **Transport guarantee (`openai_compatible.py` via `PrivacyGuard`).** Every
   HTTP call inspects the resolved URL host. If privacy is on and the host
   isn't `127.0.0.1`, `::1`, or `localhost`, raise
   `PrivacyViolation("url_not_local")`. Works even if a provider note lies
   about `local`.

## 5. Data model

### 5.1 New note type

```python
# vault/schemas.py addition
class LLMProvider(_NoteBase):
    type: Literal["LLMProvider"] = "LLMProvider"
    schema_version: int = 1
    adapter: Literal["openai_compatible"] = "openai_compatible"
    display_name: str
    base_url: str
    local: bool
    secret_ref: str | None = None
    default_model: str | None = None
    enabled: bool = True
```

- Id prefix: `llm_`. Routed by `_relative_path_for` to
  `system/providers/<id>.md`.
- No tokens or keys in this schema. Ever.
- `secret_ref` convention: `llm.<provider_id>.token`
  (e.g., `llm.llm_github_default.token`).

### 5.2 Request / response DTOs (`llm/base.py`)

```python
class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str

class ChatRequest(BaseModel):
    provider_id: str
    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    max_tokens: int | None = None

class ChatChunk(BaseModel):
    delta: str
    finish_reason: str | None = None

class ModelInfo(BaseModel):
    id: str
    context_length: int | None = None
```

No tool-calling fields yet. Adding them is additive and doesn't break callers.

### 5.3 Error hierarchy

Single exception hierarchy mapped to HTTP:

| Exception | HTTP | `detail.code` |
|---|---|---|
| `PrivacyViolation` | 403 | `remote_provider_disabled` or `url_not_local` |
| `ProviderNotFound` | 404 | `provider_not_found` |
| `CredentialMissing` | 400 | `credential_missing` |
| `UpstreamError` | 502 | `upstream_<status>` or `upstream_network` |
| `UpstreamTimeout` | 504 | `upstream_timeout` |

Responses carry `{detail: {code, message}}`. `message` is short and
user-safe.

### 5.4 Credential lifecycle

- `PUT /llm/providers/{id}/credential` — body `{value: string}`. Writes
  keyring at the resolved `secret_ref` (synthesized as
  `llm.<id>.token` if the note has none). If synthesized, the note is
  updated with the new `secret_ref` in the same request. Response: 204.
- `DELETE /llm/providers/{id}/credential` — removes the keyring entry.
  Response: 204.
- Credentials **never** appear in `GET` responses. Providers return
  `has_credential: bool` only.

## 6. HTTP API

All routes under `/llm`, gated by the existing bearer-auth dependency. JSON
in/out except the streaming chat route.

### 6.1 Providers CRUD

```
GET    /llm/providers
  → 200 [{ id, type, display_name, base_url, local, default_model,
           enabled, has_credential, schema_version, ... }]

GET    /llm/providers/{id}
  → 200 { ... }
  → 404 provider_not_found

POST   /llm/providers
  body: LLMProvider frontmatter (no id — server assigns llm_<slug>_<nonce>)
  → 201 { id, ... }
  → 400 validation_error

PUT    /llm/providers/{id}
  body: LLMProvider frontmatter (id in path authoritative)
  → 200 { id, ... }
  Writes via VaultStore.write_note → conflict-file semantics on hand-edit race.

DELETE /llm/providers/{id}
  → 204
  Also deletes the keyring entry if secret_ref is set.
```

### 6.2 Credential

```
PUT    /llm/providers/{id}/credential
  body: { value: string }
  → 204
  → 404 provider_not_found

DELETE /llm/providers/{id}/credential
  → 204
```

### 6.3 Model discovery

```
GET    /llm/providers/{id}/models
  → 200 [{ id, context_length? }]
  → 403 privacy violation (if remote and privacy_mode on)
  → 400 credential_missing
  → 502 upstream_<status>

Internal TTL cache keyed by (provider_id, credential_version) for 300s.
```

### 6.4 Chat

```
POST   /llm/chat
  body: ChatRequest
  → 200 application/json
      { content: string, finish_reason: string }

POST   /llm/chat/stream
  body: ChatRequest
  → 200 text/event-stream
      event: chunk
      data: {"delta":"Hel"}
      event: chunk
      data: {"delta":"lo."}
      event: done
      data: {"finish_reason":"stop"}
  Errors after the first chunk:
      event: error
      data: {"code":"upstream_502","message":"..."}
      (then stream closes)
  Errors before the first chunk return a regular JSON error response.
```

### 6.5 Frontend client plumbing

`apps/desktop/src/api/client.ts`:

```ts
listProviders()           → LLMProviderDTO[]
getProvider(id)           → LLMProviderDTO
createProvider(body)      → LLMProviderDTO
updateProvider(id, body)  → LLMProviderDTO
deleteProvider(id)        → void
setCredential(id, value)  → void
deleteCredential(id)      → void
listModels(id)            → ModelInfo[]
chat(req)                 → { content: string, finish_reason: string }
chatStream(req, signal)   → AsyncIterable<ChatChunk>   // fetch + ReadableStream SSE parser
```

`apps/desktop/src/api/queries.ts` gains react-query hooks for the
non-streaming calls. `chatStream` is a direct async iterator; react-query
manages requests, not streams.

## 7. Data flow

### 7.1 Streaming chat — happy path

```
UI (§3.5)
  → POST /llm/chat/stream  { provider_id, model, messages }

FastAPI llm router
  → service.stream_chat(provider_id, request)

service.stream_chat:
  1. settings = vault_store.read_settings()
  2. provider_note = registry.get_provider_note(provider_id)  # 404 if missing
  3. if settings.privacy_mode and not provider_note.local:
         raise PrivacyViolation("remote_provider_disabled")   # fast-fail
  4. provider = registry.instantiate(provider_note)           # resolves secret
  5. async for chunk in provider.stream_chat(request):
         yield chunk

provider.stream_chat (OpenAICompatible):
  1. PrivacyGuard.check(base_url, settings.privacy_mode, provider.local)
     # raises PrivacyViolation("url_not_local") if declaration lied
  2. httpx stream POST base_url + "/chat/completions"
  3. Parse upstream SSE into ChatChunk
  4. yield each chunk

FastAPI router re-emits chunks as SSE frames to the client.
```

### 7.2 Non-streaming chat

`service.chat()` consumes `stream_chat()` and concatenates deltas. One
implementation, two surfaces.

### 7.3 List models

```
GET /llm/providers/{id}/models
  → service.list_models(id)
      → registry.instantiate(id)
      → provider.list_models()   # GET base_url + "/models", PrivacyGuard-gated
      → TTL cache (5 min) keyed by (provider_id, credential_version)
```

`credential_version` is a per-provider counter bumped on
`PUT`/`DELETE /credential`. Stale caches auto-invalidate on PAT rotation.

### 7.4 Provider CRUD

```
POST /llm/providers
  1. Validate body against LLMProvider schema.
  2. Generate id: f"llm_{slug(display_name)}_{short_nonce}".
  3. vault_store.write_note(LLMProvider(...))  # one git commit.
  4. Return envelope with has_credential=False.

PUT /llm/providers/{id}
  1. Validate body.
  2. Read existing note (404 if gone).
  3. Apply changes; write via vault_store.write_note.

DELETE /llm/providers/{id}
  1. Read note; if secret_ref set, keyring.delete_password(secret_ref).
  2. vault_store.delete_note(id).
```

### 7.5 Cache invalidation

| Event | Invalidates |
|---|---|
| `PUT`/`DELETE /credential` | bump credential_version → models cache for that provider |
| `PUT`/`POST`/`DELETE /providers/{id}` | models cache for that id |
| `PUT /vault/settings` (privacy toggle) | nothing cached; fast-fail re-evaluated per request |

No websockets. No daemon. Every request is stateless beyond the TTL cache.

### 7.6 Back-pressure and cancellation

- Upstream SSE body consumed line-by-line; no chunk buffering beyond the one
  currently being yielded.
- Client disconnect → FastAPI raises `asyncio.CancelledError` →
  `httpx` client closes → upstream stream torn down.
- Client cancel is the only cancellation path in v1. No server-side "stop"
  endpoint until §3.5 proves it's needed.

## 8. Error handling

### 8.1 Mapping

| Failure | Exception | HTTP | `detail.code` |
|---|---|---|---|
| Privacy switch blocks remote provider | `PrivacyViolation("remote_provider_disabled")` | 403 | `remote_provider_disabled` |
| URL outside allow-list under privacy | `PrivacyViolation("url_not_local")` | 403 | `url_not_local` |
| Provider note missing | `ProviderNotFound` | 404 | `provider_not_found` |
| `secret_ref` set, keyring empty | `CredentialMissing` | 400 | `credential_missing` |
| Upstream 4xx (auth, bad model, quota) | `UpstreamError(status, body)` | 502 | `upstream_<status>` |
| Upstream 5xx | `UpstreamError` | 502 | `upstream_<status>` |
| Upstream timeout (connect 5s, read 60s) | `UpstreamTimeout` | 504 | `upstream_timeout` |
| Upstream network/DNS/TLS | `UpstreamError` | 502 | `upstream_network` |
| Schema validation on provider body | Pydantic | 400 | `validation_error` |
| Hand-edit race on `PUT` provider | (existing) | 409 | `conflict_file_written` |

### 8.2 Streaming error semantics

- Error **before** first chunk → regular HTTP JSON error response; no SSE frames.
- Error **mid-stream** → one `event: error` SSE frame, then stream closes.
  Client has partial content and renders an inline error marker.
- Client disconnect → no error reported; upstream torn down; DEBUG log only.

### 8.3 Logging

Structured `logging` records:

- `INFO` — every `/llm/chat*` request with `provider_id`, `model`, chunk count,
  latency. No prompt bodies.
- `WARNING` — `PrivacyViolation`, `CredentialMissing`.
- `ERROR` — `UpstreamError`, `UpstreamTimeout`, unexpected exceptions.

No prompt or response bodies are ever logged.

### 8.4 Secret redaction

If an upstream response body is embedded in an error payload, it runs through
a small redactor that masks anything matching the active credential value for
the current `credential_version`. Prevents accidental token echo.

## 9. Testing

### 9.1 Backend — pytest

```
apps/backend/tests/
├── llm/
│   ├── test_privacy_guard.py       # unit: URL allow-list
│   ├── test_secrets.py             # keyring wrapper with in-memory backend
│   ├── test_openai_compatible.py   # SSE parser; pytest-httpx mocks
│   ├── test_registry.py            # note → instantiate; missing/disabled paths
│   ├── test_service.py             # two-layer privacy fast-fail with fake provider
│   └── providers/
│       ├── test_lmstudio.py        # http-mocked chat + models
│       └── test_github_models.py   # http-mocked chat; PAT header wiring
├── test_api_llm_providers.py       # CRUD; conflict file on hand-edit race
├── test_api_llm_credential.py      # PUT/DELETE; credential_version bumps; token never leaks
├── test_api_llm_chat.py            # non-stream + SSE; 403 privacy; 502/504 upstream
└── integration/
    └── test_llm_smoke.py           # end-to-end via TestClient against mocked HTTP
```

Key non-obvious assertions:

| Module | Assertion |
|---|---|
| `test_privacy_guard.py` | `http://127.0.0.1:1234` allowed; `http://192.168.0.5` blocked; `http://localhost` allowed; `https://evil.com/127.0.0.1` (as path) blocked |
| `test_service.py` | Service never calls `provider.stream_chat` when privacy blocks; calls through when privacy is off |
| `test_api_llm_credential.py` | `GET /providers/{id}` never echoes tokens; two `GET /models` → cache hit; `PUT /credential` → cache miss |
| `test_api_llm_chat.py` | Error before first chunk = 502 JSON; error mid-stream = `event: error` SSE frame then close |
| `test_openai_compatible.py` | `data: [DONE]` terminates stream; malformed SSE lines skipped (WARNING log), never crash |

Mocking:

- `httpx` via `pytest-httpx`.
- `keyring` via `keyrings.alt.file.PlaintextKeyring` pointed at `tmp_path` in
  a `conftest.py` fixture. No real HTTP leaves the test process. No real
  OS-native keyring touched in CI.

### 9.2 Frontend — Vitest

```
apps/desktop/src/api/__tests__/
├── client.llm.test.ts      # every LLM method wires the right URL/method/body
└── chatStream.test.ts      # ReadableStream SSE parser
```

No route or component tests this sub-project — no UI ships. §3.5 adds those.

Key assertions:

- `chatStream` yields `ChatChunk` objects in order; completes with
  `finish_reason`; throws a typed error on mid-stream `event: error`.
- Aborting the underlying `AbortController` cancels the iterator and closes
  the fetch.

### 9.3 CI

Existing matrix (backend + frontend × Ubuntu / macOS / Windows). New tests run
automatically.

### 9.4 Type generation

`gen-types.sh` regenerates `packages/shared-types/src/generated.ts`.
CI gate: `git diff --exit-code` on that file.

### 9.5 Manual acceptance (pre-merge)

1. Create an LM Studio provider (no credential) → `GET /models` returns the
   locally-loaded model list.
2. Non-streaming chat against LM Studio → prose returned.
3. Streaming chat against LM Studio → chunks arrive progressively (observe
   via `curl -N`).
4. Create a GitHub Models provider; `PUT` a PAT as credential; list models;
   stream a chat.
5. Toggle privacy mode on. Stream chat against GitHub Models → 403
   `remote_provider_disabled` (fast-fail path).
6. Hand-edit the GitHub Models note to `local: true`; retry → 403
   `url_not_local` (transport allow-list).
7. `DELETE /providers/{id}` → note gone; keyring entry gone.

## 10. Dependencies

Added to `apps/backend/pyproject.toml`:

- `keyring` ^24 — OS-native credential storage (production).
- `keyrings.alt` ^5 (dev-only) — `PlaintextKeyring` for the test fixture.
- `pytest-httpx` ^0.30 (dev-only) — HTTP mocking for provider adapters.

`httpx` is already present (FastAPI's `TestClient` depends on it).

Frontend: none. SSE parsed via native `fetch` + `ReadableStream`.

## 11. Success criteria

1. `LLMProvider` note type persisted, versioned, and hand-editable.
2. Both built-in adapters complete non-streaming and streaming chat against
   live endpoints (manual acceptance).
3. Privacy master-switch provably blocks remote providers via both the
   fast-fail path and the transport allow-list — independently tested.
4. PAT round-trips via OS keyring; never appears in any `GET` response,
   any log line, or any error payload.
5. Hand-editing a provider note routes through `VaultStore` with conflict-file
   semantics preserved.
6. Model discovery is cached but invalidates on credential rotation and
   provider edit.
7. `ruff format --check`, `ruff check`, `mypy --strict`, `pytest`, and frontend
   `typecheck` / `lint` / `format:check` / `test` all green on the CI matrix
   (Linux, macOS, Windows).
8. `gen-types.sh` idempotent; `git diff --exit-code packages/shared-types/`
   clean.
9. User doc `docs/user/llm-providers.md` ships: how to add LM Studio, how to
   add GitHub Models with a PAT, what the privacy switch does.

## 12. Non-goals (deferred)

- UI — lands in §3.5.
- Tool/function calling, embeddings, fine-tune/upload endpoints.
- OAuth device-code sign-in for GitHub; PAT paste only.
- OpenAI, Anthropic, Ollama adapters (separate sub-projects).
- Usage/cost tracking, rate limits, retry-with-backoff.
- Python-plugin extensibility. Third parties supply an OpenAI-compatible URL.
