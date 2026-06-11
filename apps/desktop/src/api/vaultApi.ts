// Typed wrappers around the Tauri IPC commands (the only bridge to Rust).
//
// Conventions (carried from v1):
// - Field names are camelCase on the wire; Rust structs use
//   `#[serde(rename_all = "camelCase")]`.
// - Errors reject with a stable string error code from Rust's
//   `command_error_code` ("InvalidMasterPassword", "VaultAlreadyExists",
//   "VaultNotInitialized", "NotFound", "VaultLocked", "InvalidRecordId",
//   "SnapshotConflict", "CorruptVault", "StorageError").
// - The snapshot is opaque JSON to Rust: whatever object is saved is
//   returned byte-identically by load. The richer snapshot type lives in
//   the domain layer; this module deliberately stays untyped about it.

import { invoke } from "@tauri-apps/api/core";

/** Opaque vault snapshot: Rust stores and returns it without interpretation. */
export type VaultSnapshot = Record<string, unknown>;

export interface VaultStatusResponse {
  unlocked: boolean;
  vaultExists: boolean;
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
