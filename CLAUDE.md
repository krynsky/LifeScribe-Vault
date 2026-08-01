# LifeScribe Vault v2

Local-first encrypted Windows desktop app for digital legacy planning. Tauri 2, React 19, TypeScript, Vite, Rust, SQLite, Argon2id, XChaCha20-Poly1305.

**For how the app works now**, read this file plus `docs/development.md` and the source. `docs/plans/` and `docs/superpowers/` are dated design records kept for rationale — several describe systems since removed (the composable form-module system, deleted 2026-07-30, most of all). Read them for *why*; where they disagree with `docs/development.md` or the code, they are out of date.

## Commands

```powershell
npm install
npm --prefix apps/desktop run test
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
npm --prefix apps/desktop run typecheck:pack-editor   # pack editor has its own configs
npm --prefix apps/desktop run lint:pack-editor        #   and is excluded from the above
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run dev      # live Tauri dev run
npm run build    # Windows installers
```

## Architecture Laws

- Envelope encryption: Argon2id-derived KEK wraps a random data key; every AEAD operation binds context via AAD (domain tags: `snapshot` / `attachment` / `draft` / `backup`). React never sees raw keys; keys never cross IPC or appear in errors/logs.
- The vault snapshot is opaque JSON in Rust (`serde_json::Value` passthrough) — never mirror it in a Rust struct (v1's mirrored struct silently stripped fields).
- Snapshot saves are generation-counted compare-and-swap; previous generations are retained; no save path may blind-overwrite.
- Form definitions are data, not executable scripts. No custom JS, remote scripts, webhooks, or expression strings — declarative conditional objects only.
- Credential system keys (`passwordManagerMasterPassword`, `devicePin`) may never reach the Recovery Kit, which emits mapped field values with no redaction of its own (type-appropriate display — a select's option label, a file's filename, a `recordRef`'s composed label — is resolution, not redaction; nothing is hidden by field name or type). There are **two routes into a record's values**, and both are gated: a section's own `kitMapping`, and a `recordRef`'s `reference.displayFields` reaching into the section it points at. Each is enforced at authoring (`validatePack` rejects the pack) and again at consumption (`buildRecoveryKit` filters mapped keys; `recordReferenceLabel` filters display fields). The consumption gates are the load-bearing half — a stored `customPack` reaches the Kit without ever passing `validatePack`. Adding a new way to compose display text from another record's values means adding a third gate.
- Keep protected system keys stable unless all dependent save/status/recovery mappings are migrated in the same change.
- Field-level user data is never silently dropped — orphaned values become archived answers.
- Migrations are pure, deterministic, idempotent; migrate-on-read in memory; persist only via the normal save path.
- The bundled pack ships read-only to end users: the standalone Pack Editor (`npm run pack-editor`) is a separate dev app, never bundled; `write_default_pack` is compiled in but inert in production (writes to the compile-time source path, absent on an install); the in-app Form Editor edits only the user's own `customPack`, never the bundled pack.

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
- Mutation-test safety properties: a test asserting a guard is worthless if it still passes with the guard removed. Disable it, confirm exactly the intended test fails, restore.
