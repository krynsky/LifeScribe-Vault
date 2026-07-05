# File Attachment Field + In-Vault Viewing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `file` field type (one encrypted file per field) and let users view attached files inside the vault — inline preview (in-memory, no plaintext on disk) plus a confirmation-gated "open externally".

**Architecture:** Reuse the existing attachment plumbing (`encrypt/decrypt_attachment`, `AttachmentRef` on `SectionRecord.attachments`, orphan sweep). A `file` field's value is the attachment id (string). Two new Rust commands (`read_attachment`, `open_attachment_external`) reuse `decrypt_attachment` + the `attachment` AAD. `FormRenderer` renders a `FileField` that mutates both the field value and the record's `attachments`. Deleting a file field deletes the ciphertext while archiving the id (fileName in the reason).

**Tech Stack:** Rust + Tauri 2 (`decrypt_attachment`, the `open` crate), React 19 + TS, `@tauri-apps/plugin-dialog` picker, Vitest + RTL, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-07-05-file-attachment-field-design.md`

---

## Background the engineer needs

- Attachments already work: `add_attachment(sourcePath)` (OS picker → encrypt → `{id, fileName, sizeBytes}`), `delete_attachment(id)`, `sweep_orphaned_attachments(ids)`. `SectionRecord.attachments?: AttachmentRef[]` (`{id, fileName, sizeBytes}`) holds metadata; field values are `Record<string, string>`.
- Rust command pattern (see `add_attachment`/`delete_attachment` in `src-tauri/src/commands.rs`): `let session = lock_state(&session)?;`, `session.key.as_ref().ok_or_else(|| command_error_code(VaultError::Locked))?`, `session.vault_id.as_deref()`, `crate::attachments::attachment_dir(&session.vault_path)`, errors via `.map_err(command_error_code)`.
- `crate::attachments::decrypt_attachment(dir, attachment_id, key, vault_id) -> VaultResult<Vec<u8>>` already exists.
- Commands are registered in `src-tauri/src/lib.rs` `invoke_handler`. Rust integration tests live in `src-tauri/src/tests/` (a `attachment_tests.rs` module already exists; add to it).
- Frontend picker: `import { open as openFilePicker } from "@tauri-apps/plugin-dialog";` returns a path string (or null if cancelled), as used in `src/components/AttachmentList.tsx`.
- `FieldType` + `FIELD_TYPES` are in `src/domain/formModel.ts`. `validatePack` checks type membership against `FIELD_TYPES` and validates `select` options in `src/domain/packValidation.ts`.
- `FormRenderer` renders each field via `renderField(field, record, group)` (`src/forms/FormRenderer.tsx`), calling `updateRecordValue` → `onChange(upsertSectionRecord(values, {...record, values}))`.
- `reconcileSectionValues` (`src/domain/valuesStore.ts`) archives an orphaned value when its field was removed (the `if (!current)` branch), returning `{ ...record, values: keptValues }`.
- Run tests: `npm --prefix apps/desktop run test -- <substring>`; typecheck `npm --prefix apps/desktop run typecheck`; Rust `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.

## File structure

- `apps/desktop/src-tauri/src/commands.rs` — `read_attachment`, `open_attachment_external`. (Tasks 1–2)
- `apps/desktop/src-tauri/src/lib.rs` — register both commands. (Tasks 1–2)
- `apps/desktop/src-tauri/Cargo.toml` — add the `open` crate. (Task 2)
- `apps/desktop/src-tauri/src/attachment_tests.rs` — Rust tests. (Tasks 1–2)
- `apps/desktop/src/api/vaultApi.ts` — `readAttachment`, `openAttachmentExternal`. (Task 3)
- `apps/desktop/src/domain/formModel.ts` — `"file"` in `FIELD_TYPES`. (Task 4)
- `apps/desktop/src/domain/packValidation.ts` — reject `options` on a `file` field. (Task 4)
- `apps/desktop/src/components/AttachmentViewer.tsx` (+ test). (Task 5)
- `apps/desktop/src/forms/FileField.tsx` (+ test). (Task 6)
- `apps/desktop/src/forms/FormRenderer.tsx` — render `file` fields. (Task 7)
- `apps/desktop/src/domain/valuesStore.ts` — delete-on-field-removal. (Task 8)
- `apps/desktop/src/domain/recoveryKit.ts` — file fields show fileName. (Task 8)

---

## Task 1: Rust `read_attachment` command

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/src-tauri/src/attachment_tests.rs`

- [ ] **Step 1: Write the failing test**

Read `apps/desktop/src-tauri/src/attachment_tests.rs` to match its helpers for creating a vault/session and an attachment dir. Add a test that mirrors the existing `encrypt_and_decrypt_round_trip` test but through the command core. If `read_attachment`'s logic is a thin wrapper, test the underlying path the command uses. Add:

```rust
#[test]
fn read_attachment_returns_the_decrypted_bytes() {
    // Arrange: create a temp attachment dir, encrypt known bytes.
    // (Mirror the existing encrypt_and_decrypt_round_trip test's setup:
    //  build a Zeroizing key + vault_id, call encrypt_attachment_bytes with
    //  known plaintext, then read it back via decrypt_attachment — which is
    //  exactly what read_attachment calls.)
    let dir = tempfile::tempdir().unwrap();
    let key = test_key();
    let vault_id = "vault-abc";
    let meta = crate::attachments::encrypt_attachment_bytes(
        b"hello attachment",
        "note.txt",
        dir.path(),
        &key,
        vault_id,
    )
    .unwrap();

    let bytes = crate::attachments::decrypt_attachment(dir.path(), &meta.id, &key, vault_id).unwrap();
    assert_eq!(bytes, b"hello attachment");
}

#[test]
fn read_attachment_fails_under_a_different_vault_identity() {
    let dir = tempfile::tempdir().unwrap();
    let key = test_key();
    let meta = crate::attachments::encrypt_attachment_bytes(
        b"secret", "s.txt", dir.path(), &key, "vault-one",
    )
    .unwrap();
    // Same key, different vault_id → AAD mismatch → decrypt fails.
    let result = crate::attachments::decrypt_attachment(dir.path(), &meta.id, &key, "vault-two");
    assert!(result.is_err());
}
```

Use the same `test_key()` helper the existing attachment tests use (check the file; if it's a local helper, reuse it; if the existing tests build the key inline, build it the same way).

- [ ] **Step 2: Run to verify it fails or check it compiles**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml read_attachment`
Expected: the two tests compile against existing functions and PASS (they exercise `decrypt_attachment`, which exists). If a helper name differs, fix the test to match the file. This locks in the behavior the command wraps.

- [ ] **Step 3: Implement the command**

In `apps/desktop/src-tauri/src/commands.rs`, after `delete_attachment`, add:

```rust
/// Decrypt an attachment INTO MEMORY and return its plaintext bytes for the
/// in-app viewer. Plaintext never touches disk. Requires an unlocked session.
#[tauri::command]
pub fn read_attachment(
    attachment_id: String,
    session: State<'_, SharedVaultSession>,
) -> Result<Vec<u8>, String> {
    let session = lock_state(&session)?;
    let key = session.key.as_ref().ok_or_else(|| command_error_code(VaultError::Locked))?;
    let vault_id = session
        .vault_id
        .as_deref()
        .ok_or_else(|| command_error_code(VaultError::Locked))?;
    let att_dir = crate::attachments::attachment_dir(&session.vault_path);
    crate::attachments::decrypt_attachment(&att_dir, &attachment_id, key, vault_id)
        .map_err(command_error_code)
}
```

In `apps/desktop/src-tauri/src/lib.rs`, add `commands::read_attachment,` to the `invoke_handler` list (next to `delete_attachment`).

- [ ] **Step 4: Run the tests + a full build**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: all pass (the new tests + existing 74+).

- [ ] **Step 5: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/attachment_tests.rs
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(attachments): read_attachment command for in-app viewing"
```

---

## Task 2: Rust `open_attachment_external` command

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/src-tauri/src/attachment_tests.rs`

- [ ] **Step 1: Add the `open` crate**

In `apps/desktop/src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
open = "5"
```

(The `open` crate launches the OS default handler cross-platform from Rust — no frontend shell scope needed, consistent with the dialog-only capability.)

- [ ] **Step 2: Write the failing test**

Add to `apps/desktop/src-tauri/src/attachment_tests.rs` a test for the pure decrypt-to-temp helper you'll extract (do NOT actually launch an app in a test). Add:

```rust
#[test]
fn decrypt_to_temp_writes_plaintext_and_path_is_removable() {
    use std::fs;
    let dir = tempfile::tempdir().unwrap();
    let key = test_key();
    let vault_id = "vault-x";
    let meta = crate::attachments::encrypt_attachment_bytes(
        b"external bytes", "doc.pdf", dir.path(), &key, vault_id,
    )
    .unwrap();

    let temp_path =
        crate::attachments::decrypt_to_temp(dir.path(), &meta.id, &meta.file_name, &key, vault_id)
            .unwrap();

    assert_eq!(fs::read(&temp_path).unwrap(), b"external bytes");
    assert!(temp_path.file_name().unwrap().to_str().unwrap().ends_with("doc.pdf"));
    fs::remove_file(&temp_path).unwrap(); // caller can clean it up
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml decrypt_to_temp`
Expected: FAIL — `decrypt_to_temp` does not exist.

- [ ] **Step 4: Implement the helper + command**

In `apps/desktop/src-tauri/src/attachments.rs`, add:

```rust
/// Decrypt an attachment to a fresh plaintext file inside a random temp
/// subdirectory, preserving the original file name (so the OS default app sees
/// the right extension). Returns the temp file path for the caller to open and
/// later clean up. This is the ONLY sanctioned plaintext-to-disk path and MUST
/// be gated behind explicit user confirmation at the UI layer.
pub fn decrypt_to_temp(
    dir: &Path,
    attachment_id: &str,
    file_name: &str,
    key: &Zeroizing<[u8; KEY_LEN]>,
    vault_id: &str,
) -> VaultResult<PathBuf> {
    let plaintext = decrypt_attachment(dir, attachment_id, key, vault_id)?;
    let sub = std::env::temp_dir().join(format!("lifescribe-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&sub).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    let safe_name = Path::new(file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("attachment");
    let path = sub.join(safe_name);
    fs::write(&path, &plaintext).map_err(|e| VaultError::FileOperation(e.to_string()))?;
    Ok(path)
}
```

(Ensure `use std::path::PathBuf;` is present in `attachments.rs`.)

In `apps/desktop/src-tauri/src/commands.rs`, after `read_attachment`, add:

```rust
/// Decrypt an attachment to a temporary plaintext file and open it in the OS
/// default application. WARNING: this writes decrypted plaintext to disk — the
/// UI MUST confirm with the user before calling it. Best-effort cleanup removes
/// the temp file after launching; a file still held open by the external app is
/// an accepted limitation.
#[tauri::command]
pub fn open_attachment_external(
    attachment_id: String,
    file_name: String,
    session: State<'_, SharedVaultSession>,
) -> Result<(), String> {
    let session = lock_state(&session)?;
    let key = session.key.as_ref().ok_or_else(|| command_error_code(VaultError::Locked))?;
    let vault_id = session
        .vault_id
        .as_deref()
        .ok_or_else(|| command_error_code(VaultError::Locked))?;
    let att_dir = crate::attachments::attachment_dir(&session.vault_path);
    let path = crate::attachments::decrypt_to_temp(&att_dir, &attachment_id, &file_name, key, vault_id)
        .map_err(command_error_code)?;
    open::that(&path).map_err(|e| command_error_code(VaultError::FileOperation(e.to_string())))?;
    // Best-effort cleanup: the OS app has typically read the file by now.
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_dir(path.parent().unwrap_or(&att_dir));
    Ok(())
}
```

Register `commands::open_attachment_external,` in `lib.rs` `invoke_handler`.

- [ ] **Step 5: Run tests + build**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: all pass. If `open = "5"` needs a network fetch, `cargo` will download it on first build.

- [ ] **Step 6: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/src/attachments.rs apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/attachment_tests.rs
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(attachments): open_attachment_external (confirm-gated plaintext temp)"
```

---

## Task 3: TS API wrappers

**Files:**
- Modify: `apps/desktop/src/api/vaultApi.ts`

- [ ] **Step 1: Add the wrappers**

In `apps/desktop/src/api/vaultApi.ts`, after `deleteAttachment`, add:

```ts
/** Decrypt an attachment into memory and return its bytes for inline preview. */
export function readAttachment(attachmentId: string): Promise<Uint8Array> {
  return invoke<number[]>("read_attachment", { attachmentId }).then(
    (bytes) => new Uint8Array(bytes),
  );
}

/**
 * Decrypt an attachment to a temporary plaintext file and open it in the OS
 * default app. The caller MUST confirm with the user first — this writes
 * decrypted plaintext to disk.
 */
export function openAttachmentExternal(
  attachmentId: string,
  fileName: string,
): Promise<void> {
  return invoke("open_attachment_external", { attachmentId, fileName });
}
```

(Tauri serializes `Vec<u8>` as a JSON number array; `new Uint8Array(bytes)` reconstructs it.)

- [ ] **Step 2: Typecheck**

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/src/api/vaultApi.ts
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(api): readAttachment + openAttachmentExternal wrappers"
```

---

## Task 4: `file` field type + validation

**Files:**
- Modify: `apps/desktop/src/domain/formModel.ts`
- Modify: `apps/desktop/src/domain/packValidation.ts`
- Test: `apps/desktop/src/domain/packValidation.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `apps/desktop/src/domain/packValidation.test.ts` (match the file's existing helpers for building a candidate pack/field; mirror an existing type-validation test):

```ts
it("accepts a file field type", () => {
  const pack = packWithField({ systemKey: "willPdf", label: "Will", type: "file", required: false, protected: false, order: 1 });
  expect(validatePack(pack).ok).toBe(true);
});

it("rejects options on a file field", () => {
  const pack = packWithField({
    systemKey: "willPdf", label: "Will", type: "file", required: false, protected: false, order: 1,
    options: [{ value: "a", label: "A" }],
  });
  const result = validatePack(pack);
  expect(result.ok).toBe(false);
  expect(result.errors.join(" ")).toMatch(/file field .* must not declare options/i);
});
```

(If the file has no `packWithField` helper, construct a minimal valid pack inline the way the existing tests do, placing the field in a group.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix apps/desktop run test -- packValidation`
Expected: FAIL — `"file"` is an unsupported type / options not rejected.

- [ ] **Step 3: Implement**

In `apps/desktop/src/domain/formModel.ts`, add `"file"` to `FIELD_TYPES`:

```ts
export const FIELD_TYPES = ["text", "textarea", "date", "select", "email", "phone", "file"] as const;
```

In `apps/desktop/src/domain/packValidation.ts`, find the field validation (near the `select` options check around line 148). After the existing checks, add a rule that a `file` field must not declare options:

```ts
  if (candidate.type === "file" && candidate.options !== undefined) {
    errors.push(
      `Section ${sectionKey}: file field ${label} must not declare options.`,
    );
  }
```

(Place it alongside the existing type/options validation so it reads with the other per-field rules.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npm --prefix apps/desktop run test -- packValidation`
Expected: PASS.

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors. (Adding `"file"` to `FIELD_TYPES` may surface exhaustive `switch`/`if` sites on `FieldType` — search `grep -rn "field.type ===" apps/desktop/src`. The `FieldControl` in `FormRenderer` falls through to an `<input type={...}>`; a `file` field will be given a dedicated branch in Task 7, so for now the fallthrough renders an `<input type="file">`-like control that Task 7 replaces. Confirm typecheck passes; no code should break.)

- [ ] **Step 5: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/src/domain/formModel.ts apps/desktop/src/domain/packValidation.ts apps/desktop/src/domain/packValidation.test.ts
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(forms): add file field type with validation"
```

---

## Task 5: `AttachmentViewer` component

**Files:**
- Create: `apps/desktop/src/components/AttachmentViewer.tsx`
- Test: `apps/desktop/src/components/AttachmentViewer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/components/AttachmentViewer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vaultApi from "../api/vaultApi";
import { AttachmentViewer } from "./AttachmentViewer";

vi.mock("../api/vaultApi", () => ({ readAttachment: vi.fn() }));
const mocked = vi.mocked(vaultApi);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.readAttachment.mockResolvedValue(new Uint8Array([1, 2, 3]));
  // jsdom lacks these; stub for object-URL lifecycle.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("AttachmentViewer", () => {
  it("renders an image for image file names", async () => {
    render(<AttachmentViewer attachmentId="a1" fileName="photo.png" onClose={vi.fn()} />);
    expect(await screen.findByRole("img", { name: /photo\.png/i })).toBeInTheDocument();
    expect(mocked.readAttachment).toHaveBeenCalledWith("a1");
  });

  it("shows a no-preview message for unknown types", async () => {
    render(<AttachmentViewer attachmentId="a2" fileName="archive.zip" onClose={vi.fn()} />);
    expect(await screen.findByText(/no inline preview/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/desktop run test -- AttachmentViewer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/components/AttachmentViewer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { readAttachment } from "../api/vaultApi";

export interface AttachmentViewerProps {
  attachmentId: string;
  fileName: string;
  onClose: () => void;
}

type Kind = "image" | "pdf" | "text" | "other";

function kindFor(fileName: string): Kind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["txt", "md", "csv", "log", "json"].includes(ext)) return "text";
  return "other";
}

function mimeFor(kind: Kind, fileName: string): string {
  if (kind === "image") {
    const ext = fileName.toLowerCase().split(".").pop() ?? "";
    return ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
  }
  if (kind === "pdf") return "application/pdf";
  return "text/plain";
}

export function AttachmentViewer({ attachmentId, fileName, onClose }: AttachmentViewerProps) {
  const kind = kindFor(fileName);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let objectUrl: string | null = null;
    let current = true;
    readAttachment(attachmentId)
      .then((bytes) => {
        if (!current) return;
        if (kind === "text") {
          setText(new TextDecoder().decode(bytes));
          return;
        }
        if (kind === "other") return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeFor(kind, fileName) }));
        setUrl(objectUrl);
      })
      .catch((e: unknown) => {
        if (current) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId, fileName, kind]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`View ${fileName}`}>
      <div className="modal__body attachment-viewer">
        <div className="attachment-viewer__header">
          <span>{fileName}</span>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : kind === "image" && url ? (
          <img className="attachment-viewer__image" src={url} alt={fileName} />
        ) : kind === "pdf" && url ? (
          <iframe className="attachment-viewer__frame" title={fileName} src={url} />
        ) : kind === "text" && text !== null ? (
          <pre className="attachment-viewer__text">{text}</pre>
        ) : kind === "other" ? (
          <p className="attachment-viewer__none">
            No inline preview for this file type — use “Open externally”.
          </p>
        ) : (
          <p className="attachment-viewer__loading">Decrypting…</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npm --prefix apps/desktop run test -- AttachmentViewer`
Expected: PASS (2).

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/src/components/AttachmentViewer.tsx apps/desktop/src/components/AttachmentViewer.test.tsx
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(attachments): in-app AttachmentViewer (in-memory preview)"
```

---

## Task 6: `FileField` control

**Files:**
- Create: `apps/desktop/src/forms/FileField.tsx`
- Test: `apps/desktop/src/forms/FileField.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/forms/FileField.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vaultApi from "../api/vaultApi";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { FileField } from "./FileField";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/vaultApi", () => ({
  addAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  readAttachment: vi.fn(),
  openAttachmentExternal: vi.fn(),
}));
const mocked = vi.mocked(vaultApi);
const mockedPicker = vi.mocked(openFilePicker);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FileField", () => {
  it("attaches a picked file", async () => {
    mockedPicker.mockResolvedValue("/tmp/will.pdf");
    mocked.addAttachment.mockResolvedValue({ id: "att1", fileName: "will.pdf", sizeBytes: 10 });
    const onAttach = vi.fn();
    render(<FileField fieldId="f1" attachment={null} onAttach={onAttach} onRemove={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /attach file/i }));

    expect(mocked.addAttachment).toHaveBeenCalledWith("/tmp/will.pdf");
    expect(onAttach).toHaveBeenCalledWith({ id: "att1", fileName: "will.pdf", sizeBytes: 10 });
  });

  it("removes an attached file (deletes ciphertext + clears)", async () => {
    mocked.deleteAttachment.mockResolvedValue(undefined);
    const onRemove = vi.fn();
    render(
      <FileField
        fieldId="f1"
        attachment={{ id: "att1", fileName: "will.pdf", sizeBytes: 10 }}
        onAttach={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("will.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(mocked.deleteAttachment).toHaveBeenCalledWith("att1");
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows the viewer when View is clicked", async () => {
    mocked.readAttachment.mockResolvedValue(new Uint8Array([1]));
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
    globalThis.URL.revokeObjectURL = vi.fn();
    render(
      <FileField
        fieldId="f1"
        attachment={{ id: "att1", fileName: "photo.png", sizeBytes: 10 }}
        onAttach={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /view/i }));
    expect(await screen.findByRole("dialog", { name: /view photo\.png/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/desktop run test -- FileField`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/forms/FileField.tsx`:

```tsx
import { useState } from "react";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { AttachmentViewer } from "../components/AttachmentViewer";
import {
  addAttachment,
  deleteAttachment,
  openAttachmentExternal,
} from "../api/vaultApi";
import type { AttachmentRef } from "../domain/valuesStore";

export interface FileFieldProps {
  fieldId: string;
  attachment: AttachmentRef | null;
  /** Called with the new ref after a file is attached (replaces any current). */
  onAttach: (ref: AttachmentRef) => void;
  /** Called after the current file is removed (value cleared, ref pulled). */
  onRemove: () => void;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileField({ fieldId, attachment, onAttach, onRemove }: FileFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(false);
  const [confirmExternal, setConfirmExternal] = useState(false);

  async function pickAndAttach(previousId?: string) {
    setError("");
    const picked = await openFilePicker({ multiple: false, directory: false });
    if (typeof picked !== "string") return; // cancelled
    setBusy(true);
    try {
      const ref = await addAttachment(picked);
      if (previousId) await deleteAttachment(previousId);
      onAttach(ref);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!attachment) return;
    setBusy(true);
    setError("");
    try {
      await deleteAttachment(attachment.id);
      onRemove();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!attachment) {
    return (
      <div className="file-field" id={fieldId}>
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={busy}
          onClick={() => void pickAndAttach()}
        >
          Attach file
        </button>
        {error ? <span className="form-error" role="alert">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="file-field" id={fieldId}>
      <div className="file-field__meta">
        <span className="file-field__name">{attachment.fileName}</span>
        <span className="file-field__size">{humanSize(attachment.sizeBytes)}</span>
      </div>
      <div className="file-field__actions">
        <button type="button" className="button button--ghost button--small" onClick={() => setViewing(true)}>
          View
        </button>
        <button type="button" className="button button--ghost button--small" onClick={() => setConfirmExternal(true)}>
          Open externally
        </button>
        <button type="button" className="button button--ghost button--small" disabled={busy} onClick={() => void pickAndAttach(attachment.id)}>
          Replace
        </button>
        <button type="button" className="button button--ghost button--small" disabled={busy} onClick={() => void remove()}>
          Remove
        </button>
      </div>
      {error ? <span className="form-error" role="alert">{error}</span> : null}

      {viewing ? (
        <AttachmentViewer
          attachmentId={attachment.id}
          fileName={attachment.fileName}
          onClose={() => setViewing(false)}
        />
      ) : null}

      {confirmExternal ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm open externally">
          <div className="modal__body">
            <p>
              Opening externally decrypts this file to a temporary location on
              disk and launches your default app. The temp copy is deleted
              afterward. Continue?
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  setConfirmExternal(false);
                  void openAttachmentExternal(attachment.id, attachment.fileName).catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  );
                }}
              >
                Open externally
              </button>
              <button type="button" className="button button--ghost" onClick={() => setConfirmExternal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npm --prefix apps/desktop run test -- FileField`
Expected: PASS (3).

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/src/forms/FileField.tsx apps/desktop/src/forms/FileField.test.tsx
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(forms): FileField control (attach/view/open/replace/remove)"
```

---

## Task 7: Render `file` fields in `FormRenderer`

**Files:**
- Modify: `apps/desktop/src/forms/FormRenderer.tsx`
- Test: `apps/desktop/src/forms/FormRenderer.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/forms/FormRenderer.test.tsx` (mirror the file's existing render setup — a resolved section with one group; add a `file` field). Assert the FileField renders and attaching updates values + attachments:

```tsx
it("renders a file field and attaching updates values + record attachments", async () => {
  // Build a resolved section with a single `file` field (reuse this file's
  // existing section/resolve helpers; the field: { systemKey: "willPdf",
  // label: "Will", type: "file", required: false, protected: false, order: 1 }).
  // Mock @tauri-apps/plugin-dialog `open` -> "/tmp/will.pdf" and vaultApi
  // `addAttachment` -> { id: "att1", fileName: "will.pdf", sizeBytes: 10 }.
  // Render FormRenderer with an onChange spy and empty values.
  // Click "Attach file"; assert onChange was called with a SectionValues whose
  // bound record has values.willPdf === "att1" and attachments containing the ref.
});
```

Write this test concretely using the exact helpers already in `FormRenderer.test.tsx` (read the file first — it has a section fixture and a render helper). Mock `@tauri-apps/plugin-dialog` and `../api/vaultApi` as in Task 6. The key assertion: after clicking "Attach file", the `onChange` spy receives a `SectionValues` where the bound record has `values["willPdf"] === "att1"` and `attachments` contains `{ id: "att1", fileName: "will.pdf", sizeBytes: 10 }`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/desktop run test -- FormRenderer`
Expected: FAIL — no FileField rendered for `type: "file"` (the fallthrough `<input>` renders instead).

- [ ] **Step 3: Implement**

In `apps/desktop/src/forms/FormRenderer.tsx`:

1. Add imports:

```tsx
import { FileField } from "./FileField";
import type { AttachmentRef } from "../domain/valuesStore";
```

2. Add two record helpers next to `updateRecordValue` (they mutate BOTH the value and `record.attachments`):

```tsx
  const attachFileToRecord = (record: SectionRecord, systemKey: string, ref: AttachmentRef) => {
    const previousId = record.values[systemKey];
    const withoutOld = (record.attachments ?? []).filter((a) => a.id !== previousId);
    onChange(
      upsertSectionRecord(values, {
        ...record,
        values: { ...record.values, [systemKey]: ref.id },
        attachments: [...withoutOld, ref],
      }),
    );
  };

  const removeFileFromRecord = (record: SectionRecord, systemKey: string) => {
    const id = record.values[systemKey];
    onChange(
      upsertSectionRecord(values, {
        ...record,
        values: { ...record.values, [systemKey]: "" },
        attachments: (record.attachments ?? []).filter((a) => a.id !== id),
      }),
    );
  };
```

3. In `renderField`, before the `<Field>`/`<FieldControl>` return, add a `file` branch that renders `<FileField>` inside the same `<Field>` wrapper (keeping the inline-editor affordance):

```tsx
    if (field.type === "file") {
      const attachmentId = storedValue;
      const ref: AttachmentRef | null =
        record.attachments?.find((a) => a.id === attachmentId) ?? null;
      return (
        <Field key={field.systemKey} fieldId={fieldId} label={field.label} helperText={field.helperText} error={error}>
          <FileField
            fieldId={fieldId}
            attachment={ref}
            onAttach={(newRef) => attachFileToRecord(record, field.systemKey, newRef)}
            onRemove={() => removeFileFromRecord(record, field.systemKey)}
          />
          {editing && rawFieldDef ? (
            <InlineFieldEditor
              field={rawFieldDef}
              onChange={(updated) => onEditField?.(section.sectionKey, group.groupKey, updated)}
              onRemove={() => onRemoveField?.(section.sectionKey, group.groupKey, field.systemKey)}
              onMoveUp={() => onMoveField?.(section.sectionKey, group.groupKey, field.systemKey, "up")}
              onMoveDown={() => onMoveField?.(section.sectionKey, group.groupKey, field.systemKey, "down")}
            />
          ) : null}
        </Field>
      );
    }
```

(Place this at the top of `renderField`'s return path, before the existing `<Field>` return.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npm --prefix apps/desktop run test -- FormRenderer`
Expected: PASS (existing tests + the new one).

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/src/forms/FormRenderer.tsx apps/desktop/src/forms/FormRenderer.test.tsx
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(forms): render file fields with FileField + attachment plumbing"
```

---

## Task 8: Delete file on field removal + Recovery Kit fileName

**Files:**
- Modify: `apps/desktop/src/domain/valuesStore.ts`
- Test: `apps/desktop/src/domain/valuesStore.test.ts`
- Modify: `apps/desktop/src/domain/recoveryKit.ts`
- Test: `apps/desktop/src/domain/recoveryKit.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/desktop/src/domain/valuesStore.test.ts` (mirror the file's `reconcileSectionValues` tests):

```ts
it("deletes the attached file (drops the ref) and archives the id when a file field is removed", () => {
  // A record has a file field value (an attachment id) and a matching ref in
  // attachments; reconcile against a section WITHOUT that field.
  const sectionValues = {
    sectionKey: "docs",
    records: [
      {
        id: "r1",
        schemaVersion: 1,
        values: { willPdf: "att1" },
        attachments: [{ id: "att1", fileName: "will.pdf", sizeBytes: 10 }],
      },
    ],
    archivedAnswers: [],
  };
  // resolvedSection with NO willPdf field (reuse the file's helper to build a
  // ResolvedSection with an empty/other field set).
  const result = reconcileSectionValues(sectionValues, resolvedSectionWithoutWillPdf);
  const reconciled = result.sectionValues.records[0];
  // ref removed so the sweep reclaims the ciphertext:
  expect(reconciled.attachments).toEqual([]);
  // id preserved as the archived value; fileName in the reason:
  const archived = result.newlyArchived.find((a) => a.systemKey === "willPdf")!;
  expect(archived.value).toBe("att1");
  expect(archived.reason).toMatch(/will\.pdf/);
});
```

Add to `apps/desktop/src/domain/recoveryKit.test.ts` (mirror its build-kit setup): a section whose `kitMapping` includes a `file` field, with a record value = attachment id + a matching ref; assert the built kit lists the **fileName**, not the id.

```ts
it("shows the fileName for a file field in the Recovery Kit", () => {
  // Build resolved sections with a file field in kitMapping, values.willPdf = "att1",
  // record.attachments = [{ id: "att1", fileName: "will.pdf", sizeBytes: 10 }].
  const kit = buildRecoveryKit(resolvedSections, values /*, ownerName if required */);
  const strings = allKitStrings(kit); // reuse the file's helper
  expect(strings.some((s) => s.includes("will.pdf"))).toBe(true);
  expect(strings.some((s) => s === "att1")).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix apps/desktop run test -- valuesStore recoveryKit`
Expected: FAIL — reconcile doesn't drop the ref / kit shows the id.

- [ ] **Step 3: Implement the reconcile change**

In `apps/desktop/src/domain/valuesStore.ts`, in `reconcileSectionValues`, the field-orphan branch currently is (around line 302):

```ts
      const current = fieldIndex.get(systemKey);
      if (!current) {
        if (value.length > 0) {
          archiveValue(record, systemKey, value, "This field was removed from the form definition.");
        }
        changed = true;
        continue;
      }
```

Replace it with a version that detects a file-field orphan (value matches an attachment id on the record), archives the id with the fileName in the reason, and records the id to drop from `attachments`:

```ts
      const current = fieldIndex.get(systemKey);
      if (!current) {
        if (value.length > 0) {
          const droppedRef = record.attachments?.find((a) => a.id === value);
          if (droppedRef) {
            archiveValue(
              record,
              systemKey,
              value,
              `This file field was removed; the attached file "${droppedRef.fileName}" was deleted from the vault.`,
            );
            droppedAttachmentIds.add(value);
          } else {
            archiveValue(record, systemKey, value, "This field was removed from the form definition.");
          }
        }
        changed = true;
        continue;
      }
```

Declare `droppedAttachmentIds` per record inside the `.map((record) => { ... })` callback (before the `for` loop over `record.values`):

```ts
    const droppedAttachmentIds = new Set<string>();
```

And where the callback returns the reconciled record, also filter `attachments`:

```ts
    if (!changed && droppedAttachmentIds.size === 0) return record;
    const nextAttachments = record.attachments?.filter((a) => !droppedAttachmentIds.has(a.id));
    return {
      ...record,
      values: keptValues,
      ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
    };
```

(Adjust to the file's exact return shape — currently `return changed ? { ...record, values: keptValues } : record;`. The new version must also apply when only attachments changed.)

Note: the orphan sweep runs off the reconciled `record.attachments` (via `collectAttachmentIds` in `Dashboard`), so dropping the ref causes the file to be swept on the next load.

- [ ] **Step 4: Implement the Recovery Kit change**

In `apps/desktop/src/domain/recoveryKit.ts`, find where a field's value is turned into a kit line. For a `file`-type field, render the fileName looked up from the record's `attachments` by the value id (fall back to the id if not found). Read the file to place this in the existing value-formatting path; the change is: when the resolved field's `type === "file"`, resolve the display string via `record.attachments?.find((a) => a.id === value)?.fileName ?? value`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm --prefix apps/desktop run test -- valuesStore recoveryKit`
Expected: PASS.

Run: `npm --prefix apps/desktop run test`
Expected: full suite passes (including the "no value is ever discarded" property test — the archived id preserves it).

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/src/domain/valuesStore.ts apps/desktop/src/domain/valuesStore.test.ts apps/desktop/src/domain/recoveryKit.ts apps/desktop/src/domain/recoveryKit.test.ts
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(attachments): delete file on field removal; Recovery Kit shows fileName"
```

---

## Final verification

- [ ] Full frontend suite: `npm --prefix apps/desktop run test` → all pass
- [ ] Frontend typecheck: `npm --prefix apps/desktop run typecheck` → clean
- [ ] Lint: `npm --prefix apps/desktop run lint` → no new findings
- [ ] Rust: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` → all pass
- [ ] The pack editor now offers `file` in its add-field menu and type select (driven by `FIELD_TYPES`) — open `npm run pack-editor`, confirm `file` appears.
- [ ] **Manual smoke (`npm run dev`):** add a `file` field to a section (via the pack editor or a test pack) → attach a file → it shows filename + size → **View** renders an inline preview (image/PDF/text) with no plaintext written to disk → **Open externally** prompts, then launches the OS app → **Replace** swaps the file (old ciphertext deleted) → **Remove** clears it (ciphertext deleted). Generate the Recovery Kit → the file field shows its filename.

## Notes on laws honored

- **In-app preview is in-memory only** (`read_attachment` → bytes → `Blob`/object URL, revoked on close). No plaintext on disk.
- **External open is the one sanctioned plaintext-to-disk path**, gated behind explicit confirmation and best-effort cleaned up.
- **Encryption/AAD unchanged:** both new commands decrypt with the existing `attachment` AAD binding; wrong-vault reads fail authentication.
- **No field data silently dropped:** deleting a file field archives the attachment id (fileName in the reason) while the ciphertext is reclaimed by the existing sweep.
- **Form definitions stay data:** `file` is an inert field type — no scripts or expressions.
