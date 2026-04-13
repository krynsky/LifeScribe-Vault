# Architecture

LifeScribe Vault is a Tauri v2 desktop app with a Python FastAPI backend sidecar.

- `apps/desktop/` — Tauri v2 + React + TypeScript frontend.
- `apps/backend/` — Python 3.12 + FastAPI. Packaged as a single binary via PyInstaller and bundled with the desktop app as a Tauri sidecar.
- `packages/shared-types/` — TypeScript types generated from the backend's OpenAPI schema.

## Startup sequence
1. Tauri shell starts.
2. Rust `spawn_backend` launches the bundled `lifescribe-backend` binary with a random auth token and port.
3. Backend binds `127.0.0.1:<random>`, then prints `{host, port, token}` as a single JSON line to stdout.
4. Rust captures that line and emits a `backend-ready` event. It also exposes the values via the `backend_info` Tauri command.
5. React reads `backend_info`, then makes authenticated HTTP calls to the backend for every vault operation.

## Vault writes
Every vault write goes through `VaultStore` in `apps/backend/src/lifescribe/vault/store.py`. No other code touches vault files directly. This is the firewall that makes the data invariants (provenance, idempotency, hand-edit safety, git history) enforceable.

## Invariants
See [`docs/superpowers/specs/2026-04-12-lifescribe-vault-overview.md`](../superpowers/specs/2026-04-12-lifescribe-vault-overview.md) for the complete list.
