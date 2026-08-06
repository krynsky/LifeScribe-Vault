# LifeScribe Vault

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Windows-first local desktop app for building an encrypted digital legacy plan. Helps you document your digital executors, password-manager emergency access, devices, photos and videos, financial accounts and subscriptions, important documents, online accounts, platform legacy settings, and backups — plus a printable Recovery Kit — without putting any data on a server.

**Version:** 1.0.0
**Platform:** Windows (x64), macOS (Apple Silicon, unsigned)  
**Status:** Active development

> The macOS build is not code-signed or notarized (no Apple Developer account). macOS will warn "Apple could not verify this app" the first time you open it — right-click the app and choose **Open** to bypass this, once. See [macOS packaging](docs/release/macos-packaging.md#gatekeeper) for details.

**[⬇ Download the latest release](https://github.com/krynsky/LifeScribe-Vault/releases/latest)** — Windows (x64) and macOS (Apple Silicon) installers.

---

## What It Does

LifeScribe Vault walks you through ten guided sections of your digital legacy plan:

| Section | What you capture |
|---|---|
| **Digital Executors** | Primary and backup executors — contact info, responsibilities, step-in notes |
| **Password Manager** | Provider, vault location, and how a trusted person gains emergency access |
| **Devices** | The phones and computers your family would need to unlock |
| **Photos & Videos** | Each device and collection, its location, and the software or app used to open it |
| **Financial Accounts** | Institutions and accounts, so nothing is missed |
| **Subscriptions** | Recurring services and what should happen to each (keep / cancel) |
| **Online Accounts** | Email, domains, and accounts that matter |
| **Documents** | Wills, trusts, insurance, deeds, tax records, and where they're kept |
| **Backups & Storage** | Where backups live and how to get into them |
| **Platform Legacy Tools** | Google Inactive Account Manager, Apple Legacy Contact, and similar |

Each section has identifying fields and optional supporting details — fill in what applies to your plan. A **Recovery Kit** — an auto-generated snapshot of saved data that can be printed or exported as a PDF — is the document your family starts from. Each section drives a dashboard readiness indicator, so the app won't let you forget what's missing.

---

## Security Model

- **Local-only** — no cloud sync, no telemetry, no remote services of any kind
- **Argon2id** key derivation from your master password
- **XChaCha20-Poly1305** AEAD encryption for all vault records, attachments, and backup files
- **Envelope encryption** — Argon2id derives a KEK; a random data key is wrapped by the KEK; every AEAD operation binds context via AAD domain tags (`snapshot` / `attachment` / `draft` / `backup`)
- **Safe password changes** — Settings verifies the current password, derives a fresh Argon2id key, and rewraps the existing data key without rewriting vault content; existing backups retain the password used when they were created
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
The vault is stored as an encrypted opaque JSON blob (`VaultSnapshot`). Rust never inspects field names — it stores and returns bytes identically, so the TypeScript domain model is the only place the shape is defined. Same-format unknown fields are preserved at every modeled level; a future snapshot format is refused until the app is upgraded.

### Form Pack System
Forms are driven by a versioned **FormPack** — a data-only definition of sections, groups, fields, readiness rules, and Recovery Kit mappings. The app ships one bundled pack; every field is either protected (structural) or optional. Personal Pack Editor changes are stored with the bundled baseline they came from, then three-way rebased onto future bundled packs so user changes and new base fields/migrations both survive. Stored and rebased packs are validated before rendering. On top of that, users can apply a constrained **UserOverlay** (relabel fields, reorder, add custom fields, hide optional ones).

Fields can also **link to records in another section** (`recordRef`) — a backup naming the device it protects, a subscription naming the account that pays for it. The link stores the target record's id, so renaming the target updates every reference to it, and a record cannot be deleted while something still points at it.

Pack migrations run on read, in memory, and are pure and idempotent. Changes only persist via the normal save path.

### Recovery Kit
An auto-generated snapshot of saved data derived only from each section's Kit mappings. It can be printed or exported as a PDF. It is pointer-based: it names *where* things are and who to contact, showing readable text (a dropdown's chosen label, an attachment's filename) rather than internal stored values, with no redaction of its own. Credential fields are excluded from it at two layers — pack validation and Kit generation — so a master password or device PIN can never reach the printed page.

The **Print** action opens the standard Windows/WebView print preview. **Export PDF** opens a native Save As dialog, writes the PDF to the selected location, and reports success or failure in the app. The exported PDF is an intentionally plaintext document outside the encrypted vault, so store it with the same care as a printed Recovery Kit.

### Vault Location
The vault directory is chosen during setup and changeable from Settings. A pointer file in the app config dir names the folder; if that folder can't be reached (an external drive that isn't connected), the app says so rather than silently starting a fresh vault elsewhere.

### Master Password Changes
An unlocked user can change the vault's master password from Settings by entering the current password and a new password of at least 15 characters. The app verifies the current password, generates fresh Argon2id metadata, and atomically replaces only the wrapped data key. Saved records, attachments, drafts, and retained snapshot generations remain encrypted under the same random data key, and the session stays unlocked. Existing `.lsvbackup` files remain protected by the password used when each backup was created.

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

# Build the Windows NSIS installer
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
    |             # packValidation, readiness, snapshot, recoveryKit, valuesStore)
    forms/        # FormRenderer, field controls, structure editor
    routes/       # Page components (Dashboard, SectionPage, SetupScreen,
                  # SettingsPage, BackupPage, RecoveryKitPage, LockedScreen,
                  # VaultUnavailableScreen)
  src-tauri/
    src/          # Rust: commands, crypto, repository, attachments,
                  # vault_location, backup, draft_stash
  pack-editor/    # Dev-only Vite app for editing the bundled pack
```

### Testing Conventions
- Frontend: Vitest + RTL, colocated `.test.ts(x)`, `vaultApi` mocked — Tauri `invoke` is never hit in tests
- Rust: integration tests in `src/tests/` with `tempfile` against real SQLite; assert ciphertext (no plaintext in DB files)

---

## Security Constraints

- Never ask the user for a real master password in development or tests
- Never request plaintext sensitive vault content
- Form definitions are data only — no custom JS, remote scripts, webhooks, or expression strings
- Exported form-definition packs contain structure only — never personal field values

---

## Documentation

**Current — describes how the app works today:**

- `CLAUDE.md` — architecture laws and working rules, the short version
- `docs/development.md` — developer documentation (architecture, data flows, conventions)
- `docs/user-guide.md` — user-facing guide for people who download the app
- `docs/creator-mode.md` — pack authoring (dev workflow)
- `docs/release/windows-packaging.md` — build and release process
- `docs/testing/v2-acceptance.md` — acceptance checklist

**Historical — dated design records, kept for rationale:**

- `docs/plans/` — implementation plans, including the original v2 rebuild plan
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — feature specs and plans
- `requirements.md`, `challenges.md` — the original brief and market research

Historical documents describe what was decided at the time. Some describe systems since removed — the composable form-module system, deleted 2026-07-30, is the big one. Read them for *why*; where they disagree with `docs/development.md` or the code, they are out of date.

---

## License

MIT — see [LICENSE](LICENSE) for the full text.
