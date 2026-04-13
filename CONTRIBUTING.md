# Contributing to LifeScribe Vault

Thanks for your interest. LifeScribe Vault is MIT-licensed and welcomes
contributions.

## Project layout
- `apps/backend/` — Python FastAPI backend (the vault's sole writer)
- `apps/desktop/` — Tauri v2 + React/TypeScript desktop app
- `packages/shared-types/` — TypeScript types generated from the backend OpenAPI schema
- `docs/` — user and developer documentation; design specs and plans live under `docs/superpowers/`

## Running locally
See [`docs/dev/running-locally.md`](docs/dev/running-locally.md).

## Tests
- Backend: `cd apps/backend && uv run pytest`
- Frontend: `cd apps/desktop && npm test`

## Pre-commit hooks (optional)
Recommended but not enforced. See [`docs/dev/running-locally.md`](docs/dev/running-locally.md).

## Code style
- Python: `ruff format`, `ruff check`, `mypy --strict`
- TypeScript: `prettier`, `eslint`, `tsc --noEmit`
- Rust: `cargo fmt`, `cargo clippy -- -D warnings`

## Pull requests
- One logical change per PR.
- Include a test that fails before your change and passes after.
- CI must pass on Windows, macOS, and Linux.
