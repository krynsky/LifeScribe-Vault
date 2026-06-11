# LifeScribe Vault v2

Local-first encrypted Windows desktop app for digital legacy planning. Tauri 2, React 19, TypeScript, Vite, Rust, SQLite, Argon2id, XChaCha20-Poly1305.

The implementation plan is the authoritative design record: `docs/plans/2026-06-10-001-feat-lifescribe-vault-v2-rebuild-plan.md`. The v1 reference implementation lives at `D:\My Data\My Apps\LifeScribe Vault` (read-only pattern source — never modify it).

## Commands

```powershell
npm install
npm --prefix apps/desktop run test
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run dev      # live Tauri dev run
npm run build    # Windows installers
```

## Architecture Laws

- Envelope encryption: Argon2id-derived KEK wraps a random data key; every AEAD operation binds context via AAD (domain tags: `snapshot` / `attachment` / `draft` / `backup`). React never sees raw keys; keys never cross IPC or appear in errors/logs.
- The vault snapshot is opaque JSON in Rust (`serde_json::Value` passthrough) — never mirror it in a Rust struct (v1's mirrored struct silently stripped fields).
- Snapshot saves are generation-counted compare-and-swap; previous generations are retained; no save path may blind-overwrite.
- Form definitions are data, not executable scripts. No custom JS, remote scripts, webhooks, or expression strings — declarative conditional objects only.
- Keep protected system keys stable unless all dependent save/status/recovery mappings are migrated in the same change.
- Field-level user data is never silently dropped — orphaned values become archived answers.
- Migrations are pure, deterministic, idempotent; migrate-on-read in memory; persist only via the normal save path.
- Creator-only code is compiled out of end-user builds (Vite conditional bundling + `creator-mode` Cargo feature).

## Sensitive Data Rules

- Never ask the user for a real master password.
- Never request plaintext sensitive vault content unless the user explicitly decides to share it.
- Do not introduce plaintext export paths except behind explicit user confirmation.
- Exported form-definition packs contain structure only — never personal field values, never `custom.*` overlay keys.
- Clipboard writes of vault values go through the Rust clipboard-hygiene command (history/cloud exclusion + auto-clear), never `navigator.clipboard.writeText`.
- No cloud sync, telemetry, death detection, or remote release services without a new product decision.

## Testing Conventions

- Frontend: Vitest + RTL, colocated `.test.ts(x)`, `vaultApi` mocked — Tauri `invoke` is never hit in tests.
- Rust: integration tests in `src/tests/` with `tempfile` against real SQLite; assert ciphertext (no plaintext in DB files).
- Before claiming a form change complete, test both the definition/editor side and the entry form that should reflect it.
