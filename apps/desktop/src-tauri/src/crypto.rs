//! Envelope crypto: Argon2id KDF, XChaCha20-Poly1305 AEAD, key wrap.
//!
//! Invariants (see plan "Key Technical Decisions"):
//! - A random 32-byte data key encrypts all content; the Argon2id-derived
//!   KEK only wraps the data key.
//! - EVERY AEAD operation binds context via AAD: the key wrap binds KDF
//!   params + salt + wrap-format version (downgrade resistance); content
//!   blobs bind a domain tag + vault id + record identity (no splicing
//!   across contexts or vaults).
//! - Fresh random 24-byte nonce per encryption, never derived or reused.
//! - Zeroization lifetimes: master password immediately after KDF (the
//!   command layer owns it as `Zeroizing<String>` and drops it right after
//!   the wrap/unwrap call); KEK immediately after wrap/unwrap (scoped
//!   inside `wrap_data_key` / `unwrap_data_key`); data key session-long,
//!   zeroized on lock.
//! - No `Debug` derive on key-holding types (keys live only in
//!   `Zeroizing<[u8; KEY_LEN]>`, which has no `Debug`); `EncryptedBytes`
//!   deliberately has no `Debug` either so wrapped-key material never lands
//!   in logs or panic messages.
//! - Keys never cross IPC and never appear in errors or logs.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{VaultError, VaultResult};

pub const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;
const SALT_LEN: usize = 16;

// Argon2id bounds validated on load (v1 values carried forward).
const MIN_MEMORY_COST_KIB: u32 = 19 * 1024;
const MAX_MEMORY_COST_KIB: u32 = 1024 * 1024;
const MIN_TIME_COST: u32 = 1;
const MAX_TIME_COST: u32 = 10;
const MIN_PARALLELISM: u32 = 1;
const MAX_PARALLELISM: u32 = 16;

/// Reserved wrap-format version so master-password change / future wrap
/// formats stay implementable. Bound into the key-wrap AAD: an on-disk
/// downgrade of this field fails authentication.
pub const WRAP_FORMAT_VERSION: u32 = 1;

const KEY_WRAP_AAD_TAG: &[u8] = b"lifescribe-vault-v2:key-wrap";
const CONTENT_AAD_TAG: &[u8] = b"lifescribe-vault-v2:content";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyDerivationMetadata {
    pub salt: Vec<u8>,
    pub memory_cost_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
}

/// Nonce + ciphertext pair. No `Debug` derive (see module invariants).
#[derive(Clone, Serialize, Deserialize)]
pub struct EncryptedBytes {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

/// Content AAD domain tags. Adding a domain is additive-only; existing tag
/// strings are frozen (changing one makes old blobs unreadable).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AadDomain {
    Snapshot,
    Attachment,
    Draft,
    Backup,
}

impl AadDomain {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Snapshot => "snapshot",
            Self::Attachment => "attachment",
            Self::Draft => "draft",
            Self::Backup => "backup",
        }
    }
}

impl KeyDerivationMetadata {
    /// Default parameters: Argon2id 64 MiB / t=3 / p=1 with a fresh random
    /// 16-byte salt (v1 parameters, revalidated against 2026 guidance).
    pub fn new() -> Self {
        let mut salt = vec![0_u8; SALT_LEN];
        OsRng.fill_bytes(&mut salt);
        Self {
            salt,
            memory_cost_kib: 64 * 1024,
            time_cost: 3,
            parallelism: 1,
        }
    }
}

impl Default for KeyDerivationMetadata {
    fn default() -> Self {
        Self::new()
    }
}

fn validate_metadata(metadata: &KeyDerivationMetadata) -> VaultResult<()> {
    if metadata.salt.len() != SALT_LEN
        || metadata.memory_cost_kib < MIN_MEMORY_COST_KIB
        || metadata.memory_cost_kib > MAX_MEMORY_COST_KIB
        || metadata.time_cost < MIN_TIME_COST
        || metadata.time_cost > MAX_TIME_COST
        || metadata.parallelism < MIN_PARALLELISM
        || metadata.parallelism > MAX_PARALLELISM
    {
        return Err(VaultError::CorruptVault);
    }
    Ok(())
}

/// Generate a fresh random 32-byte data key (the session-long content key).
pub fn generate_data_key() -> Zeroizing<[u8; KEY_LEN]> {
    let mut key = Zeroizing::new([0_u8; KEY_LEN]);
    OsRng.fill_bytes(key.as_mut());
    key
}

/// Argon2id derivation. Bounds-validates the metadata first, so KDF
/// parameters outside the validated range are rejected on load.
pub fn derive_key(
    password: &str,
    metadata: &KeyDerivationMetadata,
) -> VaultResult<Zeroizing<[u8; KEY_LEN]>> {
    validate_metadata(metadata)?;
    let params = Params::new(
        metadata.memory_cost_kib,
        metadata.time_cost,
        metadata.parallelism,
        Some(KEY_LEN),
    )
    .map_err(|_| VaultError::CorruptVault)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0_u8; KEY_LEN]);
    argon2
        .hash_password_into(password.as_bytes(), &metadata.salt, key.as_mut())
        .map_err(|_| VaultError::CorruptVault)?;
    Ok(key)
}

/// Length-prefixed component encoding so AAD construction is unambiguous
/// (no concatenation collisions between adjacent components).
fn push_component(buffer: &mut Vec<u8>, component: &[u8]) {
    buffer.extend_from_slice(&(component.len() as u32).to_le_bytes());
    buffer.extend_from_slice(component);
}

/// AAD for the key wrap: binds KDF params + salt + wrap-format version.
/// Tampering any of these on disk makes the data-key unwrap fail
/// authentication (downgrade resistance).
pub fn key_wrap_aad(metadata: &KeyDerivationMetadata, wrap_format_version: u32) -> Vec<u8> {
    let mut aad = Vec::new();
    push_component(&mut aad, KEY_WRAP_AAD_TAG);
    push_component(&mut aad, &wrap_format_version.to_le_bytes());
    push_component(&mut aad, &metadata.memory_cost_kib.to_le_bytes());
    push_component(&mut aad, &metadata.time_cost.to_le_bytes());
    push_component(&mut aad, &metadata.parallelism.to_le_bytes());
    push_component(&mut aad, &metadata.salt);
    aad
}

/// AAD for content blobs: binds the domain tag, the owning vault's id, and
/// the record identity (e.g. `generation:7`). A blob can never be presented
/// under a different domain, vault, or record.
pub fn content_aad(domain: AadDomain, vault_id: &str, record_identity: &str) -> Vec<u8> {
    let mut aad = Vec::new();
    push_component(&mut aad, CONTENT_AAD_TAG);
    push_component(&mut aad, domain.as_str().as_bytes());
    push_component(&mut aad, vault_id.as_bytes());
    push_component(&mut aad, record_identity.as_bytes());
    aad
}

/// XChaCha20-Poly1305 encryption with a fresh random 24-byte nonce and the
/// given AAD. The AAD parameter is mandatory by design — there is no
/// AAD-less encryption path in this codebase.
pub fn encrypt_bytes(
    plaintext: &[u8],
    key: &[u8; KEY_LEN],
    aad: &[u8],
) -> VaultResult<EncryptedBytes> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce = vec![0_u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| VaultError::EncryptionFailed)?;
    Ok(EncryptedBytes { nonce, ciphertext })
}

pub fn decrypt_bytes(
    encrypted: &EncryptedBytes,
    key: &[u8; KEY_LEN],
    aad: &[u8],
) -> VaultResult<Vec<u8>> {
    if encrypted.nonce.len() != NONCE_LEN {
        return Err(VaultError::DecryptionFailed);
    }
    let cipher = XChaCha20Poly1305::new(key.into());
    cipher
        .decrypt(
            XNonce::from_slice(&encrypted.nonce),
            Payload {
                msg: encrypted.ciphertext.as_ref(),
                aad,
            },
        )
        .map_err(|_| VaultError::DecryptionFailed)
}

/// Wrap the data key under the Argon2id-derived KEK. The KEK exists only
/// inside this function and is zeroized on return (Zeroizing drop).
pub fn wrap_data_key(
    master_password: &str,
    metadata: &KeyDerivationMetadata,
    wrap_format_version: u32,
    data_key: &Zeroizing<[u8; KEY_LEN]>,
) -> VaultResult<EncryptedBytes> {
    let kek = derive_key(master_password, metadata)?;
    let aad = key_wrap_aad(metadata, wrap_format_version);
    encrypt_bytes(data_key.as_ref(), &kek, &aad)
    // `kek` (Zeroizing) is zeroized here, immediately after the wrap.
}

/// Unwrap the data key. Returns `DecryptionFailed` for a wrong password or
/// tampered KDF metadata / wrap version — indistinguishable by design; the
/// command layer maps this to `InvalidMasterPassword`.
pub fn unwrap_data_key(
    master_password: &str,
    metadata: &KeyDerivationMetadata,
    wrap_format_version: u32,
    wrapped: &EncryptedBytes,
) -> VaultResult<Zeroizing<[u8; KEY_LEN]>> {
    let kek = derive_key(master_password, metadata)?;
    let aad = key_wrap_aad(metadata, wrap_format_version);
    let plaintext = Zeroizing::new(decrypt_bytes(wrapped, &kek, &aad)?);
    // `kek` is zeroized at end of scope, immediately after the unwrap.
    if plaintext.len() != KEY_LEN {
        return Err(VaultError::CorruptVault);
    }
    let mut data_key = Zeroizing::new([0_u8; KEY_LEN]);
    data_key.copy_from_slice(plaintext.as_slice());
    Ok(data_key)
}
