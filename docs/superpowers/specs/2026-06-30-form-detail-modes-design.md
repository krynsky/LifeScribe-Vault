# Form Detail Modes — Hint vs Credential

**Date:** 2026-06-30
**Status:** Approved design, ready for implementation planning

## Problem

The bundled form is deliberately "hint only": it records *where* to find secrets
(recovery-material location, unlock-hint location) but never the secrets
themselves. Every guardrail lives in field labels and helper text, e.g.
`"Recovery material location"` / `"never the codes themselves"` and
`"Unlock hint location"` / `"Never the PIN itself"`.

The vault is already protected by a master password and the entire snapshot is
sealed with XChaCha20-Poly1305 before it touches disk (`repository.rs:299`;
there is no plaintext field storage). For a single-user local vault this makes
the hint-only posture stricter than necessary. The owner wants the option to
store the actual master passwords, PINs, and codes — while keeping the safer
form available for anyone who prefers it.

## Goal

Ship **two form variants** and let the owner choose:

- **Hint mode** — the current safe form (locations and recovery instructions only).
- **Credential mode** — stores the real secrets (master password, device PIN,
  unlock codes) alongside the existing fields.

The choice is made at first-run onboarding and can be changed afterward.
The inline form editor works in both modes.

## Security posture

No new at-rest encryption is required. The whole snapshot — every field value —
is already AEAD-encrypted and AAD-bound to the `snapshot` domain. A master
password typed into a field is encrypted exactly as strongly as a location hint.
Credential mode changes *which fields exist and how they are worded*, not how
values are stored.

Deliberate scope limits (owner decision — "no extra encryption or options"):

- No on-screen masking / reveal toggle for secret fields.
- No per-Kit "include sensitive values?" warning gate.
- No second (field-level) encryption layer.
- Switching modes clears form-structure edits rather than maintaining a separate
  custom pack per mode.

The Recovery Kit **includes** the secrets in credential mode (owner choice A):
the Kit is the deliverable and is meant to be a complete handoff.

## Architecture

Approach A: **two bundled pack files + a `formMode` profile flag.** Each file is
a complete, independently validated `FormPack` that flows through the existing
pipeline (`validatePack` → `mergePackWithOverlay` → `migrateVaultValues` →
`reconcileSectionValues`). No new data-migration machinery.

### 1. Pack files

- `apps/desktop/src-tauri/resources/packs/default-pack.json` — unchanged (hint).
- `apps/desktop/src-tauri/resources/packs/default-pack-credential.json` — **new**,
  a **superset** of the hint pack:
  - Identical `sectionKey`s, `groupKey`s, and all shared field `systemKey`s.
  - Reworded labels/helper text that drop the "never store the secret" language.
  - **Added** secret fields appended to their groups — at minimum:
    - Password Manager: `passwordManagerMasterPassword` (`text`).
    - Devices: `devicePin` (`text`).
    The exact set of secret fields is finalized during planning by walking each
    section's hint fields and adding the matching secret where one applies.
  - `kitMapping` extended to list the new secret `systemKey`s so they flow into
    the Recovery Kit.

**Superset invariant (test-enforced):** every `systemKey` present in the hint
pack is also present in the credential pack, and both packs declare the **same
`schemaVersion`**. The two packs evolve in lockstep. This is what makes mode
switching lossless — values are keyed by `systemKey` and reconciled against
whichever pack is active.

### 2. Profile flag

`VaultProfile` gains:

```ts
formMode: "hint" | "credential";  // default "hint"
```

- `normalizeSnapshot` reads `profile.formMode`, defaulting to `"hint"` when
  absent (covers every existing vault and the empty-snapshot fallback).
- `buildSnapshot` re-emits it.
- `emptySnapshot(ownerName, formMode = "hint")` carries the onboarding choice
  into the first persisted snapshot.

The flag is stored inside the encrypted snapshot like every other profile value.

### 3. Load pipeline

In `Dashboard.tsx` (~line 241) the base-pack resolution becomes:

```ts
pack = parsedForPack.customPack ?? await loadDefaultPack(parsedForPack.profile.formMode);
```

- `loadDefaultPack(mode)` selects the bundled file for the mode.
- Rust `read_default_pack` gains a `variant` argument resolving to the matching
  resource path; the static-import fallback in `loadDefaultPack.ts` imports both
  JSON files and picks by mode.
- Everything downstream (merge, migrate, reconcile) is unchanged.

### 4. Onboarding (SetupScreen)

Add a mode choice to first-run setup — two radio cards:

- **"Store locations only (safer)"** — *Records where to find passwords and PINs,
  never the secrets themselves.*
- **"Store the actual secrets"** — *Keeps real passwords, PINs, and codes inside
  this encrypted vault.*

`SetupScreenProps.onCreate` becomes
`(masterPassword, ownerName, formMode) => Promise<void>`. The choice threads
`SetupScreen → App.handleCreate → Dashboard` as a hint (mirroring `ownerNameHint`)
and is written into the first snapshot's profile via `emptySnapshot`.

### 5. Switching after install

A "Form detail" control sits beside the existing Form Editor toggle in the
Dashboard. Switching runs `handleSwitchMode(newMode)`:

1. Confirm dialog. If a `customPack` exists, the dialog adds: *"Your custom form
   edits will be replaced by the standard [mode] form. Your entered data is kept."*
2. Set `profile.formMode = newMode` and **clear `customPack`** (the inline-editor
   output is mode-specific).
3. CAS-save the snapshot, then reload.
4. Values reconcile against the new base: credential-only fields render empty in
   hint mode; switching back turns their stored values into **archived answers**
   (field-level data is never silently dropped). Overlay relabels and custom
   fields survive because they are keyed by `sectionKey`/`systemKey`.

### 6. Editor & Recovery Kit

- **Editor:** mode-agnostic. It already edits whatever pack is loaded, so it
  works in both modes with no new code.
- **Recovery Kit:** driven entirely by `kitMapping`. Because the credential
  pack's `kitMapping` includes the secret keys, the Kit includes them
  automatically in credential mode. No Recovery Kit code changes.

## Data flow on mode switch

```
hint → credential:
  base pack swaps to credential bundle
  shared-key values preserved as-is
  new secret fields render empty, ready to fill

credential → hint:
  base pack swaps to hint bundle
  shared-key values preserved as-is
  secret-only values have no field in hint pack → archived answers (retained, not deleted)
```

## Error handling

- Unknown/absent `formMode` in a snapshot → treated as `"hint"` (safe default).
- A malformed or missing credential pack resource → the same untrusted-input
  handling as the hint pack: validation failure surfaces, falls back to the
  static build-time copy; never a silent or partial load.
- Mode switch is a normal generation-counted CAS save; a `SnapshotConflict`
  surfaces through the existing conflict path and the switch is retried, never
  blind-overwritten.

## Testing

**Rust integration:**
- `formMode` round-trips through an encrypted snapshot save/load.
- Both bundled packs pass `validatePack`.
- DB file contains ciphertext only (no plaintext secret strings) — extends the
  existing no-plaintext assertions.

**Frontend (Vitest + RTL, `vaultApi` mocked):**
- Superset-invariant: every hint-pack `systemKey` exists in the credential pack;
  both packs share `schemaVersion`.
- `loadDefaultPack("hint")` and `loadDefaultPack("credential")` return the
  correct pack.
- Onboarding persists the chosen mode into the first snapshot.
- `handleSwitchMode` clears `customPack`, preserves shared-key values, and
  archives credential-only values when switching back to hint.
- Recovery Kit includes secret values in credential mode and excludes them in
  hint mode (driven by `kitMapping`).
- Existing vaults (no `formMode`) load as hint mode.

## Out of scope

- On-screen masking / reveal of secret fields.
- Per-Kit sensitive-value warning or toggle.
- Field-level (second-layer) encryption.
- Per-mode persistence of form-structure edits (switching clears `customPack`).
