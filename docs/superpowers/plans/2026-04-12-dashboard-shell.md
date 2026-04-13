# Dashboard Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real UI for LifeScribe Vault — a Tauri shell that browses `SourceRecord` notes, imports files with live job status, shows ingestion logs, and exposes a privacy toggle. Closes M1 (v0.1).

**Architecture:** Backend gains four endpoints (`GET /vault/notes`, `GET /vault/notes/{id}`, `GET/PUT /vault/settings`) backed by a new `VaultSettings` note type. Frontend adopts `react-router-dom` + `@tanstack/react-query`, with a single `AppShell` (sidebar + outlet), four reusable components (`NoteList`, `MarkdownViewer`, `JobProgress`, `DropZone`), and five routes (`/browse`, `/import`, `/logs`, `/settings` plus viewer).

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, pytest · Tauri v2, React 18, Vite 5, TS 5.5, react-router-dom v6, @tanstack/react-query v5, react-markdown + remark-gfm, msw, Vitest.

**Working directory:** Repo root `D:\My Data\My Apps\lifescribe vault`. Branch `feat/dashboard-shell` (already created, spec committed at 2b4ad1a).

**Spec:** `docs/superpowers/specs/2026-04-12-dashboard-shell-design.md`.

---

## Phase 1 — Backend: `VaultSettings` schema

### Task 1: Add `VaultSettings` note type

**Files:**
- Modify: `apps/backend/src/lifescribe/vault/schemas.py`
- Modify: `apps/backend/src/lifescribe/vault/store.py` (routing in `_relative_path_for`)
- Create: `apps/backend/tests/vault/test_schemas_vault_settings.py`

- [ ] **Step 1: Write failing schema test**

Create `apps/backend/tests/vault/test_schemas_vault_settings.py`:

```python
import pytest
from pydantic import ValidationError

from lifescribe.vault.schemas import VaultSettings, parse_note


def test_vault_settings_defaults() -> None:
    s = VaultSettings(id="settings_default", type="VaultSettings")
    assert s.schema_version == 1
    assert s.privacy_mode is False


def test_vault_settings_id_prefix_required() -> None:
    with pytest.raises(ValidationError, match="settings_"):
        VaultSettings(id="wrong", type="VaultSettings")


def test_vault_settings_roundtrip_via_union() -> None:
    raw = {"id": "settings_default", "type": "VaultSettings", "privacy_mode": True}
    note = parse_note(raw)
    assert isinstance(note, VaultSettings)
    assert note.privacy_mode is True


def test_vault_settings_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        VaultSettings(
            id="settings_default",
            type="VaultSettings",
            bogus=1,  # type: ignore[call-arg]
        )
```

- [ ] **Step 2: Run test, confirm failure**

Run: `cd apps/backend && uv run pytest tests/vault/test_schemas_vault_settings.py -v`
Expected: FAIL — `VaultSettings` not importable.

- [ ] **Step 3: Add `VaultSettings` to schemas**

In `apps/backend/src/lifescribe/vault/schemas.py`, after `IngestJobLog`:

```python
class VaultSettings(_NoteBase):
    type: Literal["VaultSettings"]
    privacy_mode: bool = False

    @model_validator(mode="after")
    def _check_id_prefix(self) -> VaultSettings:
        if not self.id.startswith("settings_"):
            raise ValueError("VaultSettings id must start with 'settings_'")
        return self
```

Extend the `Note` union:

```python
Note = Annotated[
    SourceRecord
    | DocumentRecord
    | ConnectorRecord
    | IngestionLogEntry
    | IngestJobLog
    | VaultManifest
    | VaultSettings,
    Field(discriminator="type"),
]
```

- [ ] **Step 4: Route `VaultSettings` to `system/settings.md`**

In `apps/backend/src/lifescribe/vault/store.py`, import `VaultSettings` from schemas and add to `_relative_path_for` before the `VaultManifest` branch:

```python
    if isinstance(note, VaultSettings):
        return root / "system" / "settings.md"
```

- [ ] **Step 5: Run test to confirm pass**

Run: `cd apps/backend && uv run pytest tests/vault/test_schemas_vault_settings.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Run full backend test suite**

Run: `cd apps/backend && uv run pytest -q`
Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/lifescribe/vault/schemas.py apps/backend/src/lifescribe/vault/store.py apps/backend/tests/vault/test_schemas_vault_settings.py
git commit -m "feat(vault): add VaultSettings note type"
```

---

## Phase 2 — Backend: vault-notes and settings endpoints

### Task 2: `GET /vault/notes?type=`

**Files:**
- Modify: `apps/backend/src/lifescribe/api/routers/vault.py`
- Create: `apps/backend/tests/test_api_vault_notes.py`

- [ ] **Step 1: Write failing route test**

Create `apps/backend/tests/test_api_vault_notes.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lifescribe.api.app import create_app
from lifescribe.api.routers.vault import _State
from lifescribe.vault.schemas import SourceRecord
from lifescribe.vault.store import VaultStore

TOKEN = "testtoken"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _reset_state() -> None:
    _State.store = None
    yield
    _State.store = None


@pytest.fixture
def client_with_store(tmp_path: Path) -> TestClient:
    store = VaultStore.init(tmp_path / "vault", app_version="0.0.0-test")
    _State.store = store
    return TestClient(create_app(auth_token=TOKEN))


def _make_source(store: VaultStore, id_: str, title: str) -> None:
    note = SourceRecord(
        id=id_,
        type="SourceRecord",
        source_path="/abs/x.txt",
        source_hash="deadbeef" * 8,
        source_mtime=datetime.now(UTC),
        imported_at=datetime.now(UTC),
        imported_by_job="job_test",
        extractor="text@0.1.0",
        extractor_confidence=1.0,
        mime_type="text/plain",
        original_filename="x.txt",
        size_bytes=3,
    )
    store.write_note(note, body=f"# {title}\n", commit_message="test")


def test_list_notes_by_type(client_with_store: TestClient) -> None:
    store = _State.store
    assert store is not None
    _make_source(store, "src_alpha-11111111", "Alpha")
    _make_source(store, "src_beta-22222222", "Beta")

    r = client_with_store.get("/vault/notes?type=SourceRecord", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    ids = {n["id"] for n in body}
    assert ids == {"src_alpha-11111111", "src_beta-22222222"}
    assert all(n["type"] == "SourceRecord" for n in body)


def test_list_notes_unknown_type(client_with_store: TestClient) -> None:
    r = client_with_store.get("/vault/notes?type=Bogus", headers=HEADERS)
    assert r.status_code == 400


def test_list_notes_empty_when_none_match(client_with_store: TestClient) -> None:
    r = client_with_store.get("/vault/notes?type=IngestJobLog", headers=HEADERS)
    assert r.status_code == 200
    assert r.json() == []


def test_list_notes_requires_open_vault(tmp_path: Path) -> None:
    client = TestClient(create_app(auth_token=TOKEN))
    r = client.get("/vault/notes?type=SourceRecord", headers=HEADERS)
    assert r.status_code == 409
```

- [ ] **Step 2: Run test, confirm failure**

Run: `cd apps/backend && uv run pytest tests/test_api_vault_notes.py -v`
Expected: FAIL — endpoint missing.

- [ ] **Step 3: Implement endpoint**

In `apps/backend/src/lifescribe/api/routers/vault.py`, add near the bottom:

```python
_ALLOWED_NOTE_TYPES = {
    "SourceRecord",
    "DocumentRecord",
    "ConnectorRecord",
    "IngestionLogEntry",
    "IngestJobLog",
    "VaultManifest",
    "VaultSettings",
}


def _require_store() -> VaultStore:
    if _State.store is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "vault not open")
    return _State.store


@router.get("/notes")
def list_notes(type: str) -> list[dict[str, Any]]:
    if type not in _ALLOWED_NOTE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown type: {type}")
    store = _require_store()
    return [n.model_dump(mode="json") for n in store.list_notes(type_=type)]
```

- [ ] **Step 4: Run test to pass**

Run: `cd apps/backend && uv run pytest tests/test_api_vault_notes.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/api/routers/vault.py apps/backend/tests/test_api_vault_notes.py
git commit -m "feat(api): GET /vault/notes?type= generic lister"
```

### Task 3: `GET /vault/notes/{id}`

**Files:**
- Modify: `apps/backend/src/lifescribe/api/routers/vault.py`
- Modify: `apps/backend/tests/test_api_vault_notes.py`

- [ ] **Step 1: Extend test file**

Append to `apps/backend/tests/test_api_vault_notes.py`:

```python
def test_get_note_returns_frontmatter_and_body(client_with_store: TestClient) -> None:
    store = _State.store
    assert store is not None
    _make_source(store, "src_gamma-33333333", "Gamma")

    r = client_with_store.get("/vault/notes/src_gamma-33333333", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["note"]["id"] == "src_gamma-33333333"
    assert body["note"]["type"] == "SourceRecord"
    assert body["body"].startswith("# Gamma")


def test_get_note_404(client_with_store: TestClient) -> None:
    r = client_with_store.get("/vault/notes/src_missing", headers=HEADERS)
    assert r.status_code == 404
```

- [ ] **Step 2: Run test, confirm failure**

Run: `cd apps/backend && uv run pytest tests/test_api_vault_notes.py::test_get_note_returns_frontmatter_and_body -v`
Expected: FAIL (404).

- [ ] **Step 3: Implement endpoint**

In `apps/backend/src/lifescribe/api/routers/vault.py`, add:

```python
@router.get("/notes/{note_id}")
def get_note(note_id: str) -> dict[str, Any]:
    store = _require_store()
    try:
        note, body = store.read_note(note_id)
    except KeyError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    return {"note": note.model_dump(mode="json"), "body": body}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/backend && uv run pytest tests/test_api_vault_notes.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/api/routers/vault.py apps/backend/tests/test_api_vault_notes.py
git commit -m "feat(api): GET /vault/notes/{id}"
```

### Task 4: `GET` and `PUT /vault/settings`

**Files:**
- Modify: `apps/backend/src/lifescribe/api/routers/vault.py`
- Create: `apps/backend/tests/test_api_vault_settings.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/test_api_vault_settings.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lifescribe.api.app import create_app
from lifescribe.api.routers.vault import _State
from lifescribe.vault.store import VaultStore

TOKEN = "testtoken"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _reset_state() -> None:
    _State.store = None
    yield
    _State.store = None


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    store = VaultStore.init(tmp_path / "vault", app_version="0.0.0-test")
    _State.store = store
    return TestClient(create_app(auth_token=TOKEN))


def test_get_settings_on_fresh_vault_returns_defaults(client: TestClient) -> None:
    r = client.get("/vault/settings", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["privacy_mode"] is False
    assert body["id"] == "settings_default"
    assert body["type"] == "VaultSettings"


def test_put_settings_persists(client: TestClient) -> None:
    r = client.put(
        "/vault/settings",
        headers=HEADERS,
        json={"privacy_mode": True},
    )
    assert r.status_code == 200
    assert r.json()["privacy_mode"] is True

    r2 = client.get("/vault/settings", headers=HEADERS)
    assert r2.json()["privacy_mode"] is True


def test_put_settings_rejects_unknown_fields(client: TestClient) -> None:
    r = client.put(
        "/vault/settings",
        headers=HEADERS,
        json={"privacy_mode": True, "bogus": 1},
    )
    assert r.status_code == 422
```

- [ ] **Step 2: Run test, confirm failure**

Run: `cd apps/backend && uv run pytest tests/test_api_vault_settings.py -v`
Expected: FAIL — endpoints missing.

- [ ] **Step 3: Implement endpoints**

In `apps/backend/src/lifescribe/api/routers/vault.py`, add:

```python
from lifescribe.vault.schemas import VaultSettings

_SETTINGS_ID = "settings_default"


class _SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    privacy_mode: bool


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    store = _require_store()
    try:
        note, _ = store.read_note(_SETTINGS_ID)
    except KeyError:
        return VaultSettings(id=_SETTINGS_ID, type="VaultSettings").model_dump(mode="json")
    assert isinstance(note, VaultSettings)
    return note.model_dump(mode="json")


@router.put("/settings")
def put_settings(req: _SettingsUpdate) -> dict[str, Any]:
    store = _require_store()
    note = VaultSettings(
        id=_SETTINGS_ID,
        type="VaultSettings",
        privacy_mode=req.privacy_mode,
    )
    store.write_note(note, body="", commit_message="settings: update")
    return note.model_dump(mode="json")
```

Add to imports at the top:

```python
from pydantic import BaseModel, ConfigDict
```

(Replace the existing `from pydantic import BaseModel` line.)

- [ ] **Step 4: Run tests**

Run: `cd apps/backend && uv run pytest tests/test_api_vault_settings.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full backend suite + lint**

Run: `cd apps/backend && uv run pytest -q && uv run ruff check && uv run ruff format --check && uv run mypy --strict src`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lifescribe/api/routers/vault.py apps/backend/tests/test_api_vault_settings.py
git commit -m "feat(api): GET/PUT /vault/settings with VaultSettings note"
```

---

## Phase 3 — Regenerate shared types

### Task 5: Regenerate TS types for new endpoints

**Files:**
- Modify: `packages/shared-types/openapi.json` (generated)
- Modify: `packages/shared-types/generated.ts` (generated)

- [ ] **Step 1: Regenerate**

Run: `bash scripts/gen-types.sh`
Expected: updates `openapi.json` and `generated.ts` with new routes and `VaultSettings` schema.

- [ ] **Step 2: Verify types include new endpoints**

Run: `grep -E "/vault/notes|/vault/settings|VaultSettings" packages/shared-types/generated.ts | head -20`
Expected: lines referencing each endpoint and type.

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/openapi.json packages/shared-types/generated.ts
git commit -m "chore(types): regenerate for notes and settings endpoints"
```

---

## Phase 4 — Frontend: dependencies and API layer

### Task 6: Install frontend dependencies

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `package-lock.json` (or pnpm/yarn lockfile in repo)

- [ ] **Step 1: Add deps**

In `apps/desktop/package.json`, under `dependencies` add:

```json
    "@tanstack/react-query": "^5.51.0",
    "react-markdown": "^9.0.1",
    "react-router-dom": "^6.26.0",
    "remark-gfm": "^4.0.0",
```

Under `devDependencies` add:

```json
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "jsdom": "^24.1.0",
    "msw": "^2.3.0",
```

- [ ] **Step 2: Install**

Run: `npm install --workspace lifescribe-desktop` (or the repo's equivalent — check `package.json` at repo root for the workspace tool).
Expected: lockfile updates, no peer dep errors.

- [ ] **Step 3: Configure vitest for jsdom**

Edit/create `apps/desktop/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
```

Create `apps/desktop/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom";
```

(Add `@testing-library/jest-dom` to devDependencies too: `"@testing-library/jest-dom": "^6.4.0"`, and re-run install.)

- [ ] **Step 4: Verify build still passes**

Run: `cd apps/desktop && npm run typecheck && npm run test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json apps/desktop/vitest.config.ts apps/desktop/src/test/setup.ts package-lock.json
git commit -m "chore(desktop): add router, react-query, markdown, msw deps"
```

### Task 7: Extend `api/client.ts`

**Files:**
- Modify: `apps/desktop/src/api/client.ts`
- Create: `apps/desktop/src/api/__tests__/client.test.ts`

- [ ] **Step 1: Write failing tests via MSW**

Create `apps/desktop/src/test/mockTauri.ts`:

```ts
import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    host: "127.0.0.1",
    port: 9999,
    token: "testtoken",
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
```

Create `apps/desktop/src/test/mswServer.ts`:

```ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const BASE = "http://127.0.0.1:9999";

export const server = setupServer(
  http.get(`${BASE}/vault/status`, () =>
    HttpResponse.json({ open: true, manifest: { id: "vault_x", type: "VaultManifest" } }),
  ),
);
```

Edit `apps/desktop/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom";
import "./mockTauri";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./mswServer";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Create `apps/desktop/src/api/__tests__/client.test.ts`:

```ts
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { api } from "../client";
import { BASE, server } from "../../test/mswServer";

describe("api client", () => {
  it("lists notes by type", async () => {
    server.use(
      http.get(`${BASE}/vault/notes`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("type")).toBe("SourceRecord");
        return HttpResponse.json([{ id: "src_a", type: "SourceRecord" }]);
      }),
    );
    const out = await api.notes("SourceRecord");
    expect(out).toEqual([{ id: "src_a", type: "SourceRecord" }]);
  });

  it("fetches a single note", async () => {
    server.use(
      http.get(`${BASE}/vault/notes/src_x`, () =>
        HttpResponse.json({
          note: { id: "src_x", type: "SourceRecord" },
          body: "# hello",
        }),
      ),
    );
    const out = await api.note("src_x");
    expect(out.body).toBe("# hello");
  });

  it("reads and writes settings", async () => {
    server.use(
      http.get(`${BASE}/vault/settings`, () =>
        HttpResponse.json({ id: "settings_default", type: "VaultSettings", privacy_mode: false }),
      ),
      http.put(`${BASE}/vault/settings`, async ({ request }) => {
        const body = (await request.json()) as { privacy_mode: boolean };
        return HttpResponse.json({
          id: "settings_default",
          type: "VaultSettings",
          privacy_mode: body.privacy_mode,
        });
      }),
    );
    const got = await api.settings();
    expect(got.privacy_mode).toBe(false);
    const saved = await api.saveSettings({ privacy_mode: true });
    expect(saved.privacy_mode).toBe(true);
  });

  it("posts a job", async () => {
    server.use(
      http.post(`${BASE}/ingest/jobs`, async ({ request }) => {
        const body = (await request.json()) as { files: string[] };
        expect(body.files).toEqual(["/a.txt"]);
        return HttpResponse.json(
          { job_id: "job_1", status: "queued", total: 1 },
          { status: 202 },
        );
      }),
    );
    const out = await api.ingest.create(["/a.txt"]);
    expect(out.job_id).toBe("job_1");
  });

  it("throws ApiError with status on non-2xx", async () => {
    server.use(
      http.post(`${BASE}/ingest/jobs`, () =>
        HttpResponse.json({ detail: "busy" }, { status: 409 }),
      ),
    );
    await expect(api.ingest.create(["/x"])).rejects.toMatchObject({
      status: 409,
      detail: "busy",
    });
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- api/client`
Expected: FAIL — methods missing.

- [ ] **Step 3: Rewrite `api/client.ts`**

Replace `apps/desktop/src/api/client.ts` with:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ApiErrorShape {
  status: number;
  message: string;
  detail?: string;
}

export class ApiError extends Error implements ApiErrorShape {
  status: number;
  detail?: string;
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export class SidecarDownError extends Error {
  constructor() {
    super("Sidecar not responding");
  }
}

interface BackendReady {
  host: string;
  port: number;
  token: string;
}

let cached: BackendReady | null = null;

async function getBackend(): Promise<BackendReady> {
  if (cached) return cached;
  const info = await invoke<BackendReady | null>("backend_info");
  if (info) {
    cached = info;
    return info;
  }
  return await new Promise<BackendReady>((resolve) => {
    const unlistenPromise = listen<BackendReady>("backend-ready", (evt) => {
      cached = evt.payload;
      resolve(evt.payload);
      unlistenPromise.then((u) => u());
    });
  });
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  let b: BackendReady;
  try {
    b = await getBackend();
  } catch {
    throw new SidecarDownError();
  }
  let res: Response;
  try {
    res = await fetch(`http://${b.host}:${b.port}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${b.token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new SidecarDownError();
  }
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const j = (await res.json()) as { detail?: string };
      detail = j.detail;
    } catch {
      detail = await res.text();
    }
    throw new ApiError(res.status, `${method} ${path} → ${res.status}`, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface VaultStatusDTO {
  open: boolean;
  manifest: Record<string, unknown> | null;
}

export interface NoteEnvelope {
  note: Record<string, unknown> & { id: string; type: string };
  body: string;
}

export interface VaultSettingsDTO {
  id: string;
  type: "VaultSettings";
  schema_version?: number;
  privacy_mode: boolean;
  [k: string]: unknown;
}

export interface JobDTO {
  job_id: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "completed_with_failures"
    | "cancelled"
    | "failed";
  total: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
  cancelled?: number;
  files?: unknown[];
  started_at?: string;
  finished_at?: string | null;
}

export const api = {
  status: () => request<VaultStatusDTO>("GET", "/vault/status"),
  init: (path: string) => request<VaultStatusDTO>("POST", "/vault/init", { path }),
  open: (path: string) => request<VaultStatusDTO>("POST", "/vault/open", { path }),

  notes: (type: string) =>
    request<Array<Record<string, unknown> & { id: string; type: string }>>(
      "GET",
      `/vault/notes?type=${encodeURIComponent(type)}`,
    ),
  note: (id: string) => request<NoteEnvelope>("GET", `/vault/notes/${encodeURIComponent(id)}`),

  settings: () => request<VaultSettingsDTO>("GET", "/vault/settings"),
  saveSettings: (payload: { privacy_mode: boolean }) =>
    request<VaultSettingsDTO>("PUT", "/vault/settings", payload),

  ingest: {
    create: (files: string[]) => request<JobDTO>("POST", "/ingest/jobs", { files }),
    get: (id: string) => request<JobDTO>("GET", `/ingest/jobs/${encodeURIComponent(id)}`),
    cancel: (id: string) =>
      request<{ status: string }>("DELETE", `/ingest/jobs/${encodeURIComponent(id)}`),
  },
};

export function __resetClientCacheForTests(): void {
  cached = null;
}
```

Note: `App.tsx` currently imports `VaultStatusDTO` from `@lifescribe/shared-types`. Update that import to the local alias:

In `apps/desktop/src/App.tsx`, change:

```ts
import type { VaultStatusDTO } from "@lifescribe/shared-types";
```

to:

```ts
import type { VaultStatusDTO } from "./api/client";
```

- [ ] **Step 4: Run tests**

Run: `cd apps/desktop && npm run test -- api/client`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `cd apps/desktop && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/api/client.ts apps/desktop/src/api/__tests__/client.test.ts apps/desktop/src/test/setup.ts apps/desktop/src/test/mockTauri.ts apps/desktop/src/test/mswServer.ts apps/desktop/src/App.tsx
git commit -m "feat(desktop): extend api client with notes, settings, ingest"
```

### Task 8: react-query hooks

**Files:**
- Create: `apps/desktop/src/api/queries.ts`
- Create: `apps/desktop/src/api/__tests__/queries.test.tsx`
- Create: `apps/desktop/src/test/renderWithProviders.tsx`

- [ ] **Step 1: Write test harness**

Create `apps/desktop/src/test/renderWithProviders.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, RenderOptions } from "@testing-library/react";
import { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface Options extends Omit<RenderOptions, "wrapper"> {
  initialEntries?: string[];
  queryClient?: QueryClient;
}

export function renderWithProviders(ui: ReactElement, opts: Options = {}) {
  const client = opts.queryClient ?? makeQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={opts.initialEntries ?? ["/"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(ui, { wrapper, ...opts }), queryClient: client };
}
```

Create `apps/desktop/src/api/__tests__/queries.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { useNote, useNotes, useSettings } from "../queries";
import { BASE, server } from "../../test/mswServer";
import { makeQueryClient } from "../../test/renderWithProviders";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

function wrapper(client = makeQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("queries", () => {
  it("useNotes loads and caches", async () => {
    server.use(
      http.get(`${BASE}/vault/notes`, () =>
        HttpResponse.json([{ id: "src_1", type: "SourceRecord" }]),
      ),
    );
    const { result } = renderHook(() => useNotes("SourceRecord"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "src_1", type: "SourceRecord" }]);
  });

  it("useNote loads envelope", async () => {
    server.use(
      http.get(`${BASE}/vault/notes/src_1`, () =>
        HttpResponse.json({ note: { id: "src_1", type: "SourceRecord" }, body: "# hi" }),
      ),
    );
    const { result } = renderHook(() => useNote("src_1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.body).toBe("# hi");
  });

  it("useSettings returns defaults", async () => {
    server.use(
      http.get(`${BASE}/vault/settings`, () =>
        HttpResponse.json({ id: "settings_default", type: "VaultSettings", privacy_mode: false }),
      ),
    );
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.privacy_mode).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- api/queries`
Expected: FAIL — `queries.ts` missing.

- [ ] **Step 3: Implement hooks**

Create `apps/desktop/src/api/queries.ts`:

```ts
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from "@tanstack/react-query";

import { api, JobDTO, NoteEnvelope, VaultSettingsDTO } from "./client";

const TERMINAL: ReadonlyArray<JobDTO["status"]> = [
  "completed",
  "completed_with_failures",
  "cancelled",
  "failed",
];

export function useNotes(
  type: string,
  opts?: Omit<UseQueryOptions<Array<Record<string, unknown> & { id: string; type: string }>>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: ["notes", type],
    queryFn: () => api.notes(type),
    ...opts,
  });
}

export function useNote(id: string | undefined) {
  return useQuery<NoteEnvelope>({
    queryKey: ["note", id],
    queryFn: () => api.note(id as string),
    enabled: !!id,
  });
}

export function useJob(id: string | undefined) {
  return useQuery<JobDTO>({
    queryKey: ["job", id],
    queryFn: () => api.ingest.get(id as string),
    enabled: !!id,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 500;
      return TERMINAL.includes(data.status) ? false : 500;
    },
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: string[]) => api.ingest.create(files),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", "SourceRecord"] });
      qc.invalidateQueries({ queryKey: ["notes", "IngestJobLog"] });
    },
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.ingest.cancel(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["job", id] });
    },
  });
}

export function useSettings() {
  return useQuery<VaultSettingsDTO>({
    queryKey: ["settings"],
    queryFn: () => api.settings(),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { privacy_mode: boolean }) => api.saveSettings(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/desktop && npm run test -- api/queries`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/api/queries.ts apps/desktop/src/api/__tests__/queries.test.tsx apps/desktop/src/test/renderWithProviders.tsx
git commit -m "feat(desktop): react-query hooks for notes, jobs, settings"
```

---

## Phase 5 — Frontend: shell and routing

### Task 9: `AppShell`, `Sidebar`, `sections`

**Files:**
- Create: `apps/desktop/src/shell/sections.ts`
- Create: `apps/desktop/src/shell/Sidebar.tsx`
- Create: `apps/desktop/src/shell/AppShell.tsx`
- Create: `apps/desktop/src/shell/AppShell.module.css`
- Create: `apps/desktop/src/shell/__tests__/AppShell.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/desktop/src/shell/__tests__/AppShell.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import AppShell from "../AppShell";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("AppShell", () => {
  it("renders all sidebar sections", () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/browse" element={<div>browse content</div>} />
        </Route>
      </Routes>,
      { initialEntries: ["/browse"] },
    );
    expect(screen.getByRole("link", { name: /browse/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /import/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /logs/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByText("browse content")).toBeInTheDocument();
  });

  it("marks active section", () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/import" element={<div>x</div>} />
        </Route>
      </Routes>,
      { initialEntries: ["/import"] },
    );
    const active = screen.getByRole("link", { name: /import/i });
    expect(active).toHaveAttribute("aria-current", "page");
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- AppShell`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/shell/sections.ts`:

```ts
export interface Section {
  path: string;
  label: string;
  icon: string;
}

export const SECTIONS: readonly Section[] = [
  { path: "/browse", label: "Browse", icon: "📄" },
  { path: "/import", label: "Import", icon: "⬇" },
  { path: "/logs", label: "Logs", icon: "📜" },
  { path: "/settings", label: "Settings", icon: "⚙" },
] as const;
```

Create `apps/desktop/src/shell/Sidebar.tsx`:

```tsx
import { NavLink } from "react-router-dom";

import { SECTIONS } from "./sections";
import styles from "./AppShell.module.css";

export default function Sidebar() {
  return (
    <nav className={styles.sidebar} aria-label="Primary">
      <div className={styles.brand}>LifeScribe</div>
      <ul className={styles.sectionList}>
        {SECTIONS.map((s) => (
          <li key={s.path}>
            <NavLink
              to={s.path}
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.linkActive}` : styles.link
              }
              aria-current={({ isActive }: { isActive: boolean }) =>
                isActive ? "page" : undefined
              }
            >
              <span className={styles.icon} aria-hidden="true">
                {s.icon}
              </span>
              <span>{s.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

Note: `NavLink` `aria-current` prop expects a string, not a function. Correct form — replace the `aria-current` line with a second `NavLink` prop via `end` and let react-router set `aria-current="page"` automatically when active. Use:

```tsx
<NavLink
  to={s.path}
  end
  className={({ isActive }) =>
    isActive ? `${styles.link} ${styles.linkActive}` : styles.link
  }
>
```

react-router v6 sets `aria-current="page"` automatically on active `NavLink`s.

Create `apps/desktop/src/shell/AppShell.tsx`:

```tsx
import { Outlet } from "react-router-dom";

import Sidebar from "./Sidebar";
import styles from "./AppShell.module.css";

export default function AppShell() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
```

Create `apps/desktop/src/shell/AppShell.module.css`:

```css
.shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  height: 100vh;
  font-family: system-ui, sans-serif;
}
.sidebar {
  background: #1f2430;
  color: #e8e8e8;
  padding: 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.brand {
  font-weight: 600;
  padding: 8px 12px;
  font-size: 14px;
  letter-spacing: 0.04em;
  opacity: 0.85;
}
.sectionList {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  color: inherit;
  text-decoration: none;
  border-radius: 6px;
  font-size: 14px;
}
.link:hover { background: rgba(255,255,255,0.06); }
.linkActive { background: rgba(255,255,255,0.12); }
.icon { width: 16px; text-align: center; }
.main { overflow: auto; padding: 24px; background: #fafafa; }
```

- [ ] **Step 4: Run tests**

Run: `cd apps/desktop && npm run test -- AppShell`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shell/
git commit -m "feat(desktop): AppShell with fixed sidebar and SECTIONS array"
```

### Task 10: Router and `App.tsx` wiring

**Files:**
- Create: `apps/desktop/src/router.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/main.tsx` (add QueryClientProvider)

- [ ] **Step 1: Create router**

Create `apps/desktop/src/router.tsx`:

```tsx
import { Navigate, createBrowserRouter } from "react-router-dom";

import AppShell from "./shell/AppShell";
import BrowseRoute from "./routes/BrowseRoute";
import ImportRoute from "./routes/ImportRoute";
import LogsRoute from "./routes/LogsRoute";
import NoteViewerRoute from "./routes/NoteViewerRoute";
import SettingsRoute from "./routes/SettingsRoute";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/browse" replace /> },
      { path: "browse", element: <BrowseRoute /> },
      { path: "browse/:id", element: <NoteViewerRoute /> },
      { path: "import", element: <ImportRoute /> },
      { path: "logs", element: <LogsRoute /> },
      { path: "logs/:id", element: <NoteViewerRoute /> },
      { path: "settings", element: <SettingsRoute /> },
    ],
  },
]);
```

(This file will compile once the routes in later tasks exist. Since later tasks create them, temporarily stub each route to keep the tree compiling — see Step 2.)

- [ ] **Step 2: Stub route modules**

Create placeholder files so the router compiles. Each stub will be replaced in its own task.

`apps/desktop/src/routes/BrowseRoute.tsx`:
```tsx
export default function BrowseRoute() { return <div>Browse</div>; }
```

`apps/desktop/src/routes/ImportRoute.tsx`:
```tsx
export default function ImportRoute() { return <div>Import</div>; }
```

`apps/desktop/src/routes/LogsRoute.tsx`:
```tsx
export default function LogsRoute() { return <div>Logs</div>; }
```

`apps/desktop/src/routes/SettingsRoute.tsx`:
```tsx
export default function SettingsRoute() { return <div>Settings</div>; }
```

`apps/desktop/src/routes/NoteViewerRoute.tsx`:
```tsx
export default function NoteViewerRoute() { return <div>Viewer</div>; }
```

- [ ] **Step 3: Update `App.tsx`**

Replace `apps/desktop/src/App.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";

import type { VaultStatusDTO } from "./api/client";
import { api } from "./api/client";
import FirstRunWizard from "./views/FirstRunWizard";
import { router } from "./router";

export default function App() {
  const [status, setStatus] = useState<VaultStatusDTO | null>(null);

  async function refresh() {
    try {
      const s = await api.status();
      setStatus(s);
    } catch (e) {
      console.error(e);
      setStatus({ open: false, manifest: null });
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (status === null) return <div style={{ padding: 24 }}>Starting backend…</div>;
  if (!status.open || !status.manifest) return <FirstRunWizard onOpened={refresh} />;
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 4: Wire QueryClient**

Modify `apps/desktop/src/main.tsx` (read it first to see current structure). Wrap `<App/>` in:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
});

// inside the render:
<QueryClientProvider client={queryClient}>
  <App />
</QueryClientProvider>
```

- [ ] **Step 5: Typecheck + test**

Run: `cd apps/desktop && npm run typecheck && npm run test`
Expected: clean (existing tests still pass; stubs compile).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/router.tsx apps/desktop/src/routes/ apps/desktop/src/App.tsx apps/desktop/src/main.tsx
git commit -m "feat(desktop): wire router and QueryClientProvider"
```

---

## Phase 6 — Reusable components

### Task 11: `NoteList`

**Files:**
- Create: `apps/desktop/src/components/NoteList.tsx`
- Create: `apps/desktop/src/components/NoteList.module.css`
- Create: `apps/desktop/src/components/__tests__/NoteList.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/desktop/src/components/__tests__/NoteList.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import NoteList from "../NoteList";
import { renderWithProviders } from "../../test/renderWithProviders";

const rows = [
  { id: "src_a", type: "SourceRecord", title: "Alpha", subtitle: "a.txt" },
  { id: "src_b", type: "SourceRecord", title: "Beta", subtitle: "b.txt" },
];

describe("NoteList", () => {
  it("renders rows and fires onSelect on click", async () => {
    const onSelect = vi.fn();
    renderWithProviders(<NoteList rows={rows} onSelect={onSelect} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Alpha"));
    expect(onSelect).toHaveBeenCalledWith("src_a");
  });

  it("filters rows client-side", async () => {
    renderWithProviders(<NoteList rows={rows} onSelect={() => {}} />);
    const filter = screen.getByRole("searchbox");
    await userEvent.type(filter, "Beta");
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("shows empty-state when no rows", () => {
    renderWithProviders(<NoteList rows={[]} onSelect={() => {}} emptyLabel="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- NoteList`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/components/NoteList.tsx`:

```tsx
import { useMemo, useState } from "react";

import styles from "./NoteList.module.css";

export interface NoteListRow {
  id: string;
  type: string;
  title?: string;
  subtitle?: string;
}

interface Props {
  rows: NoteListRow[];
  onSelect: (id: string) => void;
  emptyLabel?: string;
}

export default function NoteList({ rows, onSelect, emptyLabel = "No notes yet." }: Props) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) =>
      [r.title, r.subtitle, r.id].some((v) => v?.toLowerCase().includes(f)),
    );
  }, [rows, filter]);

  return (
    <div className={styles.wrapper}>
      <input
        type="search"
        className={styles.filter}
        placeholder="Filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {filtered.length === 0 ? (
        <div className={styles.empty}>{emptyLabel}</div>
      ) : (
        <ul className={styles.list}>
          {filtered.map((r) => (
            <li key={r.id}>
              <button type="button" className={styles.row} onClick={() => onSelect(r.id)}>
                <div className={styles.title}>{r.title ?? r.id}</div>
                {r.subtitle && <div className={styles.subtitle}>{r.subtitle}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Create `apps/desktop/src/components/NoteList.module.css`:

```css
.wrapper { display: flex; flex-direction: column; gap: 12px; }
.filter {
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font: inherit;
}
.empty { color: #888; font-style: italic; padding: 16px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.row {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  background: white;
  border: 1px solid #eee;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
}
.row:hover { background: #f4f4f4; }
.title { font-weight: 500; }
.subtitle { font-size: 12px; color: #666; margin-top: 2px; }
```

- [ ] **Step 4: Run test**

Run: `cd apps/desktop && npm run test -- NoteList`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/NoteList.tsx apps/desktop/src/components/NoteList.module.css apps/desktop/src/components/__tests__/NoteList.test.tsx
git commit -m "feat(desktop): NoteList with client-side filter"
```

### Task 12: `MarkdownViewer`

**Files:**
- Create: `apps/desktop/src/components/MarkdownViewer.tsx`
- Create: `apps/desktop/src/components/__tests__/MarkdownViewer.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/desktop/src/components/__tests__/MarkdownViewer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MarkdownViewer from "../MarkdownViewer";

describe("MarkdownViewer", () => {
  it("renders headings and paragraphs", () => {
    render(<MarkdownViewer body={"# Title\n\nHello **world**"} />);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("renders GFM tables", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    const { container } = render(<MarkdownViewer body={md} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByRole("cell", { name: "1" })).toBeInTheDocument();
  });

  it("sanitizes raw HTML by default", () => {
    const { container } = render(
      <MarkdownViewer body={"<script>alert(1)</script>\n\nOK"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/OK/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- MarkdownViewer`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/components/MarkdownViewer.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  body: string;
}

export default function MarkdownViewer({ body }: Props) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}
```

(react-markdown v9 disables raw HTML by default — no extra plugin needed for the sanitize test.)

- [ ] **Step 4: Run test**

Run: `cd apps/desktop && npm run test -- MarkdownViewer`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/MarkdownViewer.tsx apps/desktop/src/components/__tests__/MarkdownViewer.test.tsx
git commit -m "feat(desktop): MarkdownViewer via react-markdown + remark-gfm"
```

### Task 13: `JobProgress`

**Files:**
- Create: `apps/desktop/src/components/JobProgress.tsx`
- Create: `apps/desktop/src/components/JobProgress.module.css`
- Create: `apps/desktop/src/components/__tests__/JobProgress.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/desktop/src/components/__tests__/JobProgress.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import JobProgress from "../JobProgress";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { JobDTO } from "../../api/client";

const running: JobDTO = {
  job_id: "job_1",
  status: "running",
  total: 3,
  succeeded: 1,
  failed: 0,
  skipped: 0,
  cancelled: 0,
};

describe("JobProgress", () => {
  it("shows counters", () => {
    renderWithProviders(<JobProgress job={running} onCancel={() => {}} />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // succeeded counter
  });

  it("calls onCancel when cancel clicked", async () => {
    const onCancel = vi.fn();
    renderWithProviders(<JobProgress job={running} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("hides cancel button at terminal state", () => {
    renderWithProviders(
      <JobProgress job={{ ...running, status: "completed" }} onCancel={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- JobProgress`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/components/JobProgress.tsx`:

```tsx
import type { JobDTO } from "../api/client";
import styles from "./JobProgress.module.css";

const TERMINAL: ReadonlyArray<JobDTO["status"]> = [
  "completed",
  "completed_with_failures",
  "cancelled",
  "failed",
];

interface Props {
  job: JobDTO;
  onCancel: () => void;
  cancelling?: boolean;
}

export default function JobProgress({ job, onCancel, cancelling = false }: Props) {
  const terminal = TERMINAL.includes(job.status);
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.jobId}>{job.job_id}</span>
        <span className={styles.status} data-status={job.status}>
          {job.status.replace(/_/g, " ")}
        </span>
      </div>
      <div className={styles.counters}>
        <Counter label="✓" value={job.succeeded ?? 0} tone="ok" />
        <Counter label="✗" value={job.failed ?? 0} tone={(job.failed ?? 0) > 0 ? "bad" : "muted"} />
        <Counter label="⏭" value={job.skipped ?? 0} tone="muted" />
        <Counter label="Σ" value={job.total} tone="muted" />
      </div>
      {!terminal && (
        <button
          type="button"
          className={styles.cancel}
          onClick={onCancel}
          disabled={cancelling}
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      )}
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone: "ok" | "bad" | "muted" }) {
  return (
    <div className={styles.counter} data-tone={tone}>
      <span className={styles.counterLabel}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
```

Create `apps/desktop/src/components/JobProgress.module.css`:

```css
.card {
  border: 1px solid #ddd; border-radius: 8px; padding: 16px; background: white;
  display: flex; flex-direction: column; gap: 12px;
}
.header { display: flex; justify-content: space-between; align-items: center; }
.jobId { font-family: ui-monospace, monospace; font-size: 12px; color: #666; }
.status { text-transform: capitalize; font-size: 13px; padding: 2px 8px; border-radius: 10px; background: #eef; }
.status[data-status="failed"], .status[data-status="completed_with_failures"] { background: #fde; }
.status[data-status="cancelled"] { background: #eee; }
.status[data-status="completed"] { background: #dfd; }
.counters { display: flex; gap: 12px; }
.counter { display: flex; gap: 4px; align-items: baseline; }
.counter[data-tone="bad"] { color: #b00; }
.counter[data-tone="muted"] { color: #888; }
.counterLabel { font-size: 12px; }
.cancel {
  align-self: flex-start; padding: 6px 12px; border-radius: 6px;
  border: 1px solid #c66; background: white; color: #c66; cursor: pointer;
}
.cancel:disabled { opacity: 0.6; cursor: wait; }
```

- [ ] **Step 4: Run test**

Run: `cd apps/desktop && npm run test -- JobProgress`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/JobProgress.tsx apps/desktop/src/components/JobProgress.module.css apps/desktop/src/components/__tests__/JobProgress.test.tsx
git commit -m "feat(desktop): JobProgress live counters + cancel"
```

### Task 14: `DropZone`

**Files:**
- Create: `apps/desktop/src/components/DropZone.tsx`
- Create: `apps/desktop/src/components/__tests__/DropZone.test.tsx`

- [ ] **Step 1: Extend Tauri mock**

Add to `apps/desktop/src/test/mockTauri.ts`:

```ts
import { vi } from "vitest";

// ...existing mocks...

export const dragDropHandlers = new Set<(e: unknown) => void>();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: (cb: (e: unknown) => void) => {
      dragDropHandlers.add(cb);
      return Promise.resolve(() => dragDropHandlers.delete(cb));
    },
  }),
}));
```

- [ ] **Step 2: Write failing test**

Create `apps/desktop/src/components/__tests__/DropZone.test.tsx`:

```tsx
import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DropZone from "../DropZone";
import { renderWithProviders } from "../../test/renderWithProviders";
import { dragDropHandlers } from "../../test/mockTauri";

describe("DropZone", () => {
  it("shows label and forwards dropped paths", async () => {
    const onPaths = vi.fn();
    renderWithProviders(<DropZone onPaths={onPaths} label="Drop stuff" />);
    expect(screen.getByText("Drop stuff")).toBeInTheDocument();

    // Wait a tick for registration
    await act(async () => {});
    const handler = [...dragDropHandlers][0];
    expect(handler).toBeDefined();

    await act(async () => {
      handler({ payload: { type: "drop", paths: ["/a.txt", "/b.pdf"] } });
    });
    expect(onPaths).toHaveBeenCalledWith(["/a.txt", "/b.pdf"]);
  });
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- DropZone`
Expected: FAIL.

- [ ] **Step 4: Implement**

Create `apps/desktop/src/components/DropZone.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

interface Props {
  onPaths: (paths: string[]) => void;
  label?: string;
}

interface DropEvent {
  payload: { type: string; paths?: string[] };
}

export default function DropZone({ onPaths, label = "Drop files anywhere" }: Props) {
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await getCurrentWebviewWindow().onDragDropEvent((evt: unknown) => {
        const e = evt as DropEvent;
        const kind = e.payload.type;
        if (kind === "enter" || kind === "over") setHover(true);
        else if (kind === "leave") setHover(false);
        else if (kind === "drop") {
          setHover(false);
          if (e.payload.paths?.length) onPaths(e.payload.paths);
        }
      });
    })();
    return () => {
      unlisten?.();
    };
  }, [onPaths]);

  return (
    <div
      style={{
        border: `2px dashed ${hover ? "#36c" : "#bbb"}`,
        borderRadius: 8,
        padding: 32,
        textAlign: "center",
        color: "#666",
      }}
    >
      {label}
    </div>
  );
}
```

- [ ] **Step 5: Run test**

Run: `cd apps/desktop && npm run test -- DropZone`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/DropZone.tsx apps/desktop/src/components/__tests__/DropZone.test.tsx apps/desktop/src/test/mockTauri.ts
git commit -m "feat(desktop): DropZone wrapping onDragDropEvent"
```

---

## Phase 7 — Routes

### Task 15: `BrowseRoute`

**Files:**
- Replace: `apps/desktop/src/routes/BrowseRoute.tsx`
- Create: `apps/desktop/src/routes/__tests__/BrowseRoute.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/desktop/src/routes/__tests__/BrowseRoute.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import BrowseRoute from "../BrowseRoute";
import { BASE, server } from "../../test/mswServer";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("BrowseRoute", () => {
  it("lists SourceRecord notes and navigates to viewer on click", async () => {
    server.use(
      http.get(`${BASE}/vault/notes`, () =>
        HttpResponse.json([
          { id: "src_alpha", type: "SourceRecord", original_filename: "a.txt" },
        ]),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/browse" element={<BrowseRoute />} />
        <Route path="/browse/:id" element={<div>viewer: {location.pathname}</div>} />
      </Routes>,
      { initialEntries: ["/browse"] },
    );
    await waitFor(() => expect(screen.getByText(/a\.txt/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/a\.txt/));
    await waitFor(() =>
      expect(screen.getByText(/viewer:/)).toBeInTheDocument(),
    );
  });

  it("shows error banner on 500", async () => {
    server.use(http.get(`${BASE}/vault/notes`, () => new HttpResponse(null, { status: 500 })));
    renderWithProviders(<BrowseRoute />, { initialEntries: ["/browse"] });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- BrowseRoute`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `apps/desktop/src/routes/BrowseRoute.tsx`:

```tsx
import { useNavigate } from "react-router-dom";

import NoteList, { NoteListRow } from "../components/NoteList";
import { useNotes } from "../api/queries";

export default function BrowseRoute() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useNotes("SourceRecord");

  if (error) {
    return (
      <div role="alert" style={{ color: "#b00" }}>
        Failed to load notes: {(error as Error).message}
      </div>
    );
  }

  if (isLoading || !data) {
    return <div>Loading…</div>;
  }

  const rows: NoteListRow[] = data.map((n) => ({
    id: n.id,
    type: n.type,
    title: (n.title as string | undefined) ?? (n.original_filename as string | undefined) ?? n.id,
    subtitle: (n.original_filename as string | undefined) ?? (n.imported_at as string | undefined),
  }));

  return (
    <div>
      <h1>Browse</h1>
      <NoteList
        rows={rows}
        onSelect={(id) => navigate(`/browse/${encodeURIComponent(id)}`)}
        emptyLabel="No ingested notes yet — go to Import."
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test**

Run: `cd apps/desktop && npm run test -- BrowseRoute`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/routes/BrowseRoute.tsx apps/desktop/src/routes/__tests__/BrowseRoute.test.tsx
git commit -m "feat(desktop): BrowseRoute lists SourceRecords"
```

### Task 16: `NoteViewerRoute`

**Files:**
- Replace: `apps/desktop/src/routes/NoteViewerRoute.tsx`
- Create: `apps/desktop/src/routes/__tests__/NoteViewerRoute.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/desktop/src/routes/__tests__/NoteViewerRoute.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import NoteViewerRoute from "../NoteViewerRoute";
import { BASE, server } from "../../test/mswServer";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("NoteViewerRoute", () => {
  it("renders frontmatter and Markdown body", async () => {
    server.use(
      http.get(`${BASE}/vault/notes/src_alpha`, () =>
        HttpResponse.json({
          note: { id: "src_alpha", type: "SourceRecord", original_filename: "a.txt" },
          body: "# Title\n\nHello",
        }),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/browse/:id" element={<NoteViewerRoute />} />
      </Routes>,
      { initialEntries: ["/browse/src_alpha"] },
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText(/src_alpha/)).toBeInTheDocument();
  });

  it("shows not-found on 404", async () => {
    server.use(
      http.get(`${BASE}/vault/notes/src_missing`, () =>
        HttpResponse.json({ detail: "gone" }, { status: 404 }),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/browse/:id" element={<NoteViewerRoute />} />
      </Routes>,
      { initialEntries: ["/browse/src_missing"] },
    );
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- NoteViewerRoute`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `apps/desktop/src/routes/NoteViewerRoute.tsx`:

```tsx
import { Link, useParams } from "react-router-dom";

import MarkdownViewer from "../components/MarkdownViewer";
import { ApiError } from "../api/client";
import { useNote } from "../api/queries";

export default function NoteViewerRoute() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useNote(id);

  if (error) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <div role="alert">
        <h1>{is404 ? "Note not found" : "Failed to load note"}</h1>
        <p>{(error as Error).message}</p>
        <Link to="/browse">← Back to Browse</Link>
      </div>
    );
  }

  if (isLoading || !data) return <div>Loading…</div>;

  return (
    <article>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ marginBottom: 4 }}>
          {(data.note.title as string | undefined) ?? data.note.id}
        </h1>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#666" }}>
          {data.note.id} · {data.note.type}
        </div>
      </header>
      <MarkdownViewer body={data.body} />
    </article>
  );
}
```

- [ ] **Step 4: Run test**

Run: `cd apps/desktop && npm run test -- NoteViewerRoute`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/routes/NoteViewerRoute.tsx apps/desktop/src/routes/__tests__/NoteViewerRoute.test.tsx
git commit -m "feat(desktop): NoteViewerRoute renders frontmatter + Markdown body"
```

### Task 17: `ImportRoute`

**Files:**
- Replace: `apps/desktop/src/routes/ImportRoute.tsx`
- Create: `apps/desktop/src/routes/__tests__/ImportRoute.test.tsx`
- Modify: `apps/desktop/src/test/mockTauri.ts` (add `plugin-dialog` mock)

- [ ] **Step 1: Extend Tauri mock**

Append to `apps/desktop/src/test/mockTauri.ts`:

```ts
export const openDialogMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args),
}));
```

- [ ] **Step 2: Write failing test**

Create `apps/desktop/src/routes/__tests__/ImportRoute.test.tsx`:

```tsx
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import ImportRoute from "../ImportRoute";
import { BASE, server } from "../../test/mswServer";
import { openDialogMock, dragDropHandlers } from "../../test/mockTauri";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("ImportRoute", () => {
  it("picker → job → terminal polling", async () => {
    openDialogMock.mockResolvedValueOnce(["/a.txt", "/b.txt"]);
    let poll = 0;
    server.use(
      http.post(`${BASE}/ingest/jobs`, () =>
        HttpResponse.json(
          { job_id: "job_x", status: "queued", total: 2 },
          { status: 202 },
        ),
      ),
      http.get(`${BASE}/ingest/jobs/job_x`, () => {
        poll += 1;
        return HttpResponse.json({
          job_id: "job_x",
          status: poll > 1 ? "completed" : "running",
          total: 2,
          succeeded: poll > 1 ? 2 : 1,
          failed: 0,
          skipped: 0,
        });
      }),
    );
    renderWithProviders(<ImportRoute />, { initialEntries: ["/import"] });
    await userEvent.click(screen.getByRole("button", { name: /add files/i }));
    await waitFor(() => expect(screen.getByText(/job_x/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/completed/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it("drag-drop triggers job", async () => {
    server.use(
      http.post(`${BASE}/ingest/jobs`, () =>
        HttpResponse.json({ job_id: "job_y", status: "queued", total: 1 }, { status: 202 }),
      ),
      http.get(`${BASE}/ingest/jobs/job_y`, () =>
        HttpResponse.json({
          job_id: "job_y",
          status: "completed",
          total: 1,
          succeeded: 1,
          failed: 0,
          skipped: 0,
        }),
      ),
    );
    renderWithProviders(<ImportRoute />, { initialEntries: ["/import"] });
    await act(async () => {});
    const handler = [...dragDropHandlers][0];
    await act(async () => handler({ payload: { type: "drop", paths: ["/z.txt"] } }));
    await waitFor(() => expect(screen.getByText(/job_y/)).toBeInTheDocument());
  });

  it("409 shows busy banner", async () => {
    openDialogMock.mockResolvedValueOnce(["/a.txt"]);
    server.use(
      http.post(`${BASE}/ingest/jobs`, () =>
        HttpResponse.json({ detail: "job running" }, { status: 409 }),
      ),
    );
    renderWithProviders(<ImportRoute />, { initialEntries: ["/import"] });
    await userEvent.click(screen.getByRole("button", { name: /add files/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/already running/i));
  });
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- ImportRoute`
Expected: FAIL.

- [ ] **Step 4: Implement**

Replace `apps/desktop/src/routes/ImportRoute.tsx`:

```tsx
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import DropZone from "../components/DropZone";
import JobProgress from "../components/JobProgress";
import { ApiError } from "../api/client";
import { useCancelJob, useCreateJob, useJob } from "../api/queries";

export default function ImportRoute() {
  const [activeJobId, setActiveJobId] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const createJob = useCreateJob();
  const cancelJob = useCancelJob();
  const job = useJob(activeJobId);

  async function submit(files: string[]) {
    if (!files.length) return;
    setBanner(null);
    try {
      const res = await createJob.mutateAsync(files);
      setActiveJobId(res.job_id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setBanner("A job is already running. Cancel it or wait for it to finish.");
      } else {
        setBanner((e as Error).message);
      }
    }
  }

  async function pick() {
    const picked = (await openDialog({ multiple: true })) as string[] | string | null;
    if (!picked) return;
    const arr = Array.isArray(picked) ? picked : [picked];
    await submit(arr);
  }

  const running = job.data && !["completed", "completed_with_failures", "cancelled", "failed"].includes(job.data.status);

  return (
    <div>
      <h1>Import</h1>
      {banner && (
        <div role="alert" style={{ background: "#fde", padding: 10, borderRadius: 6, marginBottom: 12 }}>
          {banner}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <button type="button" onClick={pick} disabled={!!running}>
          Add files…
        </button>
      </div>
      <DropZone
        onPaths={(paths) => {
          if (running) {
            setBanner("A job is already running.");
            return;
          }
          submit(paths);
        }}
      />
      {job.data && (
        <div style={{ marginTop: 16 }}>
          <JobProgress
            job={job.data}
            onCancel={() => activeJobId && cancelJob.mutate(activeJobId)}
            cancelling={cancelJob.isPending}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test**

Run: `cd apps/desktop && npm run test -- ImportRoute`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/routes/ImportRoute.tsx apps/desktop/src/routes/__tests__/ImportRoute.test.tsx apps/desktop/src/test/mockTauri.ts
git commit -m "feat(desktop): ImportRoute with picker, drop-zone, live job status"
```

### Task 18: `LogsRoute`

**Files:**
- Replace: `apps/desktop/src/routes/LogsRoute.tsx`
- Create: `apps/desktop/src/routes/__tests__/LogsRoute.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/desktop/src/routes/__tests__/LogsRoute.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import LogsRoute from "../LogsRoute";
import { BASE, server } from "../../test/mswServer";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("LogsRoute", () => {
  it("lists jobs and navigates to viewer", async () => {
    server.use(
      http.get(`${BASE}/vault/notes`, () =>
        HttpResponse.json([
          {
            id: "job_20260412",
            type: "IngestJobLog",
            status: "completed",
            started_at: "2026-04-12T14:00:00Z",
            total: 3,
            succeeded: 3,
          },
        ]),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/logs" element={<LogsRoute />} />
        <Route path="/logs/:id" element={<div>viewer</div>} />
      </Routes>,
      { initialEntries: ["/logs"] },
    );
    await waitFor(() => expect(screen.getByText(/job_20260412/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/job_20260412/));
    await waitFor(() => expect(screen.getByText("viewer")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- LogsRoute`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `apps/desktop/src/routes/LogsRoute.tsx`:

```tsx
import { useNavigate } from "react-router-dom";

import NoteList, { NoteListRow } from "../components/NoteList";
import { useNotes } from "../api/queries";

export default function LogsRoute() {
  const navigate = useNavigate();
  const { data, error, isLoading } = useNotes("IngestJobLog");

  if (error)
    return (
      <div role="alert" style={{ color: "#b00" }}>
        Failed to load logs: {(error as Error).message}
      </div>
    );

  if (isLoading || !data) return <div>Loading…</div>;

  const sorted = [...data].sort((a, b) => {
    const sa = (a.started_at as string | undefined) ?? "";
    const sb = (b.started_at as string | undefined) ?? "";
    return sb.localeCompare(sa);
  });

  const rows: NoteListRow[] = sorted.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.id,
    subtitle: `${n.status as string} · ${n.succeeded ?? 0}✓ ${n.failed ?? 0}✗ ${n.skipped ?? 0}⏭`,
  }));

  return (
    <div>
      <h1>Logs</h1>
      <NoteList
        rows={rows}
        onSelect={(id) => navigate(`/logs/${encodeURIComponent(id)}`)}
        emptyLabel="No ingest jobs yet."
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test**

Run: `cd apps/desktop && npm run test -- LogsRoute`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/routes/LogsRoute.tsx apps/desktop/src/routes/__tests__/LogsRoute.test.tsx
git commit -m "feat(desktop): LogsRoute lists IngestJobLog"
```

### Task 19: `SettingsRoute`

**Files:**
- Replace: `apps/desktop/src/routes/SettingsRoute.tsx`
- Create: `apps/desktop/src/routes/__tests__/SettingsRoute.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/desktop/src/routes/__tests__/SettingsRoute.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import SettingsRoute from "../SettingsRoute";
import { BASE, server } from "../../test/mswServer";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("SettingsRoute", () => {
  it("prefills from server and saves changes", async () => {
    let current = { id: "settings_default", type: "VaultSettings", privacy_mode: false };
    server.use(
      http.get(`${BASE}/vault/settings`, () => HttpResponse.json(current)),
      http.put(`${BASE}/vault/settings`, async ({ request }) => {
        const body = (await request.json()) as { privacy_mode: boolean };
        current = { ...current, privacy_mode: body.privacy_mode };
        return HttpResponse.json(current);
      }),
    );
    renderWithProviders(<SettingsRoute />, { initialEntries: ["/settings"] });
    const toggle = await screen.findByRole("checkbox", { name: /privacy/i });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/desktop && npm run test -- SettingsRoute`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `apps/desktop/src/routes/SettingsRoute.tsx`:

```tsx
import { useEffect, useState } from "react";

import { useSaveSettings, useSettings } from "../api/queries";

export default function SettingsRoute() {
  const { data, isLoading, error } = useSettings();
  const save = useSaveSettings();
  const [privacy, setPrivacy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (data) setPrivacy(data.privacy_mode);
  }, [data]);

  if (error)
    return (
      <div role="alert" style={{ color: "#b00" }}>
        Failed to load settings: {(error as Error).message}
      </div>
    );
  if (isLoading || !data) return <div>Loading…</div>;

  async function onSave() {
    await save.mutateAsync({ privacy_mode: privacy });
    setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <div>
      <h1>Settings</h1>
      <section style={{ marginBottom: 24 }}>
        <h2>Privacy</h2>
        <label>
          <input
            type="checkbox"
            checked={privacy}
            onChange={(e) => setPrivacy(e.target.checked)}
          />{" "}
          Privacy mode (master switch; no enforcement yet)
        </label>
      </section>
      <button type="button" onClick={onSave} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save"}
      </button>
      {savedAt && <span style={{ marginLeft: 12, color: "#080" }}>Saved at {savedAt}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run test**

Run: `cd apps/desktop && npm run test -- SettingsRoute`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/routes/SettingsRoute.tsx apps/desktop/src/routes/__tests__/SettingsRoute.test.tsx
git commit -m "feat(desktop): SettingsRoute persists privacy_mode"
```

---

## Phase 8 — Integration, docs, CI

### Task 20: Backend integration smoke test

**Files:**
- Create: `apps/backend/tests/integration/test_dashboard_smoke.py`

- [ ] **Step 1: Write test**

Create `apps/backend/tests/integration/test_dashboard_smoke.py`:

```python
from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lifescribe.api.app import create_app
from lifescribe.api.routers.vault import _State as _VaultState
from lifescribe.api.routers.ingest import _IngestState
from lifescribe.vault.store import VaultStore

TOKEN = "testtoken"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _reset() -> None:
    _VaultState.store = None
    _IngestState.active = None
    yield
    _VaultState.store = None
    _IngestState.active = None


def test_browse_after_import_loop(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "vault", app_version="0.0.0-test")
    _VaultState.store = store

    fixture = tmp_path / "hi.txt"
    fixture.write_text("hello world", encoding="utf-8")

    client = TestClient(create_app(auth_token=TOKEN))
    r = client.post("/ingest/jobs", headers=HEADERS, json={"files": [str(fixture)]})
    assert r.status_code == 202
    job_id = r.json()["job_id"]

    deadline = time.time() + 10
    while time.time() < deadline:
        g = client.get(f"/ingest/jobs/{job_id}", headers=HEADERS)
        if g.json()["status"] in {"completed", "completed_with_failures", "failed"}:
            break
        time.sleep(0.1)
    else:
        pytest.fail("job did not terminate in time")

    r = client.get("/vault/notes?type=SourceRecord", headers=HEADERS)
    assert r.status_code == 200
    notes = r.json()
    assert len(notes) == 1
    assert notes[0]["original_filename"] == "hi.txt"

    r = client.get(f"/vault/notes/{notes[0]['id']}", headers=HEADERS)
    assert r.status_code == 200
    assert "hello world" in r.json()["body"]
```

- [ ] **Step 2: Run test**

Run: `cd apps/backend && uv run pytest tests/integration/test_dashboard_smoke.py -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/integration/test_dashboard_smoke.py
git commit -m "test(integration): browse-after-import loop smoke"
```

### Task 21: User doc

**Files:**
- Create: `docs/user/browse-and-import.md`

- [ ] **Step 1: Write doc**

Create `docs/user/browse-and-import.md`:

```markdown
# Browse and Import

Once your vault is initialized, the Dashboard opens to the **Browse** view.

## Browse

Browse lists every `SourceRecord` note — one per file you've imported. Use the
filter box to narrow by title or filename. Click a row to read the extracted
Markdown. Nothing is editable; the vault's Markdown files are the system of
record, so open them in Obsidian or a text editor if you need to edit.

## Import

The Import section is how files enter the vault. Two ways:

1. Click **Add files…** to open the native file picker.
2. Drag files onto the app window.

Either way, the selected paths are sent to the ingestion pipeline. A progress
card appears showing counters (✓ succeeded, ✗ failed, ⏭ skipped). Click
**Cancel** to stop a job mid-flight; files already processed are kept, the
rest are left untouched.

Only one job runs at a time. If you try to start a second, you'll see a
"job already running" banner.

## Logs

Every job leaves a Markdown log in `system/logs/ingestion/`. The **Logs**
section lists them — click one to see its per-file results.

## Settings

Currently exposes the vault path (read-only) and a privacy master-switch. The
switch is persisted to `system/settings.md` but does not yet gate any
behavior — it's a placeholder for future enforcement.
```

- [ ] **Step 2: Commit**

```bash
git add docs/user/browse-and-import.md
git commit -m "docs(user): browse and import guide"
```

### Task 22: Final full-stack check

**Files:** None (verification task).

- [ ] **Step 1: Backend gauntlet**

Run: `cd apps/backend && uv run ruff format --check && uv run ruff check && uv run mypy --strict src && uv run pytest -q`
Expected: all green.

- [ ] **Step 2: Frontend gauntlet**

Run: `cd apps/desktop && npm run format:check && npm run lint && npm run typecheck && npm run test -- --run`
Expected: all green.

- [ ] **Step 3: Type regeneration is idempotent**

Run: `bash scripts/gen-types.sh && git diff --exit-code packages/shared-types/`
Expected: no diff.

- [ ] **Step 4: Tauri dev build smoke**

Run: `cd apps/desktop && npm run tauri:dev` (cancel after window opens and `/browse` renders empty state). This is a manual check; confirm in the terminal output that there are no runtime errors.
Expected: app starts, sidebar visible, navigation between sections works.

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feat/dashboard-shell
gh pr create --title "feat: dashboard shell (browse, import, logs, settings)" --body "$(cat <<'EOF'
## Summary
- Adds `VaultSettings` note type and `/vault/notes`, `/vault/notes/{id}`, `/vault/settings` endpoints
- Introduces `react-router-dom` + `@tanstack/react-query` in the desktop app
- Ships Browse, Import (picker + drag-drop + live status), Logs, Settings

Closes M1 (local files → vault → browse).

## Test plan
- [ ] Backend: `ruff`, `mypy --strict`, `pytest` green
- [ ] Frontend: `typecheck`, `lint`, `test` green
- [ ] CI matrix (Ubuntu / macOS / Windows) green
- [ ] Manual: first-run wizard → import 3 files → Browse shows them → cancel a drop mid-flight → Settings persists privacy toggle
EOF
)"
```

Expected: PR created; wait for CI.

---

## Notes for the implementer

- Commit after each task — the plan is designed for fine-grained history.
- If `react-router-dom`'s NavLink no longer sets `aria-current` automatically, switch the test in Task 9 to assert the active class instead.
- If `msw` v2 rejects `onUnhandledRequest: "error"` during Tauri IPC calls, tighten handlers or switch that to `"warn"`.
- The `gen-types.sh` step (Task 5) must happen before the frontend client task; the TS type is not strictly required (the client defines its own DTO shapes) but regenerating keeps the shared types package honest.
- `ImportRoute` tests rely on `refetchInterval: 500ms`; keep jest timers real (the default) — don't introduce fake timers for these tests.
