# LifeScribe Vault

A Windows-first local desktop app for building an encrypted digital legacy plan. Helps you document digital executors, password manager emergency access, important document locations, backup locations, and Recovery Kit instructions — without putting any data on a server.

**Version:** 0.2.0  
**Platform:** Windows (x64)  
**Status:** Active development

---

## What It Does

LifeScribe Vault walks you through five sections of your digital legacy plan:

| Section | What you capture |
|---|---|
| **Digital Executors** | Primary and backup executors — contact info, responsibilities, step-in notes |
| **Password Manager Plan** | Provider, vault location, emergency access instructions, recovery codes |
| **Documents & Locations** | Will, trusts, insurance, real estate, financial accounts, tax records |
| **Backups & Storage** | Backup locations, types, access instructions, encryption details |
| **Recovery Kit** | Auto-generated PDF-ready summary pulled from all four sections above |

Each section drives a dashboard health indicator. The app won't let you forget what's missing.

---

## Security Model

- **Local-only** — no cloud sync, no telemetry, no remote services of any kind
- **Argon2id** key derivation from your master password
- **XChaCha20-Poly1305** AEAD encryption for all vault records, attachments, and backup files
- **Envelope encryption** — Argon2id derives a KEK; a random data key is wrapped by the KEK; every AEAD operation binds context via AAD domain tags (`snapshot` / `attachment` / `draft` / `backup`)
- **React never sees raw keys** — all crypto stays in the Rust layer
- **Encrypted backup files** — full vault + attachments bundled into a single encrypted envelope you control
- **Attachment handling** — source files are encrypted into app storage; orphan sweep removes unreferenced ciphertext

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| UI | React 19, TypeScript, Vite |
| Crypto / storage | Rust, SQLite, Argon2id, XChaCha20-Poly1305 |
| Testing | Vitest + React Testing Library (frontend), Rust integration tests |

---

## Architecture

### Vault Snapshot
The vault is stored as an encrypted opaque JSON blob (`VaultSnapshot`). Rust never inspects field names — it stores and returns bytes identically, so the TypeScript domain model is the only place the shape is defined. Unknown fields from newer app versions are preserved verbatim on every round-trip.

### Form Pack System
Forms are driven by a versioned **FormPack** — a data-only definition of sections, groups, fields, readiness rules, and Recovery Kit mappings. The pack ships with defaults; users can apply a **UserOverlay** (relabel fields, reorder, add custom fields, hide optional ones). The overlay is constrained — it cannot delete or retype protected fields.

Pack migrations run on read, in memory, and are pure and idempotent. Changes only persist via the normal save path.

### Draft Stash
A separate encrypted draft stash holds in-progress edits so a locked session never loses unsaved work.

---

## Development

### Prerequisites
- Node.js 20+
- Rust (stable toolchain)
- Windows build tools (for Tauri)

### Commands

```powershell
# Install dependencies
npm install

# Run tests
npm --prefix apps/desktop run test
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

# Run the app in dev mode (hot reload)
npm run dev

# Build Windows installers (MSI + NSIS)
npm run build
```

### Project Structure

```
apps/desktop/
  src/
    api/          # Tauri IPC wrappers (vaultApi.ts)
    components/   # Shared UI components
    creator/      # Pack editing tools (packEdits, packAutoMigrate, packExport)
    domain/       # Pure domain logic (formModel, packMerge, packMigrations,
    |             # packValidation, readiness, snapshot, recoveryKit)
    routes/       # Page components (Dashboard, SectionPage, BackupPage,
                  # RecoveryKitPage, LockedScreen, SetupScreen)
  src-tauri/
    src/          # Rust: commands, crypto, repository, attachments,
                  # backup, draft_stash, clipboard, recovery
```

### Testing Conventions
- Frontend: Vitest + RTL, colocated `.test.ts(x)`, `vaultApi` mocked — Tauri `invoke` is never hit in tests
- Rust: integration tests in `src/tests/` with `tempfile` against real SQLite; assert ciphertext (no plaintext in DB files)

---

## Security Constraints

- Never ask the user for a real master password in development or tests
- Never request plaintext sensitive vault content
- Clipboard writes of vault values go through the Rust clipboard-hygiene command (history/cloud exclusion + auto-clear)
- Form definitions are data only — no custom JS, remote scripts, webhooks, or expression strings
- Exported form-definition packs contain structure only — never personal field values

---

## Documentation

- `docs/user-guide.md` — user-facing guide for people who download the app
- `docs/development.md` — developer documentation (architecture, data flows, conventions)
- `docs/plans/2026-06-10-001-feat-lifescribe-vault-v2-rebuild-plan.md` — authoritative v2 rebuild plan
- `docs/superpowers/specs/` — feature design specs
- `docs/superpowers/plans/` — implementation plans
- `docs/release/windows-packaging.md` — build and release process
- `docs/testing/v2-acceptance.md` — acceptance checklist
