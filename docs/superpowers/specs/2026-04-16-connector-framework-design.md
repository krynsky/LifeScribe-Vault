# Connector Framework + Catalog Design

**Status:** Approved · **Owner:** Mark Krynsky · **Date:** 2026-04-16
**Umbrella:** [2026-04-12-lifescribe-vault-overview.md](2026-04-12-lifescribe-vault-overview.md) §3.6
**Branch:** `feat/connector-framework`

## 1. Goal

Formalize a pluggable `Connector` interface plus a per-connector metadata catalog so that (a) every external data source LifeScribe ever imports from uses the same extension point, (b) the existing file-drop ingestion is the first reference implementation built on that extension point, and (c) contributors can add new connectors by dropping a self-contained directory into `connectors/` — no core code changes. §3.6 is positioned in the umbrella as the primary OSS contribution surface; this design optimizes for that.

## 2. Scope

### In scope (v1)

- `Connector` abstract base class with a `configure → collect → teardown` lifecycle
- `CatalogEntry` + `load_catalog()` that discovers `connectors/*/manifest.toml`
- `VaultImporter` — a new module that owns dedupe + asset copy + `DocumentRecord` write + git commit + manifest update, extracted from `ingest/pipeline.py`
- `run_connector()` orchestrator that enforces privacy, runs the lifecycle, and hands `ImportedDoc` payloads to `VaultImporter`
- One reference connector: `connectors/file_drop/` — functionally equivalent to today's `pipeline.run_job()`
- Read-only "Connectors" section in Settings that renders the catalog with export instructions + sample file links
- `GET /connectors` + `GET /connectors/<service>/samples/<name>` backend routes
- Backwards-compat shim in `ingest/pipeline.py::run_job` delegating to `run_connector`

### Out of scope (deferred to later slices)

- `ManualExportConnector`, `APISyncConnector`, `WatchFolderConnector`, `BridgeConnector` — the *interface* accommodates them; no implementations ship in v1
- Connector picker UI in the import flow (one connector → no picker needed)
- Progress streaming via SSE / long-running import jobs
- Background job queue
- Connector catalog governance fields (maintainers, version, capabilities)
- Catalog reload via UI (dev-only `POST /connectors/reload` ships; user-facing reload deferred)

## 3. Architecture

Two new backend packages plus one new top-level directory:

**Backend**

- `lifescribe/connectors/` — framework package
  - `base.py` — `Connector` ABC + dataclasses (`ConnectorConfig`, `ImportRequest`, `ImportedDoc`, `ImportResult`)
  - `catalog.py` — `load_catalog()`, `CatalogEntry`, `resolve_entry_point()`
  - `__init__.py` — re-exports `Connector`, `load_catalog`, `run_connector`
- `lifescribe/vault/importer.py` — `VaultImporter` class; write core extracted from `pipeline.py`
- `lifescribe/ingest/pipeline.py` — shrinks to a thin shim that calls `run_connector("file_drop", …)`; existing callers unchanged
- `lifescribe/api/connectors.py` — FastAPI routes: `GET /connectors`, `GET /connectors/<service>/samples/<name>`

**Top-level**

- `connectors/` (repo root, outside `apps/backend/src/`) — scanned at backend startup
  - `connectors/file_drop/`
    - `manifest.toml`
    - `connector.py` (`FileDropConnector(Connector)`)
    - `samples/` — representative files
    - `README.md` — "how to add a connector" contributor doc
  - `connectors/README.md` — top-level contributor guide, layout conventions, manifest schema reference

**Frontend**

- `apps/desktop/src/routes/SettingsRoute.tsx` — new `<ConnectorsBrowser/>` section between LLM Providers and Index
- `apps/desktop/src/components/ConnectorsBrowser.tsx` — renders catalog list, expandable cards with markdown export instructions + sample links
- `apps/desktop/src/api/queries.ts` — new `useConnectors()` hook

**Rationale for the top-level `connectors/` directory:** per-connector dirs with `samples/` belong as first-class repo content (contributors PR them), not buried inside Python package sources. The backend reads them by path at startup.

## 4. Component Contracts

### 4.1 `Connector` ABC — `connectors/base.py`

```python
class Connector(ABC):
    @abstractmethod
    def configure(self, cfg: ConnectorConfig) -> None:
        """Called once before collect(). Validate options, open auth sessions."""

    @abstractmethod
    def collect(self, req: ImportRequest) -> Iterator[ImportedDoc]:
        """Yield ImportedDoc payloads. Pure parsing/fetching; no vault writes."""

    @abstractmethod
    def teardown(self) -> None:
        """Close sessions, delete temp files. Called in a finally block."""
```

`collect` is named to read naturally: *the connector collects from its source; the vault importer ingests what it collects.* `import` is reserved; `import_` is ugly; `run` is too generic.

### 4.2 Core dataclasses

```python
@dataclass(frozen=True)
class ConnectorConfig:
    vault_path: Path
    privacy_mode: bool
    options: dict[str, object] = field(default_factory=dict)

@dataclass(frozen=True)
class ImportRequest:
    inputs: list[Path]                     # for file-type connectors
    options: dict[str, object] = field(default_factory=dict)

@dataclass(frozen=True)
class ImportedDoc:
    title: str
    body_markdown: str
    tags: list[str]
    source_meta: dict[str, object]         # provenance, captured_at, service
    assets: list[Path]                     # files to copy under vault assets/
    content_hash: str                      # SHA256 for dedupe

@dataclass(frozen=True)
class ImportResult:
    connector: str
    imported_count: int
    skipped_count: int                     # dedupe hits
    errors: list[str]
```

### 4.3 Catalog — `connectors/catalog.py`

```python
@dataclass(frozen=True)
class CatalogEntry:
    service: str
    display_name: str
    description: str
    category: str
    auth_mode: str                         # "none" | "manual_export" | "oauth" | "api_key"
    tier: str                              # "free" | "freemium" | "paid"
    connector_type: str                    # "file" | "manual_export" | "api_sync" | "watch_folder" | "bridge"
    entry_point: str                       # "connectors.file_drop.connector:FileDropConnector"
    supported_formats: list[str]
    privacy_posture: str                   # "local_only" | "requires_network"
    export_instructions: str               # markdown body
    sample_files: list[Path]               # absolute paths, resolved from manifest dir
    manifest_schema_version: int
    manifest_path: Path

@dataclass(frozen=True)
class Catalog:
    entries: list[CatalogEntry]
    warnings: list[str]                    # non-fatal load issues, surfaced via API

    def find(self, service: str) -> CatalogEntry | None: ...

def load_catalog(connectors_dir: Path) -> Catalog: ...
def resolve_entry_point(ep: str) -> type[Connector]: ...
```

### 4.4 `VaultImporter` — `vault/importer.py`

```python
class VaultImporter:
    def __init__(self, vault: VaultHandle) -> None: ...

    def ingest(self, connector: str, docs: Iterator[ImportedDoc]) -> ImportResult:
        """Dedupe by content_hash → copy assets → write DocumentRecord → git commit → manifest update."""
```

### 4.5 Orchestration — `connectors/__init__.py`

```python
def run_connector(
    entry: CatalogEntry,
    req: ImportRequest,
    vault: VaultHandle,
    *,
    privacy_mode: bool,
) -> ImportResult:
    if privacy_mode and entry.privacy_posture == "requires_network":
        raise PrivacyBlockedError(entry.service)
    cls = resolve_entry_point(entry.entry_point)
    c = cls()
    c.configure(ConnectorConfig(vault_path=vault.path, privacy_mode=privacy_mode))
    try:
        return VaultImporter(vault).ingest(entry.service, c.collect(req))
    finally:
        c.teardown()
```

The privacy check lives at the orchestration boundary, not inside the connector — a bad-citizen connector can't bypass it by forgetting to read the flag.

## 5. Manifest Format

`connectors/<service>/manifest.toml` — fully declarative. The manifest is the single source of truth: one TOML parse tells the UI what to render *and* tells the backend how to instantiate the class.

### 5.1 Schema (v1)

```toml
manifest_schema_version = 1

# Identity + display
service = "file_drop"                      # unique; [a-z0-9_]+
display_name = "File Drop"
description = "…"                          # 1–2 sentence summary
category = "files"                         # free-form; UI groups by this

# Classification
auth_mode = "none"                         # none | manual_export | oauth | api_key
tier = "free"                              # free | freemium | paid
connector_type = "file"                    # file | manual_export | api_sync | watch_folder | bridge
privacy_posture = "local_only"             # local_only | requires_network

# Runtime contract
entry_point = "connectors.file_drop.connector:FileDropConnector"
supported_formats = ["pdf", "txt", "md", "png", "jpg", "jpeg"]

# Contributor content
export_instructions = """…markdown…"""
sample_files = ["samples/example.md"]      # paths relative to manifest dir
```

Required fields: `manifest_schema_version`, `service`, `display_name`, `category`, `auth_mode`, `tier`, `connector_type`, `entry_point`, `privacy_posture`. Missing any → entry skipped with warning.

### 5.2 Concrete example — `connectors/file_drop/manifest.toml`

```toml
manifest_schema_version = 1

service = "file_drop"
display_name = "File Drop"
description = "Import any supported file by dropping it into the vault's inbox or using the Import button. Works with PDFs, plain text, markdown, and common image formats."
category = "files"
auth_mode = "none"
tier = "free"

connector_type = "file"
entry_point = "connectors.file_drop.connector:FileDropConnector"
supported_formats = ["pdf", "txt", "md", "png", "jpg", "jpeg"]
privacy_posture = "local_only"

sample_files = ["samples/example.md", "samples/example.pdf"]

export_instructions = """
No export required. Drag-and-drop files into the app window, or use
**Import → File** from the dashboard. Duplicate imports (same content
hash) are skipped automatically.
"""
```

## 6. Data Flow

### 6.1 Catalog discovery (startup)

`load_catalog(Path("connectors"))` walks direct children, parses each `manifest.toml`:

- Missing / malformed manifest → skip with logged warning; don't crash
- Duplicate `service` values → first wins, second logged as error
- `sample_files` paths resolved relative to the manifest's directory, returned as absolute
- `export_instructions` kept as raw markdown (rendered frontend-side)
- Unknown `manifest_schema_version` → skip (forward-compat)
- `entry_point` module path sanity-checked at load time; class resolution is lazy (on first invocation)

Catalog loads once at backend startup and is cached. Reloaded via dev-only `POST /connectors/reload`.

### 6.2 Import happy path

```
UI import action  →  POST /imports { service: "file_drop", inputs: [...] }
                          │
                          ▼
                api/imports.py handler
                          │
                          ▼
                load catalog → find entry by service
                          │
                          ▼
             run_connector(entry, req, vault, privacy_mode=settings.privacy_mode)
                          │
                          ├── raises PrivacyBlockedError (HTTP 409) if blocked
                          │
                          ▼
                    c.configure(...)
                    c.collect(req)   ──► Iterator[ImportedDoc]
                          │
                          ▼
                VaultImporter(vault).ingest(service, docs)
                  ├── for each doc:
                  │     content_hash seen before? → skip (skipped_count++)
                  │     else: copy assets, write DocumentRecord .md, stage
                  └── one git commit per run: "import: <service> (<count>)"
                          │
                          ▼
                    c.teardown()   (in finally)
                          │
                          ▼
             Response: ImportResult { imported_count, skipped_count, errors }
```

### 6.3 Backwards-compat shim

`ingest/pipeline.py::run_job()` stays as a thin wrapper:

```python
def run_job(inputs: list[Path], vault: VaultHandle) -> ImportResult:
    entry = load_catalog(CONNECTORS_DIR).find("file_drop")
    assert entry is not None, "file_drop connector must be present"
    return run_connector(entry, ImportRequest(inputs=inputs), vault, privacy_mode=False)
```

Existing Tauri drop-file paths keep working unchanged. The shim is removed in a later slice once callers migrate to `POST /imports`.

### 6.4 Catalog API

```
GET /connectors
  → {
      entries: [ { service, display_name, description, category, auth_mode,
                   tier, connector_type, supported_formats, privacy_posture,
                   export_instructions, sample_file_urls, blocked } ],
      warnings: [ "connectors/foo/manifest.toml: missing field 'service'", … ]
    }

GET /connectors/<service>/samples/<filename>
  → 200 with file contents; 404 for traversal attempts or unknown service/file
```

`blocked` is precomputed against current privacy mode so the frontend doesn't duplicate the filter rule. `sample_file_urls` point back to the samples endpoint so the UI can link without filesystem access.

## 7. Error Handling

### 7.1 Catalog load

See §6.1. All failures are non-fatal: bad entries are skipped, warnings are surfaced via `GET /connectors → warnings[]`, and the Settings browser shows a "N connectors failed to load" banner.

### 7.2 Privacy enforcement (defense in depth)

1. **Orchestration boundary** — `run_connector` raises `PrivacyBlockedError` → HTTP 409. Connector never instantiated.
2. **Catalog filter** — `GET /connectors` precomputes `blocked: true`; the browser greys entries out with a "Privacy Mode is on" tooltip. User never sees an unexplained 409.
3. **Manifest authoritative** — privacy posture is declared in TOML, not at runtime. The framework cannot *statically* prevent a misbehaving `local_only` connector from making a network call; that's caught in review.

### 7.3 Connector lifecycle failures

- **`configure()` raises** → `run_connector` calls `teardown()` in `finally`, re-raises as `ConnectorConfigError`. HTTP 400. Nothing written to vault.
- **`collect()` raises mid-iteration** → docs yielded *before* the raise are already in the vault (they were written as they came through). Returns `ImportResult` with partial counts + error. User sees "Imported 3 of 5 — 2 failed: …"
- **Per-item error inside `collect()`** → connector's responsibility to append to errors and continue. Framework doesn't force.
- **`teardown()` raises** → logged, not re-raised. Cleanup failure shouldn't mask a successful import.

### 7.4 VaultImporter failures

- **Asset copy fails** (disk full, permission) → document skipped, error added to `ImportResult.errors`, others continue.
- **Git commit fails** → **fatal**. Vault must stay consistent with its index. Importer raises; route returns HTTP 500. Any files already written are reverted via `git checkout -- <paths>`.
- **Manifest update fails after commit** → logged as warning. Commit is source of truth; manifest is a rebuildable cache.

### 7.5 User-facing surfaces

- Dashboard toast: `"Imported N. Skipped M (duplicates). K failed."`
- Settings → Connectors: per-entry `blocked` badge + tooltip
- Expandable failure list in the toast if `errors.length > 0`

### 7.6 Explicit non-goals for v1

- No retry logic in the framework (connectors can retry internally)
- No progress streaming via SSE (one-shot request/response)
- No background job queue

## 8. Testing

### 8.1 Backend unit tests

- `tests/connectors/test_catalog.py` — well-formed manifest, missing fields, duplicate services, unknown schema version, sample path resolution, entry-point resolution
- `tests/connectors/test_base.py` — lifecycle order, teardown on exception, dataclass invariants
- `tests/connectors/test_run_connector.py` — privacy blocks `requires_network` when on, configure error path, mid-collect exception → partial result, per-item errors
- `tests/vault/test_importer.py` — dedupe, asset copy failure, git commit failure + rollback, one commit per run, manifest failure logged
- `connectors/file_drop/tests/test_connector.py` — PDF input, unsupported extension, duplicate input dedupes

### 8.2 Integration tests

- `tests/ingest/test_pipeline_compat.py` — existing `run_job()` fixtures pass unchanged (shim proves back-compat). Net-new assertion: same fixture through `run_connector(file_drop, …)` produces identical vault state.
- `tests/api/test_connectors_api.py` — `GET /connectors` returns catalog, `blocked` precomputation honors privacy flag, samples endpoint serves files, path traversal attempts → 404, `POST /imports` returns `ImportResult`

### 8.3 Contract test (CI gate for new connectors)

One test loads every `connectors/*/manifest.toml` in the real repo through `load_catalog` and asserts: entry parses, `entry_point` resolves to a `Connector` subclass, `supported_formats` matches what the implementation advertises. When someone PRs a new connector dir, this fails if the manifest doesn't match the implementation.

### 8.4 Frontend tests

- `apps/desktop/src/components/ConnectorsBrowser.test.tsx` — catalog list renders, blocked entries show tooltip, export instructions render as markdown, sample link opens `/connectors/<service>/samples/<name>`
- Existing Settings route test extended for the new section

### 8.5 Manual acceptance (for the plan's §10)

1. Drop a PDF into the inbox → appears as a note; `git log` shows `import: file_drop (1)`
2. Drop the same PDF again → `skipped_count == 1`, no new commit
3. Settings → Connectors shows `file_drop` with rendered export instructions
4. Toggle Privacy Mode on → `file_drop` still usable (it's `local_only`)
5. Add a fake `requires_network` manifest under `connectors/test_remote/` → appears in catalog; blocked badge visible with Privacy on; 409 on attempted import
6. Delete `manifest.toml` from `connectors/file_drop/` → restart → backend starts cleanly; `GET /connectors` returns empty; `warnings` includes the skipped dir

## 9. Open Questions / Follow-ups

None blocking v1. Follow-up slices will need to decide:

- **Governance fields** (maintainers, version, capabilities) — add to manifest schema when N > 3 connectors
- **Connector-specific options UI** — the schema supports `options: dict` but v1 has no UI for editing them. First non-file_drop connector will need this.
- **Progress streaming** — when a connector imports enough items for "one-shot" to feel slow (candidate: APISync for email)
- **User-visible catalog reload** — `POST /connectors/reload` ships for dev; productize later
- **Deleting the `ingest/pipeline.run_job` shim** — coordinate with the Tauri drop-file path migration to `POST /imports`

## 10. Dependencies

All merged in main:

- §3.1 Vault Foundation — provides `VaultHandle`, `DocumentRecord`, git commit helpers
- §3.2 Ingestion Pipeline — provides `pipeline.py` (which this spec refactors)
- §3.3 Dashboard Shell — provides the Settings route structure this design extends
- §3.4 LLM Provider Framework — reference for the catalog-as-UI pattern (providers list → connectors list)
- §3.5 Chat with Vault — no direct dependency; chat operates over the vault that connectors populate
