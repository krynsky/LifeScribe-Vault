---
title: "feat: LifeScribe Vault v2 — schema-driven rebuild with creator-mode form authoring"
type: feat
status: active
date: 2026-06-10
deepened: 2026-06-10
---

# feat: LifeScribe Vault v2 — schema-driven rebuild with creator-mode form authoring

## Summary

Ground-up rebuild of LifeScribe Vault in this repo on the proven v1 stack (Tauri 2, React 19, TypeScript, Rust, SQLite, Argon2id, XChaCha20-Poly1305), where every guided section renders from versioned form-definition data, default forms ship as bundled JSON packs editable through an in-app creator-only editor, section coverage expands per the challenges research, and a one-time v1 import preserves the user's existing vault data.

---

## Problem Frame

The v1 app (reference: `D:\My Data\My Apps\LifeScribe Vault`, branch `lifescribe-vault-v1`) is a working MVP, but its architecture fights its own product direction: only one of four sections actually renders from form definitions (the rest are hardcoded), the Form Builder's edits can't become app defaults without hand-editing TypeScript, repeating structures are faked with duplicated fields, adding a section requires touching 4+ files, and a latent Rust bug silently strips `formDefinitions`/`customFieldValues` from saved snapshots. Meanwhile the 2026 social-listening research (`challenges.md`) shows the product needs broader coverage (device inventory, financial accounts, online accounts, platform legacy tools), a guided-checklist motivational loop, and annual-review mechanics. Forms are the product; v2 makes them first-class data.

---

## Requirements

- R1. Local-first Windows desktop app; all user-authored content encrypted at rest; master-password access; no cloud, telemetry, or remote services. (origin: `requirements.md`)
- R2. Very sleek, clean, modern visual design with refined typography as a first-class concern — beautiful and friendly, with a caring/practical tone, not fear-mongering. (origin: `requirements.md`, `challenges.md` implication 7, user direction 2026-06-10)
- R3. Guided, structure-first UX: dashboard checklist as the entry point, per-section readiness, no blank-document starts. (origin: `challenges.md` §10, implication 1)
- R4. Section coverage: eight guided sections — Digital Executors, Password Manager Plan, Documents & Locations, Device Inventory, Financial Accounts & Subscriptions, Online Accounts & Domains, Platform Legacy Tools checklist (Apple/Google/Facebook), Backups & Storage — plus the Recovery Kit as a *generated view* derived from kit mappings (authored per section, rendered by U7, never separately authored as a section). (origin: `challenges.md` §§1–10)
- R5. Every section's entry form renders from versioned form-definition data — zero hardcoded section forms.
- R6. Creator mode: an in-app form-definition editor, present only in creator builds, that edits default definitions with live preview and exports a versioned definition pack that becomes the next build's bundled defaults.
- R7. End-user customization is a constrained overlay (add custom fields, relabel, reorder, hide optional fields) that can never delete/retype protected fields; overlay survives default-pack upgrades.
- R8. One-time import of the user's v1 vault data (executors, password manager plan, documents, backups; custom field values best-effort — v1's snapshot-stripping bug means real v1 vaults may contain none).
- R9. Encrypted backup files (.lsvbackup) — create **and restore** (restore was missing in v1).
- R10. Encrypted attachments with persisted metadata and orphan cleanup (v1 left metadata persistence incomplete).
- R11. Readiness model with per-section "doesn't apply to me", review-cadence staleness, and explicit "mark reviewed".
- R12. Architecture must not block future macOS/mobile ports (portable Rust core, schema-driven UI).
- R13. Recovery Kit: generated, pointer-based document (instructions and locations, never stored secrets), viewable in-app, with staleness tracking.

---

## Scope Boundaries

- No macOS, Android, or iOS builds (architecture stays portable, R12, but Windows only ships).
- No cloud sync, telemetry, death detection, or remote release services.
- No password storage or password-manager import — the app remains a password-manager *companion*.
- No PDF/plaintext export of vault content (Recovery Kit is in-app view only in v2; printable export is a follow-up behind its own security decision).
- No Windows Hello / biometric unlock.
- No external form platforms, remote scripts, webhooks, or expression-string evaluation in form definitions — definitions are pure data with declarative conditionals only.
- No end-user overlay *editor UI* in the first release (the overlay data model ships and is honored at merge time; the constrained end-user editing UI is a fast-follow — see Deferred).

### Deferred to Follow-Up Work

- Crypto wallets / crypto inheritance module: backlog per user direction (2026-06-10).
- End-user overlay editor UI (constrained Form Builder for end users): fast-follow once creator mode stabilizes.
- Printable/exportable Recovery Kit with warning-heavy confirmation flow: separate security decision.
- Spouse/family prompt features and in-app annual reminder notifications beyond dashboard staleness badges.
- Provider-specific guidance content (1Password, Bitwarden, etc.).
- Single-instance write-lock handling beyond a friendly "vault is in use" message.

---

## Context & Research

### Relevant Code and Patterns (reference repo: `D:\My Data\My Apps\LifeScribe Vault`)

- Form model and validation/normalization pipeline to evolve: `apps/desktop/src/domain/formDefinitions.ts`, `schema.ts` — protected-field registry, `validateFormSectionDefinition`, `normalizeVaultSnapshotForms`, custom-field namespace `custom.<section>.<id>`.
- Schema renderer baseline: `apps/desktop/src/routes/FormSectionRenderer.tsx` (clean type-switch core; lacks groups/conditionals/repeats).
- Rust patterns to carry forward: `*_for_session` testable command split, stable string error codes, `Zeroizing` key handling, atomic temp-file+rename writes (`commands.rs`, `crypto.rs`, `repository.rs`, `attachments.rs`, `backup.rs`).
- Test patterns: colocated Vitest/RTL tests with `vaultApi` mocked; Rust integration tests via `tempfile` with real SQLite round-trips and ciphertext assertions.
- v1 latent bug to design out: Rust `VaultSnapshot` struct omits `formDefinitions`/`customFieldValues`, silently stripping them on save — v2 treats the snapshot as opaque `serde_json::Value` in Rust.
- v1 conventions that remain law: form definitions are data, not scripts; protected system keys stay stable unless every dependent mapping migrates in the same change; never test only the builder — test the entry form it affects.

### External References

- SurveyJS licensing/architecture (rejected as primary; design reference for repeating groups & conditionals): https://surveyjs.io/pricing, https://surveyjs.io/licensing
- JSON Forms rule model (design reference for declarative conditionals): https://jsonforms.io/docs/integrations/react
- Tauri 2 bundled resources (default packs as JSON resources): https://v2.tauri.app/develop/resources/
- Schema versioning/migration practice (stepwise migrations, migrate-on-read, additive evolution): https://developer.couchbase.com/tutorial-schema-versioning
- Rejected options: Form.io (server-centric, OSL-3.0), Tripetto (subscription), jsonforms-editor (archived 2025-11), FormKit (code-first framework, not a builder).

---

## Key Technical Decisions

- **Forms: inline creator mode on an improved homegrown model** (user-confirmed 2026-06-10): generic form libraries fight this app's core invariants (protected typed system keys driving readiness and Recovery Kit, fully offline, definitions-as-encrypted-data, no expression eval). SurveyJS remains the documented fallback if builder UX becomes the bottleneck.
- **Default definitions ship as bundled JSON resource packs**, not compiled-in TS: closes v1's "promote to defaults" gap, human-diffable in git, hot-editable in dev, same loader path as user overlays. Packs are validated on load and treated as untrusted input; a TS-side validator mirrors v1's `validateFormSectionDefinition` guarantees.
- **A definition pack bundles everything a section needs**: form definitions + readiness rules + Recovery Kit mappings + migration steps. Exporting only definitions would ship forms invisible to the dashboard and Kit (flow-analysis finding I5).
- **Form model v2 adds first-class repeating groups, declarative conditionals (`visibleWhen: {field, equals}` objects — never expression strings), multi-record sections, and `schemaVersion`**: v1 faked primary/backup executors with 23 duplicated fields and hardcoded the "Other provider" conditional; device/account inventories require true repeats.
- **Pack + overlay merge with explicit precedence**: default pack wins structure; overlay wins labels/order/custom fields; systemKey collisions rename the custom field with user notification; saved select values no longer in the option list render as flagged read-only "previous answer". Pack-export validation forbids deleting or retyping protected systemKeys (creator is bound by the same constraint as end users). Type changes or cardinality reductions (repeatable→single, multi-record→singleton) on any existing key are likewise blocked at export unless a migration step is authored alongside; without one, merge treats them as remove+add and displaced values *and whole displaced records* become archived answers. Overlay hide flags are invalidated (with a user-visible notice) on any field the incoming default pack marks protected or readiness-gating — otherwise a hidden-but-required field makes a section permanently unready with no visible cause.
- **Envelope encryption with written invariants**: a random 32-byte data key encrypts all content; the Argon2id-derived KEK wraps the data key (enables future master-password change without re-encryption; backups stay openable with the password in effect at creation — v1's direct-KDF design made password change impossible). Invariants U2 owns: every AEAD operation binds context via AAD — the key-wrap binds KDF params + salt + format version (so on-disk KDF-parameter downgrade fails authentication), content blobs bind a domain tag (`snapshot` / `attachment` / `draft` / `backup`) plus record identity (so blobs can never be spliced across contexts or vaults); fresh random 24-byte nonce per encryption, never derived or reused; zeroization lifetimes per secret (master password: immediately after KDF; KEK: immediately after wrap/unwrap; data key: session-long, zeroized on lock only after in-flight save and draft stash complete); no `Debug` derive on key-holding types; keys never cross IPC or appear in errors/logs; the header reserves a wrap-format version field so password change stays implementable.
- **Rust snapshot layer is opaque**: snapshot crosses IPC as JSON and is stored as an encrypted blob without a mirrored Rust struct — the v1 field-stripping bug becomes structurally impossible. Rust round-trip tests assert byte-for-byte JSON fidelity.
- **Snapshot saves are generation-counted with compare-and-swap, and prior generations are retained**: the snapshot is the only copy of everything, so one bad save must not be fatal. Save takes the base generation it loaded from and fails with `SnapshotConflict` when the stored generation has advanced (caller reconciles — import, restore, autosave, and draft-restore can never silently last-writer-wins each other); the repository retains the previous N≥2 generations and load falls back to the newest generation that decrypts, surfacing a "recovered from previous save" notice. A fallback load marks the session *recovered*: the next save supersedes the undecryptable newer generation(s) — retained within the N-generation window — rather than failing `SnapshotConflict` against a counter the user can never catch up to.
- **Lock state machine handles dirty edits by encrypt-and-stash**: on auto-lock with unsaved edits, the draft is encrypted with the data key and persisted, restored on unlock, purged on explicit discard. Discarding silently loses data; keeping plaintext in memory while locked violates the security model.
- **Recovery Kit is pointer-based and in-app only**: it contains instructions, contacts, and *locations* of access material — never secrets (the app deliberately stores none). This matches v1's posture and the "no plaintext export" boundary, and defuses the flow-analysis C1 threat-model contradiction for v2.
- **Restore is replace-only with automatic pre-restore safety backup and restore-to-temp-then-atomic-swap**: a crash mid-restore can never destroy both vaults. Backups embed attachments so restore is complete.
- **v1 import commits as one snapshot generation, not "a SQLite transaction"**: in v2 there are no per-record rows — the real safety boundary is a single compare-and-swap snapshot save against the base generation captured at dry-run confirmation, performed only after imported attachment files are durably on disk; any earlier failure leaves v2 byte-identical (verifiable by generation number). Multi-record items append; singleton sections prompt per section before overwrite; the post-import summary references field keys, never values; AEAD failure message covers both "wrong password" and "corrupt file" (indistinguishable by design).
- **Readiness model**: a section is ready when ≥1 record has all protected fields filled, or it is marked "doesn't apply to me". Explicit "mark reviewed" and any save both reset the staleness clock. Without N/A, most real users can never reach 100% and the motivational loop dies (challenges.md §8).
- **Hidden-but-populated conditional fields**: value retained in storage, excluded from validation/readiness/Kit while hidden, restored if the condition re-truthifies. Required+hidden validates as not-required.
- **Field-level data is never silently dropped**: orphaned values (field deleted/renamed in a newer pack) surface as "archived answers". Data loss is the cardinal sin in a digital-legacy product.
- **Creator-mode preview uses synthetic sample data only**, never live vault records — keeps "exports never contain personal values" true by construction.
- **Creator mode gating is a build-time flag** (Vite env + conditional bundling): the editor is compiled out of end-user builds entirely — no hidden menus in shipped binaries. Any creator-only Rust commands (pack write/export) sit behind the `creator-mode` Cargo feature (reserved empty in U1) — absent from the end-user binary, not merely unreferenced from JS (a registered command is invokable regardless of whether its UI shipped); verified against a no-default-features build.
- **Migrations are pure, deterministic, idempotent — a law alongside "definitions are data, not scripts"**: migrate-on-read runs in memory at load; the migrated result persists only through the normal save path as a new generation, never as a hidden side-effect of load (so a crash before write-back is always safe and re-migration converges). A snapshot containing value stamps newer than the running app's migration range is refused read-write, paralleling the backup version rule.
- **Clipboard hygiene**: in-app copy affordances go through a Rust clipboard command that sets the Windows exclusion flags (no Clipboard History, no Cloud Clipboard sync — otherwise Win+V/cloud sync silently exfiltrates vault values, violating R1) and auto-clears after a short timer if the clipboard still holds our content. `navigator.clipboard.writeText` cannot set these flags and is banned for vault values. Honest limit: manual Ctrl+C of rendered text is not preventable; the lock screen must not leave copyable plaintext rendered.
- **Tauri hardening is explicit, not inherited**: v1 shipped `csp: null` and only the boilerplate default capability (`core:default`, `opener:default`) — v2 requires a strict CSP (self only, no unsafe-eval, no remote origins), a minimal capability allowlist (no shell, no frontend fs scope — all file access via purpose-built Rust commands and dialog pickers), all pack-sourced strings rendered as text nodes only (a malicious pack label must be inert), and bundled-pack integrity verification at load (embedded SHA-256 of the committed pack at minimum; Ed25519 signing is the deferred upgrade).

---

## Open Questions

### Resolved During Planning

- External form tool vs inline creator editing vs form library: **inline creator mode**, user-confirmed; research matrix in Context & Research.
- Import v1 data: **yes**, user-confirmed; one-time guided flow (U11).
- Recovery Kit contents/threat model: **pointer-based, in-app view only** for v2; printable export deferred with its own security decision.
- Crypto module: **deferred to backlog**, user-directed.

### Deferred to Implementation

- Exact CSS architecture and visual design language: decided during U5 with the design-quality bar of R2; the plan fixes only "no heavyweight UI framework; styling stays hand-rolled or utility-first".
- Argon2id parameter tuning (v1: 64 MiB / t=3 / p=1, bounds-validated): revisit against 2026 guidance during U2; keep bounds validation.
- v1 schema variations: whether multiple v1 snapshot shapes exist in the wild is discoverable only against the real vault file during U11 (the import unit includes a dry-run report for exactly this).
- Pack signing (Ed25519) for default packs: at-rest integrity is already covered by the embedded-hash verification decision; whether full signing earns its keep for v2 is decided during U10.

---

## Output Structure

    apps/desktop/
      src/
        api/vaultApi.ts
        components/            # AppShell, Field, StatusBadge, RecordList, ...
        domain/
          formModel.ts         # types: packs, sections, groups, fields, conditionals
          packValidation.ts    # untrusted-input validation + protected-key rules
          packMerge.ts         # default pack + user overlay merge
          packMigrations.ts    # schemaVersion stepwise migrations
          readiness.ts         # generic readiness + N/A + staleness
          recoveryKit.ts       # pointer-based kit generation from kit mappings
          valuesStore.ts       # section record values, archived answers
        creator/               # creator-mode editor (conditionally bundled)
        routes/                # SetupScreen, LockedScreen, Dashboard, SectionPage, ...
        forms/FormRenderer.tsx # generic schema renderer (groups/repeats/conditionals)
        test/
      src-tauri/
        resources/packs/       # default definition packs (JSON)
        src/
          commands.rs, crypto.rs, repository.rs, attachments.rs,
          backup.rs, v1_import.rs, lib.rs, error.rs
          tests/
      tauri.conf.json
    docs/plans/
    package.json               # npm workspace root

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Form definition pack shape (conceptual):

    pack
      packId, packVersion, schemaVersion, minAppVersion
      sections[]
        sectionKey, title, lede, multiRecord: bool, order
        groups[]                  # repeatable: e.g. "executor" with roles, "device"
          groupKey, title, repeatable, minRecords?, order
          fields[]
            systemKey, label, helperText, type, required, protected,
            options?, visibleWhen? {field, equals|oneOf}, order
        readinessRule             # which protected systemKeys gate readiness
        kitMapping                # which fields flow into Recovery Kit, with headings
      migrations[]                # vN -> vN+1 steps

Data flow: bundled default pack (JSON resource) → load + validate → merge user overlay → migrate values-on-read (stamped with definition version) → generic renderer → FormData/values store → encrypted snapshot (opaque JSON through Rust) → readiness + Recovery Kit derive from protected systemKeys via pack mappings. Creator mode edits the in-memory default pack with live preview on synthetic data and exports the pack JSON for the next build.

---

## Implementation Units

### U1. Repo scaffolding and app shell skeleton

**Goal:** Initialize the repo (git, npm workspace, Tauri 2 app under `apps/desktop`, Vite/React/TS, Vitest/RTL, ESLint, Rust crate) with v1's window config and verification scripts, rendering a placeholder screen.

**Requirements:** R1, R12

**Dependencies:** None

**Files:**
- Create: `package.json`, `.gitignore`, `apps/desktop/package.json`, `apps/desktop/vite.config.ts`, `apps/desktop/vitest.config.ts`, `apps/desktop/src/main.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/src/App.test.tsx`, `apps/desktop/src/test/tauriWindowConfig.test.ts`

**Approach:**
- Mirror v1's workspace layout and scripts (`npm --prefix apps/desktop run test|typecheck|lint`, root `dev`/`build`); pin current 2026 dependency versions rather than copying v1's.
- App identity: new product name/identifier distinct from v1 so both apps coexist on the same machine (separate app-data dirs — required for v1 import to read the old vault while v2 runs).
- Security config from day one: strict CSP and minimal capability allowlist per the Tauri-hardening decision — do not inherit v1's `csp: null` / boilerplate-capability baseline.
- Reserve an empty `creator-mode` Cargo feature in the scaffold so U10's creator-only commands have a stable gate from day one.

**Patterns to follow:** v1 root `package.json` delegation; v1 `tauri.conf.json` window settings (1440×1000, min 1220×760).

**Test scenarios:**
- Happy path: app renders the placeholder loading screen; `tauri.conf.json` asserts window dimensions and bundle identifier differ from `com.lifescribe.vault`.
- Config assertion: CSP is non-null and restrictive; capability files enumerate only the app's own commands (no shell, no frontend fs scope).

**Verification:** `npm run dev` launches the Tauri window; test/typecheck/lint scripts pass.

---

### U2. Rust vault core: envelope crypto, repository, session commands

**Goal:** Vault create/unlock/lock/status with envelope encryption (random data key wrapped by Argon2id KEK), encrypted-blob SQLite repository, and opaque snapshot save/load.

**Requirements:** R1, R12

**Dependencies:** U1

**Files:**
- Create: `apps/desktop/src-tauri/src/crypto.rs`, `repository.rs`, `commands.rs`, `error.rs`
- Create: `apps/desktop/src-tauri/src/tests/crypto_tests.rs`, `tests/vault_lifecycle_tests.rs`, `tests/snapshot_tests.rs`
- Create: `apps/desktop/src/api/vaultApi.ts`

**Approach:**
- Carry v1's `*_for_session` testable-core pattern, stable string error codes, `Zeroizing` keys, WAL SQLite, record-kind conflict guard.
- New vs v1: vault header stores the KEK-wrapped data key; all content encryption uses the data key. Snapshot is `serde_json::Value` passthrough — no mirrored Rust struct (designs out the v1 field-stripping bug).
- Vault creation is atomic (temp file + rename) so a crash can't leave a half-initialized vault.
- Unlock applies a small fixed delay after failure; "wrong password — there is no reset" messaging contract surfaced via error code.
- Snapshot repository implements the generation/CAS decision: monotonic generation counter; `SnapshotConflict` on stale-base saves; previous N≥2 generations retained; load falls back to the newest generation that decrypts with a recovery notice.
- AAD scheme, nonce policy, and zeroization lifetimes exactly per the envelope-encryption decision.
- The command surface is extended by later units (U5 draft-stash + clipboard-hygiene, U6 pack-resource read, U10 creator export) — expose the generation value through a stable API so U5's stash AAD can bind it.

**Execution note:** Test-first for the crypto envelope and snapshot round-trip — these are the invariants everything else stands on.

**Test scenarios:**
- Happy path: create → save snapshot with novel/unknown top-level JSON fields → lock → unlock → load returns byte-identical JSON (regression test for the v1 stripping bug).
- Happy path: wrapped data key decrypts only with correct master password.
- Error path: wrong password → `InvalidMasterPassword`; corrupt header → `CorruptVault`; commands while locked → `VaultLocked`.
- Edge case: KDF metadata outside validated bounds rejected on load.
- Edge case: kill-during-create leaves no vault file (atomicity).
- Error path: ciphertext spliced across contexts or vaults (e.g., backup envelope body presented as vault header) → AAD mismatch rejection; KDF params tampered on disk → key unwrap fails (downgrade resistance).
- Edge case: two encryptions of identical plaintext yield distinct nonces and ciphertexts.
- Happy path: corrupt newest snapshot generation → previous generation loads with a recovery notice.
- Error path: save with a stale base generation → `SnapshotConflict`, stored data unchanged.
- Happy path: corrupt newest generation → fallback load → edit → save succeeds, superseding the corrupt generation (which stays retained in the window).

**Verification:** Rust tests pass with real SQLite via `tempfile`; ciphertext assertions confirm no plaintext snapshot content in the DB file.

---

### U3. Form model v2: packs, validation, merge, migrations

**Goal:** The TypeScript domain core — pack/section/group/field/conditional types, untrusted-input pack validation with protected-key rules, default-pack + overlay merge, schemaVersion stepwise migrations, archived-answers handling.

**Requirements:** R5, R7, R12

**Dependencies:** U1 (parallel with U2)

**Files:**
- Create: `apps/desktop/src/domain/formModel.ts`, `packValidation.ts`, `packMerge.ts`, `packMigrations.ts`, `valuesStore.ts`
- Create: colocated `.test.ts` for each
- Create: `apps/desktop/src-tauri/resources/packs/default-pack.json` (skeleton; content authored in U6)

**Approach:**
- Evolve v1's model: keep systemKey identity, protected registry semantics, custom-field namespace; add `schemaVersion`, repeating groups, multi-record sections, `visibleWhen` conditional objects, per-section readiness rules and kit mappings inside the pack.
- Merge precedence per Key Technical Decisions; merge output is a resolved definition the renderer consumes; conflicts produce user-visible notices, never silent drops.
- Values are stamped with the definition version they were entered under; migrate-on-read through composed vN→vN+1 functions; orphaned values become archived answers.
- Dangling conditionals (condition references a removed field) resolve to always-visible — fail open for data visibility, never hide user data.
- Migrations follow the purity law (pure, deterministic, idempotent; migrate in memory, persist only via the normal save path — see Key Technical Decisions).
- `valuesStore.ts` declares optional attachment-ref placeholder fields on record types now, so U4–U7 type-check against them and U8's later change is additive-only.

**Execution note:** Test-first; the merge algorithm gets golden-file tests (each default-change type × overlay-state → expected outcome).

**Patterns to follow:** v1 `formDefinitions.ts` validation/normalization pipeline and its 468-line test suite as the bar.

**Test scenarios:**
- Happy path: valid pack loads; overlay relabel/reorder/custom fields merge correctly.
- Edge case: overlay custom field colliding with new default systemKey → custom field renamed + notice produced.
- Edge case: saved select value absent from new options → flagged "previous answer" marker in resolved definition.
- Error path: pack deleting/retyping a protected systemKey → validation rejects with specific error.
- Error path: malformed JSON / wrong schemaVersion beyond migration range → rejected, fallback to last-good pack.
- Happy path: values entered at schemaVersion 1 migrate stepwise to 3 via composed migrations.
- Edge case: field removed in newer pack → its value surfaces as archived answer, not dropped.
- Edge case: dangling `visibleWhen` reference → field treated as always-visible.
- Edge case: load-migrate then crash without save → reload re-migrates to identical values; migrating twice equals migrating once (idempotence property).
- Edge case: mixed-version snapshot (values stamped at different definition versions side by side) loads and renders correctly.
- Error path: snapshot stamped newer than the running app's migration range → refused read-write with a clear message.
- Edge case (golden): repeatable group reduced to single with 3 existing records → records 2–3 become archived answers, not dropped.
- Edge case (golden): unprotected field retyped without an authored migration → old non-conforming value archived, never coerced or dropped.
- Edge case (golden): overlay-hidden field promoted to protected/readiness-gating by a new default pack → hide flag invalidated with a notice; section readiness computes against the now-visible field.

**Verification:** Golden-file merge tests pass; property: no merge/migration path ever discards a non-empty user value.

---

### U4. Generic form renderer: groups, repeats, conditionals

**Goal:** One renderer that turns any resolved section definition into a working entry form — grouped layouts, repeating-record CRUD, declarative conditional visibility, validation — with zero per-section components.

**Requirements:** R2, R5

**Dependencies:** U3

**Files:**
- Create: `apps/desktop/src/forms/FormRenderer.tsx`, `apps/desktop/src/components/RecordList.tsx`, `apps/desktop/src/components/Field.tsx`
- Test: colocated `.test.tsx`

**Approach:**
- Controlled values store (v1's uncontrolled FormData approach made conditionals/derived UI awkward — both v1 interactive cases became hardcoded components).
- Repeating groups: add/edit/delete/duplicate records; delete requires confirm; record ordering stable.
- Multi-record UX model: each multi-record section renders a record list with one collapsed summary row per record (labeled by the record's first protected-field value), an inline expanded edit form for the active record, and a single "Add [record type]" button below the list; the delete confirm names the record's summary label; the empty state shows the section lede plus the add affordance.
- Archived answers render as a collapsed "Archived data" disclosure at the bottom of the section form (below active fields, above save): original field label, read-only value, and the reason archived; the only action is permanent delete with confirm. Flagged "previous answer" select values render read-only inline at their field.
- Hidden-but-populated fields: retained, excluded from validation while hidden, restored when condition re-truthifies; required+hidden validates as not-required.

**Test scenarios:**
- Happy path: a definition with two groups and six field types renders and round-trips values.
- Happy path: provider select = "Other" reveals the conditional field; switching away hides it; value restored on switching back (no data loss).
- Edge case: repeatable group add/duplicate/delete; deleting the last record leaves an empty-state affordance.
- Error path: required visible field blocks save with inline message; required hidden field does not.
- Integration: relabeling a field in the definition changes the rendered entry form (the v1 "builder edits don't show up" regression test).
- Error path: field label/helper text containing `<script>` or `<img onerror>` markup renders inert as literal text (hostile-pack render test).

**Verification:** All v1 hardcoded behaviors (executor grouping, Other-provider) reproduce purely from definition data.

---

### U5. App shell, lock state machine, dashboard and guided checklist

**Goal:** Setup → locked → unlocked flow with auto-lock that encrypt-stashes dirty drafts, plus the dashboard: guided checklist sidebar driven by the generic readiness model (N/A, staleness, mark-reviewed), section navigation, and the app's visual design language.

**Requirements:** R1, R2, R3, R11

**Dependencies:** U2, U3, U4

**Files:**
- Create: `apps/desktop/src/routes/SetupScreen.tsx`, `LockedScreen.tsx`, `Dashboard.tsx`, `SectionPage.tsx`
- Create: `apps/desktop/src/domain/readiness.ts`, `apps/desktop/src/components/AppShell.tsx`, `StatusBadge.tsx`, styling entry point
- Modify: `apps/desktop/src-tauri/src/commands.rs` (draft-stash and clipboard-hygiene commands; new Rust modules as needed)
- Test: colocated tests incl. `readiness.test.ts`

**Approach:**
- Lock state machine: unlocked / locking-with-dirty-state / locked / unlocking. Dirty drafts encrypted with the data key (AAD domain tag `draft`, stamped with the base snapshot generation) and written atomically (temp + rename) strictly before key zeroization; in-flight save at lock time completes before the key clears. Draft lifecycle: restored on unlock; purged on explicit discard, on successful save, and on vault restore; a draft that fails to decrypt surfaces as "a draft could not be recovered" — never silently vanishes. Stash filename/timestamp are accepted plaintext metadata (reveals only "editing happened at time T").
- Copy affordances use the Rust clipboard-hygiene command (exclusion flags + auto-clear — see Key Technical Decisions); the lock screen renders no copyable plaintext.
- Auto-lock trigger: a 15-minute inactivity timer (matching v1), compile-time constant, reset by user input events in the webview; the timer does not run on the locked or setup screens.
- Draft-restore UX: on unlock with a valid draft, navigate to the draft's owning section and show a non-blocking inline banner ("Unsaved changes from [time] restored") with a single Discard action; the corrupt-stash notice uses the same banner pattern without Discard. The stash binds the base snapshot generation via the stable U2 generation API.
- `SnapshotConflict` on a user save: inline banner — edits stay in the form; "Save again" re-applies the form values onto a fresh load as a new compare-and-swap attempt; "Discard" reloads latest.
- "Recovered from previous save" surfaces as a persistent warning-styled (not error-styled) dashboard banner after unlock — "your data is intact; consider creating a backup now" — dismiss-only, never auto-dismissed.
- "Mark as reviewed" and "Doesn't apply to me" live as secondary actions at the bottom of each section page below the primary Save button; N/A requires one inline confirmation ("this section will count as complete"); the sidebar checklist row only reflects the resulting status badge.
- Dashboard empty/first-run state: when nothing is selected and the vault is new, the main pane renders a designed welcome state — warm one-paragraph orientation, overall readiness at 0% framed encouragingly, and a single primary "Start with [first incomplete section]" call to action; never a blank or metrics-only view.
- Setup requires password confirmation and an explicit "there is no recovery — this password cannot be reset" acknowledgment.
- Readiness is generic over pack readiness rules: ready = (≥1 record with all protected fields filled) OR section marked N/A. Staleness from review cadence; "mark reviewed" button and saves both reset the clock; stale-complete renders distinctly from incomplete.
- Visual design built fresh (R2): very sleek, clean, modern aesthetic with typography as a first-class deliverable — a deliberate type system (typeface selection, scale, weights, line-height, spacing rhythm) established before screens are styled, not inherited defaults. Hand-rolled or utility CSS, no heavyweight UI framework; warm/caring tone in copy; generous whitespace and restrained color over decoration.

**Test scenarios:**
- Happy path: setup → dashboard; checklist reflects saved data only (not transient edits).
- Happy path: auto-lock with dirty form → unlock → draft restored intact.
- Edge case: app killed while locked with a stashed draft → next unlock still offers the draft.
- Edge case: kill mid-stash-write → vault intact; draft is either absent or whole (atomic write), and the data key never outlives the stash path.
- Error path: corrupt stash file at unlock → user-visible "draft could not be recovered" notice; unlock proceeds normally.
- Happy path: inactivity timer fires at T+15min → stash-then-lock sequence; any user event before T+15min resets the timer; timer inert while locked.
- Edge case: section marked N/A counts toward overall readiness; unmarking returns it to incomplete.
- Edge case: cadence shortened → previously fresh sections go stale; mark-reviewed clears without data edits.
- Error path: failed unlock shows no-reset messaging; repeated failures delayed.
- Integration: saving a section updates checklist status and overall readiness percentage in the same render cycle.

**Verification:** No plaintext draft content persists on disk while locked (inspect app-data dir in a test); the full lock state machine paths are covered.

---

### U6. Default definition pack: eight guided sections authored

**Goal:** Author the shipped default pack content — the eight guided R4 sections with fields, groups, conditionals, helper copy, readiness rules, and kit mappings — loaded as a bundled Tauri resource with dev hot-reload. (The Recovery Kit is a generated view rendered by U7 from the kit mappings authored here, not a ninth authored section.)

**Requirements:** R3, R4, R5, R13

**Dependencies:** U3, U4, U5

**Files:**
- Create/Modify: `apps/desktop/src-tauri/resources/packs/default-pack.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (bundle.resources), pack loader in `apps/desktop/src/domain/`, `apps/desktop/src-tauri/src/commands.rs` (pack-resource read command — frontend has no fs scope)
- Test: `apps/desktop/src/domain/defaultPack.test.ts`

**Approach:**
- Port v1's four sections — Digital Executors, Password Manager Plan, Documents & Locations, Backups & Storage — losslessly (executors become one repeatable group with a role field instead of 23 duplicated fields; provider "Other" becomes a `visibleWhen` conditional; v1's provider option list carries over).
- Platform Legacy Tools is modeled as a singleton multi-group section (one fixed group per platform — Apple Legacy Contact, Google Inactive Account Manager, Facebook memorialization — each with a status select [Not set up / In progress / Completed], notes, and instruction helper text); no repeatable records. Readiness: all platform statuses Completed, or the section marked N/A.
- New sections authored from `challenges.md`: Device Inventory (repeatable: device, unlock hint location, recovery notes), Financial Accounts & Subscriptions (repeatable, discovery-oriented — institution, account type, where access info lives), Online Accounts & Domains (repeatable incl. domains/websites/creator accounts), Platform Legacy Tools (Apple Legacy Contact / Google Inactive Account Manager / Facebook memorialization checklist with status selects and notes).
- Helper copy follows the caring-practical tone; every section's lede explains *why* ("save your family weeks of chaos").
- Dev mode reads packs from the source `resources/` dir for hot-reload; release reads bundled resources only; both paths validate as untrusted input.

**Test scenarios:**
- Happy path: shipped pack passes validation; every section renders through the generic renderer without errors.
- Happy path: each section's readiness rule references only protected systemKeys that exist in that section.
- Edge case: kit mappings reference only existing fields.
- Test expectation for copy/content quality: none — reviewed manually in-app (content, not behavior).

**Verification:** Dashboard shows all eight guided sections plus the Recovery Kit entry; checklist works end-to-end on a fresh vault using only pack data.

---

### U7. Recovery Kit generation and staleness

**Goal:** Generate the pointer-based Recovery Kit from pack kit-mappings across all sections, view it in-app, and track Kit staleness against contributing data.

**Requirements:** R11, R13

**Dependencies:** U5, U6

**Files:**
- Create: `apps/desktop/src/domain/recoveryKit.ts`, `apps/desktop/src/routes/RecoveryKitPage.tsx`
- Test: colocated tests

**Approach:**
- Kit content derives generically from kit mappings — adding a section to the pack adds it to the Kit with no code change.
- Pointer-based: contacts, instructions, locations; structurally no secret-value slots.
- Staleness: store last-generated timestamp + hash of contributing values; dashboard badge when out of date.
- Page states: regenerate-on-view with a "Last updated" timestamp under the heading; a stale banner when vault data changed since the Kit was last saved ("this view reflects your latest data"); a prominent "Save Kit" action commits the current view and clears staleness; empty state ("your Recovery Kit will appear here once you complete a guided section") when no kit-mapped values exist.

**Test scenarios:**
- Happy path: Kit includes executors, password manager plan, and each populated section per its mapping; hidden conditional values excluded.
- Edge case: empty and N/A sections omitted gracefully.
- Happy path: editing a contributing field flags the Kit stale; regenerating clears it.
- Integration: a creator-added section with a kit mapping appears in the Kit without code changes.

**Verification:** Kit renders in-app; no field outside kit mappings can reach the Kit output.

---

### U8. Attachments with metadata persistence and orphan cleanup

**Goal:** Encrypted attachment add/list/delete attached to specific records, metadata persisted in the snapshot, orphaned ciphertext files swept.

**Requirements:** R10

**Dependencies:** U2, U5

**Files:**
- Create: `apps/desktop/src-tauri/src/attachments.rs`, `apps/desktop/src/components/AttachmentList.tsx`
- Modify: `commands.rs`, `valuesStore.ts` (attachment refs on records — additive-only: fills in the optional placeholder fields U3 already declared)
- Test: Rust `tests/attachment_tests.rs` + component tests

**Approach:**
- Carry v1's encrypt-to-app-storage with temp-file atomic rename; add the missing metadata persistence (attachment id, filename, size, owning record id) inside the encrypted snapshot.
- Reference model enables cleanup: deleting a record cascade-deletes its attachments (with confirm). Sweep ordering law: the orphan sweep runs only after successful unlock and snapshot load (the reference set doesn't exist while locked), never while a restore marker exists, and treats a file as orphaned only if unreferenced by *every retained snapshot generation*. Attachment-add ordering: ciphertext file written and fsynced before the snapshot referencing it is saved — a crash yields a sweepable orphan, never a dangling reference.
- No in-app decrypt-to-temp viewer in v2 (avoids the plaintext temp-file leak vector); attachments list name/size and can be deleted; "export decrypted copy" deferred with the export security decision.

**Test scenarios:**
- Happy path: add attachment → metadata survives lock/unlock → file decrypts correctly (Rust round-trip).
- Happy path: deleting the owning record removes metadata and ciphertext file.
- Edge case: unreferenced ciphertext file → swept after unlock; a file referenced only by a retained older generation survives; sweep attempted before unlock or while a restore marker exists is a no-op.
- Edge case: crash between attachment file write and snapshot save → file swept on the next post-unlock sweep; vault stays consistent.
- Error path: unreadable source path → clean error, no partial ciphertext file left.

**Verification:** No orphaned files after CRUD exercises; metadata round-trips through the opaque snapshot.

---

### U9. Encrypted backup create and restore

**Goal:** Versioned `.lsvbackup` (now embedding attachments) with a safe in-app restore: replace-only, automatic pre-restore safety backup, restore-to-temp-then-atomic-swap.

**Requirements:** R9

**Dependencies:** U2, U8

**Files:**
- Create: `apps/desktop/src-tauri/src/backup.rs`, `apps/desktop/src/routes/BackupPage.tsx`
- Modify: `commands.rs`
- Test: Rust `tests/backup_tests.rs`

**Approach:**
- Backup envelope v2: KDF metadata + wrapped data key + encrypted vault DB + encrypted attachments; integrity covered by AEAD; atomic write.
- Restore is staged behind an on-disk restore journal/marker: resolve dirty state first (save or explicit discard; any draft stash is purged with a warning) → validate envelope → decrypt with the backup's password → safety backup = atomic raw file-copy of the still-encrypted current vault + attachments (no password required), verified readable before the swap begins. Retention policy: exactly one safety backup is retained; beginning a new restore atomically replaces any prior one; it is auto-deleted on the first successful unlock after the restore marker clears (cleanup runs in the post-unlock sequence alongside the orphan sweep); its filename and timestamp are shown in the restore-complete UI so the user can archive it manually first → restore attachments to a temp dir → checkpoint WAL, swap the DB, remove outgoing `-wal`/`-shm` sidecars → swap the attachment dir → clear the marker. Startup with a marker present resumes or rolls back to the safety backup; the orphan sweep is skipped while a marker exists.
- The backup version field and KDF metadata live inside the AEAD-authenticated region (a flipped version byte must fail as corrupt, not steer migration/refusal). Refuse backups from a newer app version with a clear message; older versions migrate forward on first unlock.
- Dashboard nudge when no backup exists or the last one is older than the review cadence.
- Interaction UX: backup creation uses the native OS folder-picker (Tauri dialog), then inline progress and a success notice naming the output file. Restore uses the native file-picker (`*.lsvbackup`), then an explicit confirmation screen ("this will replace your current vault — a safety backup will be created first") before anything runs; progress renders as inline steps (validating → safety backup → restoring → complete) with the current step highlighted.

**Test scenarios:**
- Happy path: backup → wipe app data → restore → identical snapshot and attachments.
- Happy path: backup made before a (future) password change opens with the old password (envelope property).
- Error path: wrong password / truncated file → combined wrong-password-or-corrupt message; existing vault untouched.
- Edge case: kill mid-restore → original vault intact (swap atomicity); safety backup exists.
- Error path: newer-version backup → refused with version message; tampered version field → refused as corrupt (AEAD failure), not "too new".
- Edge case: restore with a stashed draft present → draft purged with warning, never offered against the restored vault.

**Verification:** Failure-injection list (kill mid-restore, truncation, wrong password) all leave a usable vault.

---

### U10. Creator mode: in-app default-pack editor and pack export

**Goal:** Build-flag-gated editor for the default pack: edit sections/groups/fields/options/conditionals/readiness/kit-mappings with live preview on synthetic data; export a validated, versioned pack JSON ready to commit as the next build's bundled default.

**Requirements:** R6, R7 (overlay constraints enforced by shared validation)

**Dependencies:** U3, U4, U6

**Files:**
- Create: `apps/desktop/src/creator/CreatorModePage.tsx`, `apps/desktop/src/creator/packExport.ts`
- Modify: Vite config (creator flag, conditional bundling), `Dashboard.tsx` (creator nav entry under flag), `apps/desktop/src-tauri/Cargo.toml` and `commands.rs` (creator-only export commands behind the `creator-mode` feature reserved in U1)
- Test: colocated tests incl. export-validation tests

**Approach:**
- `VITE_CREATOR_MODE` build flag; the creator module is excluded from end-user bundles (verified by a bundle-content check), not hidden at runtime.
- Editor edits a working copy of the default pack; live preview renders through the same `FormRenderer` with synthetic sample data — never live vault records.
- Export runs full pack validation plus creator-specific rules: protected systemKeys cannot be deleted/retyped/renamed (rename requires an explicit migration step authored alongside); type changes and cardinality reductions on any existing key are blocked without an authored migration (same rule); export bumps packVersion; output is structure-only by construction (the serializer has no value slots — asserted by test) and serializes the default-pack working copy only — validation rejects any `custom.*`-namespaced key or overlay content so user-authored definitions can never bleed into shipped defaults.
- Workflow: edit in creator build → export JSON → commit to `resources/packs/` → next build ships it; existing vaults pick it up through normalize/merge on load.

**Test scenarios:**
- Happy path: relabel field + add field + add section → export → exported pack validates and round-trips through the loader.
- Error path: attempt to delete a protected field → blocked with explanation; retype protected field → blocked.
- Happy path: systemKey rename flow forces authoring a migration step; export without it is blocked.
- Edge case: export from a vault containing real data → exported JSON contains zero record values (structural assertion) and zero `custom.*` keys.
- Error path: invoking a creator-only Rust command against an end-user binary → command not found (Cargo feature gating verified).
- Error path: export containing a cardinality reduction or field retype without an authored migration → blocked with explanation.
- Integration: exported pack dropped into resources → fresh app run renders the edited form; existing-vault fixture normalizes with values intact.

**Verification:** End-user build artifact contains no creator-module code; full creator loop (edit → export → bundle → render) demonstrated.

---

### U11. v1 import

**Goal:** One-time guided import: open the v1 vault SQLite file (or `.lsvbackup`) with its master password, decrypt the v1 snapshot, and map executors, password manager plan, documents, backups, and custom field values into v2 records.

**Requirements:** R8

**Dependencies:** U5, U6

**Files:**
- Create: `apps/desktop/src-tauri/src/v1_import.rs`, `apps/desktop/src/routes/ImportPage.tsx`, `apps/desktop/src/domain/v1Mapping.ts`
- Modify: `commands.rs`
- Test: Rust `tests/v1_import_tests.rs` with a fixture v1 vault; mapping unit tests

**Approach:**
- Rust opens the v1 vault via copy-then-read only (immutable-URI opens are forbidden: they ignore uncommitted WAL frames, silently importing a stale snapshot if v1 closed uncleanly, and a plain open can write `-wal`/`-shm` sidecars next to the "untouched" file). Copy the v1 db and any `-wal`/`-shm` sidecars to a temp location, checkpoint and read the copy, and clean up the temp copy on both success and failure. The v1 master password follows the same contract as the v2 password: crosses IPC once, KDF'd immediately, `Zeroizing`-wrapped, never logged or echoed in errors or the dry-run report; the derived v1 key lives only for the decrypt call; the decrypted v1 plaintext is held only in the unlocked session, never written to disk unencrypted, and dropped after commit or rollback. The unlock-style failure delay applies; the prompt is labeled "your v1 password (it may differ from your v2 password)" and is never offered to be remembered.
- Dry-run first: show a summary of what will import and anything unmappable (referencing field keys, never values); then commit as one compare-and-swap snapshot save against the base generation captured at dry-run confirmation, after any imported attachment files are durably on disk.
- v1 attachments are in scope: re-encrypted under the v2 data key (silent omission of user files would violate the no-data-loss law); files are written before the referencing snapshot commits, and a failed import's copied files are collected by the orphan sweep.
- Mapping: v1 primary/backup executor field pairs → two records in the repeatable executor group; password manager plan incl. "Other" provider → conditional field; documents/backups records → multi-record sections; v1 `customFieldValues` → v2 custom fields (overlay entries).
- Conflict policy: multi-record items append; singleton-ish sections prompt per section before overwrite; import recorded as done — re-run requires explicit confirmation.
- Offer import on first-run setup completion and from settings; detect SQLite-busy (v1 app running) with a "close LifeScribe Vault v1" message.
- Flow UX: three linear steps — (1) file picker + v1 password entry (with the "may differ from your v2 password" label); (2) full dry-run report listing mappable/unmappable items by section (field keys only), with per-section overwrite prompts inline and a single Import CTA at the bottom; (3) success/partial-failure summary with a "View in dashboard" action. Errors (wrong password, locked file) replace step 2 inline with a back affordance.
- `SnapshotConflict` at commit (vault saved between dry-run and commit): automatically re-run the dry-run against the new base generation, re-present only the prompts whose answers could change, and require re-confirmation before committing.
- customFieldValues are best-effort recovery: real v1 vaults likely contain none (v1's stripping bug); the dry-run explicitly reports whether any were found.

**Test scenarios:**
- Happy path: fixture v1 vault imports; executors land as two group records; provider "Other" maps to the conditional field; custom field values preserved.
- Error path: wrong v1 password → combined wrong-password-or-corrupt message; v1 file untouched.
- Edge case: re-run import → duplicates prevented absent explicit confirmation.
- Edge case: import after v2 data exists → appends records, prompts before any overwrite.
- Error path: v1 file locked by running v1 app → friendly close-v1 message.
- Edge case: v1 vault directory (including any `-wal`/`-shm` sidecars) byte-identical after both successful and failed import.
- Error path: failure after attachment copy but before snapshot commit → snapshot generation unchanged; copied files swept.
- Edge case: fixture v1 vault with uncommitted WAL frames → those records appear in the dry-run report (copy-then-read checkpoints the copy).
- Edge case: vault saved between dry-run confirmation and import commit → dry-run re-runs against the new base; changed prompts re-presented; no stale overwrite decisions applied.
- Integration: post-import readiness and Recovery Kit reflect imported data.

**Verification:** Dry-run report matches committed result; transaction rollback on any mapping failure leaves v2 unchanged.

---

### U12. Windows packaging and installed-app acceptance

**Goal:** MSI/NSIS installers for the end-user build (creator module excluded), plus an installed-app acceptance checklist run against a clean Windows profile.

**Requirements:** R1, R2

**Dependencies:** U1–U11

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (bundle config, icons, resources)
- Create: `docs/testing/v2-acceptance.md`, `docs/release/windows-packaging.md`

**Approach:**
- Carry v1's packaging knowledge (bundle targets, MSI vs NSIS roles); bundled pack resources verified present in the installed layout.
- Acceptance checklist covers: clean install → setup → all sections → lock/auto-lock → backup/restore → v1 import → uninstall leaves no plaintext residue in app-data. Security items: a value copied via an in-app copy button is absent from Windows Clipboard History (Win+V); tampering with the installed default-pack file causes refusal/fallback, not silent acceptance.

**Test scenarios:**
- Test expectation: none — packaging/config unit; behavior verified via the acceptance checklist document.

**Verification:** Both installers build; acceptance checklist executed and recorded against a clean profile/app-data dir.

---

## System-Wide Impact

- **Interaction graph:** pack loader → merge → renderer → values store → snapshot save is the spine; readiness, Recovery Kit, and creator export all hang off pack mappings. A pack-format change touches all of them — pack validation is the choke point that keeps this safe.
- **Error propagation:** Rust error codes remain the stable contract (`InvalidMasterPassword`, `CorruptVault`, `VaultLocked`, plus new `SnapshotConflict`, `ImportConflict`, `RestoreRefused`, `BackupVersionTooNew`); the frontend maps codes to caring, actionable copy.
- **State lifecycle risks:** dirty-draft stash across lock; restore swap atomicity; import transactionality; attachment orphan sweep. Each unit owns its failure-injection tests.
- **API surface parity:** creator builds and end-user builds share every code path except the creator module — divergence limited to one conditionally-bundled directory.
- **Integration coverage:** the cross-layer scenarios unit tests can't prove: builder/creator edit → entry form reflects it; section save → checklist + Kit staleness update; pack upgrade → existing vault values intact. Each named in unit test scenarios.
- **Unchanged invariants:** v1 app and its vault remain untouched (import is read-only); the security model (keys never in React, definitions are data not scripts, no plaintext export paths) carries identically into v2.

---

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Form model v2 (groups/repeats/conditionals/merge) grows complex and delays everything downstream | Med | High | U3 is test-first with golden-file merge tests; scope conditionals to equality checks only; SurveyJS documented as fallback |
| Pack/overlay merge silently breaks customized vaults on app update | Med | High | Explicit precedence table, conflict notices, "no value ever dropped" property test, archived answers |
| v1 vault decryption mismatch (KDF metadata or snapshot shape differs from docs) | Low | Med | Import unit starts with a dry-run report against the real v1 file; v1 code is available as ground truth |
| Creator/end-user build divergence introduces creator-only bugs | Low | Med | Single shared code path except one bundled-out directory; bundle-content assertion in CI scripts |
| Greenfield visual design misses the R2 bar (sleek/clean/modern, refined typography) | Med | Med | U5 establishes the type system and design language before styling screens; iterate with screenshots before declaring done; use a dedicated frontend-design pass during implementation |
| Scope: nine sections of content authoring (U6) balloons | Med | Med | Sections are pure pack data — ship with concise field sets first; creator mode makes iteration cheap post-launch |
| Single encrypted snapshot blob is a single point of loss | Med | High | Generation retention + compare-and-swap saves + fallback load (U2); "no value ever dropped" property tests (U3) |

---

## Phased Delivery

### Phase A — Foundation (U1, U2, U3)
Repo, vault core with envelope crypto and opaque snapshots, form model v2. U2 and U3 parallelize after U1.

### Phase B — The app (U4, U5, U6, U7)
Generic renderer, shell/lock/dashboard/readiness, authored default pack, Recovery Kit. End of Phase B = usable fresh-start app.

> **Execution checkpoint (user workflow note):** when Phase B is complete and verified, pause and remind the user to switch the model to Sonnet 4.6 for Phases C and D (user direction, 2026-06-10).

### Phase C — Data lifecycle (U8, U9, U11)
Attachments, backup/restore, v1 import. End of Phase C = the user can migrate for real.

### Phase D — Creator loop and ship (U10, U12)
Creator mode editor + pack export, packaging + acceptance. U10 can start alongside Phase C.

---

## Documentation / Operational Notes

- Write `CLAUDE.md` for the new repo early (U1), carrying v1's sensitive-data rules and the protected-key stability law verbatim.
- `docs/release/windows-packaging.md` and `docs/testing/v2-acceptance.md` produced in U12.
- The creator workflow (edit → export → commit pack → build) gets a short `docs/creator-mode.md` in U10.

---

## Sources & References

- Origin inputs: [requirements.md](../../requirements.md), [challenges.md](../../challenges.md)
- Reference implementation: `D:\My Data\My Apps\LifeScribe Vault` (branch `lifescribe-vault-v1`) — esp. `docs/project-handoff.md`, `docs/superpowers/specs/2026-05-21-per-vault-form-builder-design.md`
- External: SurveyJS pricing/licensing (https://surveyjs.io/pricing), JSON Forms (https://jsonforms.io), Tauri 2 resources (https://v2.tauri.app/develop/resources/), schema versioning practice (https://developer.couchbase.com/tutorial-schema-versioning)
