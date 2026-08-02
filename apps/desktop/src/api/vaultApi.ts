// Typed wrappers around the Tauri IPC commands (the only bridge to Rust).
//
// Conventions (carried from v1):
// - Field names are camelCase on the wire; Rust structs use
//   `#[serde(rename_all = "camelCase")]`.
// - Errors reject with a stable string error code from Rust's
//   `command_error_code` ("InvalidMasterPassword", "VaultAlreadyExists",
//   "VaultNotInitialized", "NotFound", "VaultLocked", "InvalidRecordId",
//   "SnapshotConflict", "InvalidNewMasterPassword", "CorruptVault", "StorageError").
// - The snapshot is opaque JSON to Rust: whatever object is saved is
//   returned byte-identically by load. The richer snapshot type lives in
//   the domain layer; this module deliberately stays untyped about it.

import { invoke } from "@tauri-apps/api/core";

/** Opaque vault snapshot: Rust stores and returns it without interpretation. */
export type VaultSnapshot = Record<string, unknown>;

export interface VaultStatusResponse {
  unlocked: boolean;
  vaultExists: boolean;
  /** Directory holding the vault's data files. */
  vaultDir: string;
  /**
   * False when that directory cannot be reached (unplugged drive, deleted or
   * renamed folder). Distinguishes "unreachable" from "present but empty" —
   * the app must not send a user with an intact vault to first-run setup.
   */
  vaultDirAvailable: boolean;
}

export interface SaveSnapshotResponse {
  generation: number;
}

export interface LoadSnapshotResponse {
  snapshot: VaultSnapshot;
  generation: number;
  /**
   * True when the newest snapshot generation failed to decrypt and an older
   * retained generation was recovered instead — surface a "recovered from a
   * previous save" notice. The next save supersedes the corrupt generation.
   */
  recovered: boolean;
}

export function getVaultStatus(): Promise<VaultStatusResponse> {
  return invoke("get_vault_status");
}

export function createVault(
  masterPassword: string,
  ownerName: string,
): Promise<VaultStatusResponse> {
  return invoke("create_vault", { request: { masterPassword, ownerName } });
}

export function unlockVault(
  masterPassword: string,
): Promise<VaultStatusResponse> {
  return invoke("unlock_vault", { request: { masterPassword } });
}

export function lockVault(): Promise<VaultStatusResponse> {
  return invoke("lock_vault");
}

/** Rewrap the vault's data key under a new master password. */
export function changeVaultPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return invoke("change_vault_password", {
    request: { currentPassword, newPassword },
  });
}

/**
 * Compare-and-swap save: `baseGeneration` is the generation this session
 * loaded (or last saved). Rejects with "SnapshotConflict" when the stored
 * vault has advanced past it — reload and reconcile before retrying.
 */
export function saveVaultSnapshot(
  snapshot: VaultSnapshot,
  baseGeneration: number,
): Promise<SaveSnapshotResponse> {
  return invoke("save_vault_snapshot", { snapshot, baseGeneration });
}

export function loadVaultSnapshot(): Promise<LoadSnapshotResponse> {
  return invoke("load_vault_snapshot");
}

// ---------------------------------------------------------------------------
// Draft stash (U5 lock flow). The draft is opaque JSON to Rust, encrypted
// with the session data key (AAD domain "draft" + loaded generation).
// ---------------------------------------------------------------------------

/** Opaque draft payload: Rust encrypts and returns it without interpretation. */
export type DraftPayload = Record<string, unknown>;

export interface TakeDraftResponse {
  draft: DraftPayload | null;
  /** A stash file exists but could not be read or decrypted. */
  corrupt: boolean;
  /** Draft was stashed against a different snapshot generation. */
  staleGeneration: boolean;
  /** When the draft was stashed (plaintext metadata). */
  stashedAt: string | null;
}

/**
 * Encrypt-and-stash a dirty draft. MUST complete before `lockVault` —
 * locking zeroizes the data key the stash is encrypted with.
 */
export function stashDraft(draft: DraftPayload): Promise<void> {
  return invoke("stash_draft", { draft });
}

/** Decrypt and consume the stashed draft (corrupt stashes are retained). */
export function takeDraft(): Promise<TakeDraftResponse> {
  return invoke("take_draft");
}

/** Delete any stashed draft (explicit discard or post-save purge). */
export function discardDraft(): Promise<void> {
  return invoke("discard_draft");
}

/**
 * Clipboard-hygiene copy for vault values: Windows exclusion formats
 * (no Win+V history, no cloud clipboard, no monitor processing) plus
 * auto-clear after `clearAfterSeconds` (default 45) if the clipboard still
 * holds the value. `navigator.clipboard.writeText` is banned for vault
 * values — it cannot set the exclusion formats.
 */
/**
 * Read the bundled base form-definition pack as a raw JSON string (the
 * frontend has no fs scope). UNTRUSTED INPUT — run through validatePack first.
 */
export function readDefaultPack(): Promise<string> {
  return invoke("read_default_pack");
}

export function copyVaultValue(
  value: string,
  clearAfterSeconds?: number,
): Promise<void> {
  return invoke("copy_vault_value", { request: { value, clearAfterSeconds } });
}

// ---------------------------------------------------------------------------
// Attachments (U8)
// ---------------------------------------------------------------------------

export interface AttachmentRefResponse {
  id: string;
  fileName: string;
  sizeBytes: number;
}

/**
 * Encrypt an attachment from a user-chosen path (from OS file picker) and
 * return the metadata to embed in the snapshot record. Must be called BEFORE
 * the snapshot save that references the attachment.
 */
export function addAttachment(sourcePath: string): Promise<AttachmentRefResponse> {
  return invoke("add_attachment", { request: { sourcePath } });
}

/** Delete the ciphertext file for an attachment id. */
export function deleteAttachment(attachmentId: string): Promise<void> {
  return invoke("delete_attachment", { attachmentId });
}

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

/**
 * Sweep orphaned attachment files not in `referencedIds`. Call once after
 * unlock + snapshot load. Returns number of files swept.
 */
export function sweepOrphanedAttachments(referencedIds: string[]): Promise<number> {
  return invoke("sweep_orphaned_attachments", { referencedIds });
}

// ---------------------------------------------------------------------------
// Backup (U9)
// ---------------------------------------------------------------------------

export interface CreateBackupResponse {
  outputPath: string;
}

export interface RestoreBackupResponse {
  safetyBackupPath: string;
}

/**
 * Create an encrypted backup at `destDir`. The backup is self-contained —
 * it can be restored with only the master password in effect at backup time.
 * Returns the path to the written .lsvbackup file.
 */
export function createBackup(
  masterPassword: string,
  destDir: string,
): Promise<CreateBackupResponse> {
  return invoke("create_backup", { request: { masterPassword, destDir } });
}

/**
 * Restore a backup. Safety-copies the current vault before swapping, writes
 * a restore-in-progress marker (auto-cleared on next successful unlock), and
 * returns the path to the safety backup.
 *
 * Errors: "InvalidMasterPassword" (wrong password or corrupt backup),
 * "BackupVersionTooNew", "RestoreConflict" (another restore is in progress).
 */
export function restoreBackup(
  backupPath: string,
  backupPassword: string,
): Promise<RestoreBackupResponse> {
  return invoke("restore_backup", { request: { backupPath, backupPassword } });
}

// ---------------------------------------------------------------------------
// Vault data location
// ---------------------------------------------------------------------------

export interface RelocateResponse {
  vaultDir: string;
  /**
   * False when the old copies could not be removed. Not a failure — the move
   * is committed — but the UI must say the originals remain.
   */
  originalsRemoved: boolean;
}

/**
 * Point the app at a different vault directory without moving data. Rejects
 * with "VaultLocked" while unlocked. The returned status carries `vaultExists`,
 * so a folder that already holds a vault routes to the unlock screen.
 */
export function setVaultLocation(dir: string): Promise<VaultStatusResponse> {
  return invoke("set_vault_location", { dir });
}

/**
 * Pre-flight a relocation destination without moving anything.
 *
 * Needs no locked vault, so Settings can reject a bad folder (nested, already
 * holds a vault, not writable, restore in progress) while the user is still
 * unlocked — rather than locking first and charging a password re-entry to
 * learn about a one-click mistake. Rejects with the same codes as
 * `relocateVault`.
 */
export function checkVaultLocation(dir: string): Promise<void> {
  return invoke("check_vault_location", { dir });
}

/** Move the vault's data files. Requires a locked vault. */
export function relocateVault(dir: string): Promise<RelocateResponse> {
  return invoke("relocate_vault", { dir });
}

