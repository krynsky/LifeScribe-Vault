use thiserror::Error;

/// Vault error type.
///
/// Invariant: errors NEVER carry key material, derived keys, or password
/// text. The `FileOperation` / `Storage` payloads contain only IO / SQLite
/// driver messages.
#[derive(Debug, Error)]
pub enum VaultError {
    #[error("A vault already exists at this location.")]
    VaultAlreadyExists,
    #[error("The vault has not been initialized.")]
    VaultNotInitialized,
    #[error("The master password could not unlock this vault. There is no reset.")]
    InvalidMasterPassword,
    #[error("The vault data could not be decrypted.")]
    DecryptionFailed,
    #[error("The vault data could not be encrypted.")]
    EncryptionFailed,
    #[error("The vault file is missing or corrupt.")]
    CorruptVault,
    #[error("The requested item was not found.")]
    NotFound,
    #[error("The record id is invalid.")]
    InvalidRecordId,
    #[error("The vault is locked.")]
    Locked,
    #[error("The vault changed since this snapshot was loaded. Reload before saving.")]
    SnapshotConflict,
    #[error("This backup requires a newer version of LifeScribe Vault.")]
    BackupVersionTooNew,
    #[error("A restore is already in progress. Complete or roll back before starting a new one.")]
    RestoreConflict,
    #[error("The v1 vault file is locked by another application. Close LifeScribe Vault v1 and try again.")]
    DatabaseLocked,
    #[error("That folder cannot hold the vault.")]
    InvalidVaultLocation,
    #[error("File operation failed: {0}")]
    FileOperation(String),
    #[error("Storage operation failed: {0}")]
    Storage(String),
}

pub type VaultResult<T> = Result<T, VaultError>;

/// Stable string error codes — the IPC contract with the frontend.
/// (Carried from v1's `command_error_code` pattern; codes are frozen.)
pub fn command_error_code(error: VaultError) -> String {
    match error {
        VaultError::InvalidMasterPassword => "InvalidMasterPassword",
        VaultError::VaultAlreadyExists => "VaultAlreadyExists",
        VaultError::VaultNotInitialized => "VaultNotInitialized",
        VaultError::NotFound => "NotFound",
        VaultError::Locked => "VaultLocked",
        VaultError::InvalidRecordId => "InvalidRecordId",
        VaultError::SnapshotConflict => "SnapshotConflict",
        VaultError::CorruptVault | VaultError::DecryptionFailed | VaultError::EncryptionFailed => {
            "CorruptVault"
        }
        VaultError::BackupVersionTooNew => "BackupVersionTooNew",
        VaultError::RestoreConflict => "RestoreConflict",
        VaultError::DatabaseLocked => "DatabaseLocked",
        VaultError::InvalidVaultLocation => "InvalidVaultLocation",
        VaultError::FileOperation(_) | VaultError::Storage(_) => "StorageError",
    }
    .to_string()
}
