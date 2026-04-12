# Vault Foundation — Design Spec

**Date:** 2026-04-12
**Status:** Approved for implementation planning
**Sub-project:** 3.1 Vault Foundation
**Parent doc:** [`2026-04-12-lifescribe-vault-overview.md`](./2026-04-12-lifescribe-vault-overview.md)

## 1. Purpose

Define the durable data contract and foundational code for LifeScribe Vault:
the on-disk layout, note types, frontmatter schema, canonical ID scheme,
git semantics, vault init/open flow, the read/write primitives every other
sub-project calls, and the project scaffolding (monorepo, CI, license).

This is the load-bearing sub-project. Every other sub-project depends on
the contract defined here. Changes to this contract after v1 require a
schema migration.

## 2. Scope

### In scope
- Tech stack selection and project scaffolding (monorepo, CI, lint, docs).
- Vault disk layout (folders).
- Note types active in v1 and their schemas.
- Frontmatter schema (core + per-type extensions).
- Canonical ID scheme.
- Git semantics (init, commit cadence, hand-edit detection).
- Vault init and open flows (including first-run wizard wiring).
- Read/write primitives (`VaultStore` API) exposed to other sub-projects.
- Schema migration framework (infrastructure; no real migrations yet).
- Integration test for end-to-end foundation behavior.

### Out of scope (deferred to later sub-projects)
- Document parsing, OCR, metadata extraction → **3.2 Ingestion**
- Dashboard UI beyond the first-run wizard shell → **3.3 Dashboard**
- LLM, retrieval, chat → **3.4 / 3.5**
- Connectors and publishers → **3.6 / 3.7**
- Entity, event, relationship, summary notes → v2 Intelligence track

## 3. Tech stack

Decided after evaluating Tauri+Python, Electron+Python, Tauri+Rust-only,
and pure-Python GUI alternatives. Selection optimizes for best product
quality, not contributor friction.

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Tauri v2** | ~10 MB footprint, native webview, Rust-backed security, signed installers across all three OSes, first-class sidecar support |
| Backend runtime | **Python 3.12** | Deepest parsing/OCR/ML ecosystem (Docling, Unstructured, marker, Tesseract, pandas, PyMuPDF, ExifTool bindings) |
| Backend packaging | **PyInstaller or Nuitka** → single binary | Bundled with Tauri as a sidecar. Users need no pre-installed Python. |
| Backend framework | **FastAPI** | OpenAPI schema → typed TS client; streaming via SSE; easy to debug with curl |
| Transport | **localhost HTTP** (`127.0.0.1` only, per-launch auth token) | Clean separation, streaming-friendly, identical shape to future remote-mode |
| Frontend | **React + TypeScript + Vite** | Largest ecosystem for data-dense dashboards |
| Runtime state | **SQLite** | Single-file, transactional, zero-setup, rebuildable from vault |
| Vault storage | **Markdown + assets on disk** | Obsidian-compatible, authoritative, portable |

**Locked:** MIT license, cross-platform from day one (Windows / macOS / Linux).

## 4. Monorepo layout

```
/                              # git repo root
  LICENSE                      # MIT
  README.md
  CONTRIBUTING.md
  CODE_OF_CONDUCT.md
  .gitignore
  .gitattributes
  .github/
    workflows/ci.yml           # lint + test on PR, 3 OSes
    ISSUE_TEMPLATE/
    PULL_REQUEST_TEMPLATE.md
  docs/
    superpowers/specs/         # design docs
    user/                      # user-facing docs (stubs in this sub-project)
    dev/                       # contributor docs
  apps/
    desktop/                   # Tauri v2 + React/TS frontend
      src-tauri/               # Rust shell
      src/                     # React UI
      package.json
      tauri.conf.json
    backend/                   # Python FastAPI sidecar
      pyproject.toml
      src/lifescribe/
        __init__.py
        api/                   # FastAPI routers
        vault/                 # vault read/write primitives (this sub-project)
        ingestion/             # (filled by 3.2)
        providers/             # (filled by 3.4)
        chat/                  # (filled by 3.5)
        connectors/            # (filled by 3.6)
        publishers/            # (filled by 3.7)
        migrations/            # schema migrations
      tests/
  packages/
    shared-types/              # TS types generated from FastAPI OpenAPI schema
  scripts/
    build-backend.{sh,ps1}     # single-file binary builder
    dev.{sh,ps1}               # runs backend + frontend together
```

The `backend/src/lifescribe/` package layout matches the seven sub-projects
1:1 so each later sub-project has a clear home without restructuring.

## 5. Vault disk layout

```
<vault-root>/
  00_inbox/              # reserved (v2); README-stub only in v1
  10_sources/            # ACTIVE — SourceRecord + DocumentRecord notes
  20_entities/           # reserved (v2); README-stub only
  30_events/             # reserved (v2); README-stub only
  40_domains/            # reserved (v2); README-stub only (ingestion writes here in v2)
  50_summaries/          # reserved (v2); README-stub only
  60_publish/            # reserved (3.7); README-stub only
  assets/                # ACTIVE — original files, attachments
  system/                # ACTIVE — vault manifest, connectors, logs, migrations
    vault.md             # VaultManifest
    connectors/          # ConnectorRecord notes
    logs/
      ingestion/         # IngestionLogEntry notes, bucketed by YYYY-MM
    migrations/          # records of applied migrations
  .gitignore             # excludes `.obsidian/workspace*`
  .gitattributes         # `* text=auto eol=lf`
```

Numeric folder prefixes retained to match Obsidian's file-tree sort order
and the karpathy-gist idiom.

## 6. Note types (v1 active set)

### 6.1 SourceRecord
Primary provenance-first record for an ingestion event. For single-document
sources (the common case), this is the only note produced — it carries
both the manifest and the extracted content body.

- **Location:** `/10_sources/<id>.md`
- **Produced by:** Ingestion (3.2) via `VaultStore.write_note`
- **ID prefix:** `src`

### 6.2 DocumentRecord
Child note generated only when a source contains multiple logical documents
(ZIP bundle, multi-sheet workbook, multi-email MBOX). Each carries its own
canonical id and backlinks to the parent SourceRecord.

- **Location:** `/10_sources/<parent-source-id>/<id>.md`
- **Produced by:** Ingestion (3.2)
- **ID prefix:** `doc`

### 6.3 ConnectorRecord
Declares a configured connector: type, auth reference, schedule, last-run
timestamp, status. v1 ships with no functional connectors — the schema
exists so 3.6 can build on it.

- **Location:** `/system/connectors/<id>.md`
- **Produced by:** Connector framework (3.6)
- **ID prefix:** `conn`

### 6.4 IngestionLogEntry
One note per ingestion job: inputs, outputs, warnings, errors, duration.

- **Location:** `/system/logs/ingestion/<YYYY-MM>/<id>.md`
- **Produced by:** Ingestion (3.2)
- **ID prefix:** `job`

### 6.5 VaultManifest
Vault root metadata. Exactly one per vault.

- **Location:** `/system/vault.md`
- **Produced by:** Vault Foundation (this sub-project) on init
- **ID prefix:** `vault`

### Reserved types (schemas NOT defined in v1)
`EntityRecord`, `EventRecord`, `RelationshipRecord`, `DomainRecord`,
`SummaryRecord`, `PublishReceipt`, `ConflictRecord`. Placeholder READMEs in
each reserved folder explain they are coming.

## 7. Frontmatter schema

### 7.1 Core (every note type)

```yaml
---
# Identity
id: src_quarterly-report-2026-q1_7k2a
type: SourceRecord
schema_version: 1

# Provenance
source_path: /Users/me/docs/foo.pdf
source_hash: sha256:8f4c...
source_mtime: 2026-03-14T09:22:41Z
imported_at: 2026-04-12T14:08:03Z
imported_by_job: job_2026-04-12_001
extractor: docling@2.1.4
extractor_confidence: 0.94

# Privacy + policy
privacy: private   # private | shareable | publishable | restricted

# Relationships
links:
  parent_source: null
  derived_from: []

tags: []
---
```

### 7.2 Per-type extensions

**SourceRecord** adds:
- `mime_type: application/pdf`
- `original_filename: foo.pdf`
- `size_bytes: 1840392`
- `page_count: 12` (if applicable)

**DocumentRecord** adds:
- `parent_source: src_xxx`
- `position_in_parent: "pages 3-5"` or `"sheet: Summary"` or `"email: 42"`

**ConnectorRecord** replaces the provenance block with:
- `connector_type: FileConnector | ManualExportConnector | APISyncConnector | WatchFolderConnector | BridgeConnector`
- `auth_ref: <keychain-alias>` (null if no auth)
- `schedule: null | cron-string`
- `last_run: ISO-8601 | null`
- `status: active | paused | error`

**IngestionLogEntry** uses a process-oriented frontmatter:
- `id: job_YYYY-MM-DD_NNN`
- `job_id: <same as id>`
- `started_at: ISO-8601`
- `finished_at: ISO-8601`
- `inputs: [file paths]`
- `outputs: [note ids]`
- `warnings: [strings]`
- `errors: [strings]`

**VaultManifest** uses only:
- `id: vault_<uuid4>` (vault itself is the one case where a random UUID is acceptable — no content to hash)
- `schema_version`
- `app_version` (the app version that last wrote the manifest)
- `created_at`
- `migrations: [{from, to, applied_at}]`

### 7.3 Validation
Each note type has a Pydantic model in `backend/src/lifescribe/vault/schemas/`.
All writes route through `VaultStore.write_note`, which validates before
committing to disk. A write that fails validation raises an exception and
never writes a partial file.

## 8. Canonical ID scheme

Format: `<type>_<slug>_<short-hash>`

**Derivation:**
- **Type prefix** — fixed per note type (`src`, `doc`, `conn`, `job`, `vault`).
- **Slug** — derived at first import from the source's original filename: lowercased, non-alphanumeric runs collapsed to `-`, trimmed, capped at 40 chars. Fallbacks in order: extracted title; literal `untitled`.
- **Short-hash** — first 4 chars of `base32(sha256(content))` (stripped of padding). Ties identity to content.

**Idempotency rules:**
- The **hash** is the stable identity anchor. On re-import, the app computes the content hash, looks up any existing SourceRecord with that hash, and reuses its id verbatim — **including the original slug**, regardless of whether the current filename would produce a different slug.
- **Same content, different filename** → one SourceRecord, one id. Slug reflects first-seen filename.
- **Same filename, different content** → different hashes → different ids (slugs match, suffixes differ).
- **Job ids are time-based** (`job_YYYY-MM-DD_NNN`) — they describe a process, not content.
- **Vault manifest id** uses a random UUID4 — it's a singleton with no content to hash.

**Filename convention:** `<id>.md`. No separate slug in the filename; the id is already readable.

**Wikilinks:** use `[[id]]`. Obsidian resolves these to the correct file.

## 9. Git semantics

- **Vault is its own git repo.** Distinct from the app source repo. `git init` runs inside the vault directory during init.
- **Commit cadence:** one commit per ingestion job. Message format:
  ```
  ingest: <job-id> — <N> notes, <M> assets

  Job: <job-id>
  Sources: <source-id-1>, <source-id-2>, ...
  Extractor: docling@2.1.4
  Duration: 4.2s
  ```
- **Migration commits** use `migrate: v<n> → v<n+1>` and are separate from ingestion commits.
- **Init commit** is `chore: initialize vault`.
- **Hand-edit detection** (invariant #5): before any write, the app checks `git status` for the target path. If the working tree shows uncommitted modifications to that path, the app instead writes to `<id>.conflict-<ISO-timestamp>.md` and logs a warning. Git is the source of truth for "was this edited."
- **No branching.** Linear history on `main`. The app never creates or switches branches.
- **`.gitattributes`:** `* text=auto eol=lf` so vaults round-trip cleanly across OSes.
- **Vault `.gitignore`:** excludes only `.obsidian/workspace*`. Everything else is tracked.
- **Git LFS:** not used in v1. Assets are regular git blobs. Re-evaluate if users hit pain with large-binary repos.

## 10. Vault init / open flow

**First run (no last-opened vault in app settings):**
Dashboard shows a setup wizard with two choices:
1. **Create new vault** — user picks an empty directory (default suggestion: `~/Documents/LifeScribe Vault/`).
2. **Open existing LifeScribe vault** — user picks a directory containing `/system/vault.md`.

**Create flow:**
1. Verify target directory exists and is empty (or offer to create).
2. Scaffold folder skeleton including reserved-folder README stubs.
3. Write `/system/vault.md` (VaultManifest).
4. Write `.gitignore` and `.gitattributes`.
5. Run `git init`, stage all, commit `chore: initialize vault`.
6. Record vault path in app settings (OS-standard config dir, not in the vault).

**Open flow:**
1. Read `/system/vault.md`.
2. Compare `schema_version` with the app's supported range.
   - Equal: open normally.
   - Older: offer migration (migration framework runs, commits results).
   - Newer: refuse to open. Display the vault's schema version and the app's max supported version.
3. Record vault path.

**Multi-vault support:** deferred. v1 opens exactly one vault per session.

## 11. Read/write primitives — `VaultStore` API

The `backend/src/lifescribe/vault/` module exposes a typed interface every
other sub-project calls. No other code in the app touches vault files
directly.

```python
class VaultStore:
    def init(path: Path) -> VaultManifest
    def open(path: Path) -> VaultManifest
    def read_note(id: str) -> Note
    def write_note(note: Note, *, commit_message: str | None = None) -> WriteResult
    def write_batch(notes: list[Note], *, commit_message: str) -> BatchWriteResult
    def write_asset(src: Path, *, canonical_name: str | None = None) -> AssetRef
    def list_notes(type: NoteType | None = None) -> Iterator[NoteRef]
    def exists(id: str) -> bool
    def is_hand_edited(id: str) -> bool
    def resolve_conflict_write(note: Note) -> WriteResult
    def migrate(target_version: int) -> MigrationReport
```

**Behavior contracts for write operations:**
1. Validate frontmatter against the Pydantic schema for `note.type`.
2. Check hand-edit status via `git status`.
3. If hand-edited, route to `resolve_conflict_write` (sibling `.conflict-*.md` file) and return a `WriteResult` with `conflict=True`.
4. Otherwise write atomically (temp file + rename).
5. Stage the file; commit immediately for single writes, or accumulate for batch writes (batch commits once at the end).

Asset writes are not committed individually — they accumulate into the
same commit as the notes that reference them, to keep history clean.

## 12. Schema migration framework

- **Migrations live in** `backend/src/lifescribe/migrations/` as numbered Python modules: `m001_<description>.py`, `m002_...`, etc.
- Each migration declares `from_version`, `to_version`, and a function `apply(vault_store: VaultStore) -> None`.
- On vault open, if `VaultManifest.schema_version` is below the app's max, the app runs migrations in order, commits each one, updates the manifest, and commits the manifest update.
- **v1 ships with no real migrations.** The framework is built, tested with a synthetic v1 → v2 migration in the integration test, and ready for future use.

## 13. Testing & CI

- **Unit tests:** `pytest` (backend), `vitest` (frontend). No coverage gate.
- **Integration test:** one end-to-end scenario exercises the foundation:
  1. Init a vault in a tempdir.
  2. Write a SourceRecord + a referenced asset.
  3. Read the note back; assert all frontmatter fields round-trip.
  4. Re-write the same note (idempotent — no new commit).
  5. Hand-edit the file on disk, attempt a write, assert a `.conflict-*.md` file is produced.
  6. Run a synthetic v1 → v2 migration, assert schema_version bumps and a migration commit is created.
  Runs on Windows, macOS, Linux in CI.
- **CI matrix:** GitHub Actions, `{windows-latest, macos-latest, ubuntu-latest}` × `{python 3.12, node 20}`. Lint + typecheck + tests on every PR.
- **Lint/format:** `ruff` + `mypy` (Python), `eslint` + `prettier` + `tsc --noEmit` (TS), `rustfmt` + `clippy` (Rust shell).
- **Pre-commit hooks:** documented in `CONTRIBUTING.md`, not enforced in-repo.
- **Release workflow:** not part of this sub-project. Added when Ingestion (3.2) lands, so M1 has a real shippable artifact.

## 14. Deliverables

At the end of this sub-project:
- Monorepo scaffold on `main` with LICENSE, README, CONTRIBUTING, CODE_OF_CONDUCT, issue/PR templates, CI matrix.
- Tauri v2 desktop app that launches and shows the first-run wizard.
- Python FastAPI backend packaged as a sidecar binary for all three OSes.
- `VaultStore` API fully implemented and documented.
- Pydantic schemas for all v1 note types.
- Migration framework with a synthetic test migration.
- Passing integration test across all three OSes.
- User-facing docs: install, create-vault, open-vault.
- Developer docs: architecture, how to run in dev mode, how to add a note type.

## 15. Explicit non-goals
- No document parsing. The only way to get notes into the vault in this sub-project is the test harness.
- No UI beyond the first-run wizard and a placeholder "empty vault" screen.
- No LLM, search, or chat.
- No actual connectors or publishers.
- No entity/event/relationship notes.

## 16. References
- Parent umbrella: `2026-04-12-lifescribe-vault-overview.md`
- Codex plan (input research, not authoritative): `../../../codex_plan.md`
- Requirements: `../../../requirements.md`
- Tauri v2 sidecar docs: https://v2.tauri.app/develop/sidecar/
- karpathy vault gist (inspirational): https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
