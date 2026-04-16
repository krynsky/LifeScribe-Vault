# LifeScribe Vault

A local-first, open-source desktop app that aggregates personal data from local
documents and third-party services into an Obsidian-compatible Markdown vault.
The vault is the human-readable system of record; everything else — indexes,
embeddings, sidecar state — is rebuildable.

## Features

- **Ingest** local documents (PDF, DOCX, XLS/CSV, TXT, MD, HTML, JSON, images, ZIP exports) and write canonical Markdown notes with full provenance.
- **Connect** to third-party services via a pluggable connector framework. v1 ships with File Drop; the framework supports file, manual-export, API-sync, watch-folder, and bridge connector types.
- **Chat** with your vault using local (Ollama, LM Studio) or remote (GitHub Models, OpenAI, Anthropic) LLM providers through a unified, OpenAI-compatible interface. Retrieval uses SQLite FTS with citation back to exact notes.
- **Browse** your vault through a desktop dashboard with import center, ingestion logs, note viewer, and settings.
- **Privacy first** — local-first by default, per-source privacy labels (private / shareable / publishable / restricted), a "never leave the machine" master switch, and zero telemetry.

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop shell | [Tauri 2.0](https://tauri.app/) (Rust) |
| Frontend | React 18, TypeScript, Vite, TanStack Query |
| Backend | Python 3.12+, FastAPI, Pydantic v2, Uvicorn |
| Storage | Git-backed Markdown vault (Obsidian-compatible) |
| Search | SQLite FTS5 |
| Packaging | PyInstaller (backend sidecar), Tauri bundler (desktop) |

## Project structure

```
LifeScribe Vault/
├── apps/
│   ├── backend/         # FastAPI backend (Python)
│   └── desktop/         # Tauri desktop app (React + Rust)
├── connectors/          # Pluggable connector catalog (scanned at startup)
│   └── file_drop/       # Reference connector
├── packages/
│   └── shared-types/    # OpenAPI-generated TypeScript types
├── docs/
│   ├── user/            # End-user documentation
│   └── superpowers/     # Design specs, plans, backlog
└── scripts/             # Dev, build, and type-gen scripts
```

## Getting started

### Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [Rust 1.75+](https://rustup.rs/) (for Tauri)
- [Python 3.12+](https://www.python.org/)
- [uv](https://docs.astral.sh/uv/) (Python package manager)

### Development

```bash
# Full stack (Tauri + backend + frontend)
./scripts/dev.sh full

# Backend only
./scripts/dev.sh backend-only

# Frontend only (Vite dev server)
./scripts/dev.sh frontend-only
```

On Windows, use the PowerShell equivalents:

```powershell
.\scripts\dev.ps1 full
.\scripts\dev.ps1 backend-only
.\scripts\dev.ps1 frontend-only
```

### Running tests

```bash
# Backend
cd apps/backend && uv run pytest -v

# Frontend
cd apps/desktop && npx vitest run
```

### Linting and type checking

```bash
# Backend
cd apps/backend
uv run ruff format --check .
uv run ruff check .
uv run mypy src/

# Frontend
cd apps/desktop
npm run lint
npm run format:check
npm run typecheck
```

### Regenerating shared types

After changing backend API routes:

```bash
# Unix
bash scripts/gen-types.sh

# Windows
powershell -File scripts/gen-types.ps1
```

### Building the packaged app

```bash
# Unix
bash scripts/build-backend.sh

# Windows
powershell -File scripts/build-backend.ps1
```

This builds the Python backend as a standalone sidecar binary and copies the connector catalog alongside it.

## Adding a connector

LifeScribe's connector framework is the primary open-source contribution surface. To add support for a new service:

1. Create `connectors/<service>/manifest.toml` with metadata and runtime contract
2. Create `connectors/<service>/connector.py` subclassing `lifescribe.connectors.Connector`
3. Add sample files in `connectors/<service>/samples/`
4. Run the contract test: `cd apps/backend && uv run pytest tests/integration/test_connector_contract.py -q`

See [connectors/README.md](connectors/README.md) for the full manifest schema.

## Documentation

- [User guides](docs/user/) — install, create vault, import files, chat, configure providers, connectors
- [Design specs](docs/superpowers/specs/) — architecture and per-subsystem design documents
- [Implementation plans](docs/superpowers/plans/) — task-level plans for each subsystem

## Architecture

LifeScribe Vault is built as seven sub-projects:

| # | Sub-project | Status |
|---|-------------|--------|
| 3.1 | Vault Foundation | Shipped |
| 3.2 | Ingestion Pipeline | Shipped |
| 3.3 | Dashboard Shell | Shipped |
| 3.4 | LLM Provider Framework | Shipped |
| 3.5 | Chat with Vault | Shipped |
| 3.6 | Connector Framework + Catalog | Shipped |
| 3.7 | Publishing Framework | Deferred to v2 |

See the [umbrella spec](docs/superpowers/specs/2026-04-12-lifescribe-vault-overview.md) for the full architecture overview.

## License

[MIT](LICENSE)
