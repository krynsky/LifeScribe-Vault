# File Attachment Field + In-Vault Viewing

**Date:** 2026-07-05
**Status:** Approved design, ready for implementation planning

## Problem

The vault can already encrypt and store attachments at the record level
(`add_attachment` → ciphertext on disk; `AttachmentRef {id, fileName, sizeBytes}`
in `SectionRecord.attachments`), but:

- There is **no way to view** an attached file — Rust has `decrypt_attachment`
  but no command exposes it to the frontend, and there is no viewer.
- There is **no `file` field type** — attachments are an ad-hoc per-record list,
  not a structured form field. `FieldType` is
  `text | textarea | date | select | email | phone`, and field values are
  string-only (`Record<string, string>`).

The owner wants a `file` field type (attach one file to a named field) and the
ability to view attached files inside the vault.

## Goal

- A **`file` field type**: one file per field (e.g. "Will (PDF)", "ID scan").
- **View a file inside the vault**: inline preview for common types (in memory,
  no plaintext on disk) **and** an explicit "open in the OS default app" for any
  type (temporary plaintext file, confirmation-gated, cleaned up).
- Authorable via the pack editor and the app, encrypted exactly as attachments
  are today.

## Data model (chosen approach)

**A `file` field's value is the attachment id** — a plain string, so the
`Record<string, string>` value model is unchanged. Metadata reuses the existing
per-record `attachments: AttachmentRef[]` array (already persisted, already
swept). The field looks up its ref by the id in `values[systemKey]`.

Rejected alternatives: extending the value model to hold `AttachmentRef` objects
(invasive — touches validation/merge/reconcile/migrate); a separate
field→attachment map in the snapshot (redundant with `record.attachments`).

- `FieldType` gains `"file"`. A `file` field carries no `options`.
- Empty value `""` = no file attached; otherwise the value is an attachment id
  that must have a matching entry in the same record's `attachments`.
- File type for preview is inferred from the `fileName` extension (no ref change;
  `AttachmentRef` may later gain an optional `mimeType`, out of scope here).

## Backend (Rust) — two new commands

Both reuse `attachments::decrypt_attachment` and the existing `attachment` AAD
domain, and require an unlocked session (return `VaultLocked` otherwise).

- **`read_attachment(attachmentId) -> Vec<u8>`** — decrypts the ciphertext
  **into memory** and returns the bytes over IPC. The frontend wraps them in a
  `Blob`/object URL for inline preview. Plaintext never touches disk. (Suited to
  reasonably sized documents/images/PDFs; very large files use external open.)
- **`open_attachment_external(attachmentId) -> ()`** — decrypts to a
  **temporary plaintext file** in the OS temp dir, launches it with the system
  default app (Tauri opener / `std::process`/`open`), and best-effort deletes the
  temp file afterward. This is the single plaintext-to-disk path; the frontend
  gates it behind an explicit confirmation dialog (satisfying "no plaintext
  export except explicit confirmation"). The temp file uses a random name and is
  scheduled for deletion; a residual file (if the OS app holds it open) is a
  known, accepted limitation of external open.

Register both in `lib.rs` `invoke_handler`. Add TS wrappers `readAttachment`
and `openAttachmentExternal` to `vaultApi.ts`.

## Field rendering (`FormRenderer`)

A `file` field renders a `FileField` control:

- **No file** → an "Attach file" button → OS picker → `add_attachment` →
  set `values[systemKey] = ref.id` and push the ref into the record's
  `attachments`.
- **File attached** → the filename + human size, and actions: **View** (inline
  viewer), **Open externally** (confirmation dialog → `open_attachment_external`),
  **Replace** (attach a new file, delete the old — see deletion policy), and
  **Remove** (clear the value, delete the file).

## Viewer

An in-app modal `AttachmentViewer`:

1. Calls `read_attachment(id)`, builds an object URL from the bytes with a MIME
   type guessed from the extension.
2. Renders by kind: **image** (`<img>`), **PDF** (`<iframe>`), **text/plain**
   (`<pre>`); anything else → "No inline preview for this file type" with an
   "Open externally" action.
3. Revokes the object URL on close/unmount. No plaintext is written to disk.

## Deletion policy (owner decision — delete the file when the field/value goes)

- **Remove / Replace (in-app action):** immediately `delete_attachment`, clear
  the field value, and drop the ref from `record.attachments`. Explicit user
  action — no archived answer.
- **Field removed from the pack (structural):** the file-field value is orphaned
  by `reconcileSectionValues`. Per the owner's decision the underlying file is
  **deleted**, reconciled with the "never silently drop field data" law as
  follows:
  - An **archived answer** is created recording the field's original label and
    the **fileName** (a human-readable note that a file was attached), so the
    audit trail is not silently dropped.
  - The attachment **ref is removed from `record.attachments`**, so the existing
    orphan sweep reclaims the ciphertext on the next load. Detection: an orphaned
    value whose string matches an id in `record.attachments` is a file-field
    orphan.
  - This is deterministic and idempotent (delete tolerates a missing file); the
    ref removal persists via the normal save path, and the sweep is eventually
    consistent if a save is deferred.

## Pack editor / authoring

`FieldType` gaining `"file"` automatically surfaces it in the pack editor's
add-field type menu and property-panel type select (both driven by
`FIELD_TYPES`) and in `validatePack`. `validatePack` accepts `type: "file"` and
requires a `file` field to carry no `options`. The `file` field type is inert
data — it introduces no scripts or expressions.

## Recovery Kit

A `file` field listed in a section's `kitMapping` renders its **fileName** (e.g.
"Will: will-2026.pdf — in vault"), not the raw attachment id. The Kit is text;
the file itself stays in the encrypted vault.

## Security / laws honored

- Attachments remain AEAD-encrypted, AAD-bound to the `attachment` domain;
  `read_attachment`/`open_attachment_external` decrypt with the same binding.
- **In-app preview is in-memory only** — no plaintext on disk.
- **External open is the only plaintext-to-disk path**, gated behind explicit
  confirmation and cleaned up — the sole sanctioned plaintext export.
- Keys never cross IPC or appear in errors; unchanged.
- Field definitions stay declarative data (`file` is a type, not a script).

## Error handling

- Locked session → commands return `VaultLocked`; the UI surfaces "unlock to
  view".
- A field value id with no matching `record.attachments` entry (corruption) →
  the control shows "attachment missing" rather than crashing.
- `read_attachment` on a missing/tampered ciphertext → surfaces a decrypt/not-
  found error in the viewer; nothing partial is rendered.
- Attach failure (picker cancelled / encrypt error) → the field stays empty; the
  error is surfaced non-destructively.

## Testing

**Rust integration (`src/tests/`, real SQLite + tempfile):**
- `read_attachment` round-trips: encrypt a file → read → bytes equal the source.
- Reading under a different vault identity fails AAD authentication.
- `open_attachment_external` writes a plaintext temp file whose bytes equal the
  source, then removes it (assert the temp path is gone after).
- Locked session → both commands return `VaultLocked`.

**Frontend (Vitest + RTL, `vaultApi` mocked):**
- A `file` field with no value renders "Attach file"; attaching sets
  `values[systemKey]` to the ref id and pushes the ref onto the record.
- A `file` field with a value renders filename + View/Open/Replace/Remove;
  Remove clears the value and calls `deleteAttachment`.
- `AttachmentViewer` selects preview kind by extension (image/pdf/text/other) and
  revokes the object URL on close.
- `validatePack` accepts `type: "file"` and rejects a `file` field that declares
  `options`.
- Reconcile: removing a `file` field's definition archives an answer carrying the
  fileName and drops the ref from `record.attachments` (so the sweep reclaims it).

## Out of scope

- Multiple files per field (single file per field only).
- Thumbnails/gallery, in-app editing/annotation of files.
- `mimeType` persisted on `AttachmentRef` (extension inference is used).
- Streaming very large files (in-app preview targets reasonable sizes; large
  files use external open).
