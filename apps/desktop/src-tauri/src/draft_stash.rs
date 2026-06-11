//! Encrypted draft stash (U5 lock state machine).
//!
//! When the app locks with unsaved edits, the frontend stashes the dirty
//! draft here BEFORE calling `lock_vault` — the draft is encrypted with the
//! session data key while it still exists, so no plaintext draft content
//! ever persists on disk while the vault is locked.
//!
//! Invariants:
//! - The draft is opaque `serde_json::Value` (same law as the snapshot —
//!   Rust never mirrors it in a struct).
//! - AAD binds the `draft` domain tag, the vault id, and the snapshot
//!   generation the session had loaded when the draft was stashed
//!   (`generation:<n>`). The generation is also stored as accepted
//!   plaintext metadata so `take_draft` can rebuild the AAD and flag a
//!   stale draft; tampering it on disk makes decryption fail (corrupt).
//! - The stash file is written atomically (temp + rename) next to the
//!   vault file, so a crash mid-write leaves the draft either absent or
//!   whole — never half-written.
//! - The stash file is deleted on take-success and on explicit discard. A
//!   corrupt stash surfaces `corrupt: true` and the file is retained — it
//!   never silently vanishes; the frontend decides when to discard it.
//! - The plaintext metadata reveals only "editing happened at time T at
//!   generation N" — never field content.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::commands::VaultSession;
use crate::crypto::{content_aad, decrypt_bytes, encrypt_bytes, AadDomain, EncryptedBytes};
use crate::error::{VaultError, VaultResult};

/// On-disk stash file format version (plaintext envelope around ciphertext).
const STASH_FORMAT: u32 = 1;

/// Plaintext stash envelope. `stashed_at` / `generation` are accepted
/// plaintext metadata (see module docs); the draft content itself lives
/// only inside `body` (XChaCha20-Poly1305, AAD-bound).
#[derive(Serialize, Deserialize)]
struct StashFile {
    stash_format: u32,
    generation: u64,
    stashed_at: String,
    body: EncryptedBytes,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeDraftResponse {
    /// The decrypted draft, or `null` when no stash exists / it is corrupt.
    pub draft: Option<Value>,
    /// True when a stash file exists but could not be read or decrypted.
    pub corrupt: bool,
    /// True when the draft decrypted but was stashed against a different
    /// snapshot generation than the session currently has loaded — the UI
    /// shows a "vault changed since this draft" warning.
    pub stale_generation: bool,
    /// RFC 3339 timestamp the draft was stashed at (plaintext metadata).
    pub stashed_at: Option<String>,
}

impl TakeDraftResponse {
    fn empty() -> Self {
        Self {
            draft: None,
            corrupt: false,
            stale_generation: false,
            stashed_at: None,
        }
    }

    fn corrupt() -> Self {
        Self {
            draft: None,
            corrupt: true,
            stale_generation: false,
            stashed_at: None,
        }
    }
}

/// The stash lives next to the vault file: `vault.sqlite3.draft`.
pub fn draft_stash_path(vault_path: &Path) -> PathBuf {
    let mut name = vault_path.as_os_str().to_owned();
    name.push(".draft");
    PathBuf::from(name)
}

fn temp_stash_path(stash_path: &Path) -> PathBuf {
    let mut name = stash_path.as_os_str().to_owned();
    name.push(format!(".tmp-{}", uuid::Uuid::new_v4()));
    PathBuf::from(name)
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| String::new())
}

/// Encrypt and atomically persist a draft for the current session.
/// Must be called BEFORE `lock_vault` zeroizes the data key.
pub fn stash_draft_for_session(session: &VaultSession, draft: &Value) -> VaultResult<()> {
    let (key, vault_id) = match (&session.key, &session.vault_id) {
        (Some(key), Some(vault_id)) => (key, vault_id),
        _ => return Err(VaultError::Locked),
    };

    let plaintext = serde_json::to_vec(draft).map_err(|_| VaultError::EncryptionFailed)?;
    let generation = session.loaded_generation;
    let aad = content_aad(
        AadDomain::Draft,
        vault_id,
        &format!("generation:{generation}"),
    );
    let body = encrypt_bytes(&plaintext, key, &aad)?;

    let stash = StashFile {
        stash_format: STASH_FORMAT,
        generation,
        stashed_at: now_rfc3339(),
        body,
    };
    let bytes = serde_json::to_vec(&stash).map_err(|_| VaultError::EncryptionFailed)?;

    // Atomic write: temp sibling + rename. A crash leaves either the old
    // stash (rename not reached) or the new one — never a torn file.
    let stash_path = draft_stash_path(&session.vault_path);
    let temp_path = temp_stash_path(&stash_path);
    let write_result = std::fs::write(&temp_path, &bytes)
        .and_then(|()| {
            // Replace any previous stash. On Windows, rename fails if the
            // destination exists, so remove it first — the temp file is
            // still whole if removal or rename crashes mid-way.
            if stash_path.exists() {
                std::fs::remove_file(&stash_path)?;
            }
            std::fs::rename(&temp_path, &stash_path)
        })
        .map_err(|error| VaultError::FileOperation(error.to_string()));
    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    write_result
}

/// Read, decrypt, and consume the stashed draft (if any).
///
/// - No stash file: empty response.
/// - Unreadable / undecryptable stash: `corrupt: true`, file retained.
/// - Decrypted draft stashed at a different generation than the session's
///   loaded generation: returned with `stale_generation: true`.
/// - Successful take deletes the stash file.
pub fn take_draft_for_session(session: &VaultSession) -> VaultResult<TakeDraftResponse> {
    let (key, vault_id) = match (&session.key, &session.vault_id) {
        (Some(key), Some(vault_id)) => (key, vault_id),
        _ => return Err(VaultError::Locked),
    };

    let stash_path = draft_stash_path(&session.vault_path);
    if !stash_path.exists() {
        return Ok(TakeDraftResponse::empty());
    }

    let bytes = match std::fs::read(&stash_path) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(TakeDraftResponse::corrupt()),
    };
    let stash: StashFile = match serde_json::from_slice(&bytes) {
        Ok(stash) => stash,
        Err(_) => return Ok(TakeDraftResponse::corrupt()),
    };
    if stash.stash_format != STASH_FORMAT {
        return Ok(TakeDraftResponse::corrupt());
    }

    let aad = content_aad(
        AadDomain::Draft,
        vault_id,
        &format!("generation:{}", stash.generation),
    );
    let plaintext = match decrypt_bytes(&stash.body, key, &aad) {
        Ok(plaintext) => plaintext,
        Err(_) => return Ok(TakeDraftResponse::corrupt()),
    };
    let draft: Value = match serde_json::from_slice(&plaintext) {
        Ok(draft) => draft,
        Err(_) => return Ok(TakeDraftResponse::corrupt()),
    };

    // Take-success consumes the stash.
    std::fs::remove_file(&stash_path)
        .map_err(|error| VaultError::FileOperation(error.to_string()))?;

    Ok(TakeDraftResponse {
        draft: Some(draft),
        corrupt: false,
        stale_generation: stash.generation != session.loaded_generation,
        stashed_at: Some(stash.stashed_at),
    })
}

/// Delete any stashed draft. Safe to call when none exists, and allowed
/// while locked (it only removes ciphertext — no key required).
pub fn discard_draft_for_session(session: &VaultSession) -> VaultResult<()> {
    let stash_path = draft_stash_path(&session.vault_path);
    match std::fs::remove_file(&stash_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(VaultError::FileOperation(error.to_string())),
    }
}
