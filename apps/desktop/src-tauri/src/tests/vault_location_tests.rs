//! Vault location pointer + relocation tests, against real files via `tempfile`.

use std::fs;

use tempfile::tempdir;

use crate::vault_location::{
    read_location, relocate, resolve_vault_dir, vault_file_in, write_location,
};

#[test]
fn resolve_falls_back_to_config_dir_when_no_pointer_exists() {
    let dir = tempdir().unwrap();
    assert_eq!(resolve_vault_dir(dir.path()), dir.path().to_path_buf());
}

#[test]
fn pointer_round_trips() {
    let config = tempdir().unwrap();
    let target = tempdir().unwrap();

    write_location(config.path(), target.path()).unwrap();

    assert_eq!(read_location(config.path()), Some(target.path().to_path_buf()));
    assert_eq!(resolve_vault_dir(config.path()), target.path().to_path_buf());
}

#[test]
fn corrupt_pointer_degrades_to_the_default_without_panicking() {
    let config = tempdir().unwrap();
    fs::write(config.path().join("vault-location.json"), b"{ this is not json").unwrap();

    assert_eq!(read_location(config.path()), None);
    assert_eq!(resolve_vault_dir(config.path()), config.path().to_path_buf());
}

#[test]
fn pointer_with_wrong_shape_degrades_to_the_default() {
    let config = tempdir().unwrap();
    // Valid JSON, missing the vaultDir key.
    fs::write(config.path().join("vault-location.json"), br#"{"other":1}"#).unwrap();

    assert_eq!(read_location(config.path()), None);
}

#[test]
fn write_location_creates_the_config_directory_when_absent() {
    let root = tempdir().unwrap();
    let config = root.path().join("not-yet-created");
    let target = tempdir().unwrap();

    write_location(&config, target.path()).unwrap();

    assert_eq!(read_location(&config), Some(target.path().to_path_buf()));
}

#[test]
fn vault_file_in_appends_the_database_name() {
    let dir = tempdir().unwrap();
    assert_eq!(vault_file_in(dir.path()), dir.path().join("vault.sqlite3"));
}

use crate::commands::{create_vault_at_path, VaultSession};
use crate::error::command_error_code;

const PASSWORD: &str = "test-master-password-relocate";

/// A real vault at `dir`, with one attachment file so the attachments
/// directory is genuinely populated.
fn seed_vault(dir: &std::path::Path) {
    let vault_path = vault_file_in(dir);
    let mut session = VaultSession::new(vault_path.clone());
    create_vault_at_path(&vault_path, &mut session, PASSWORD, "Owner").unwrap();

    let att_dir = crate::attachments::attachment_dir(&vault_path);
    fs::create_dir_all(&att_dir).unwrap();
    fs::write(att_dir.join("abc-123.bin"), b"ciphertext-blob").unwrap();
}

#[test]
fn relocate_moves_the_database_and_attachments_and_the_result_opens() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());

    let originals_removed = relocate(from.path(), from.path(), &to.path().join("moved")).unwrap();

    let moved_dir = to.path().join("moved");
    assert!(originals_removed, "originals should be removable in a temp dir");
    assert!(vault_file_in(&moved_dir).exists(), "database must exist at the destination");
    assert!(
        moved_dir.join("attachments").join("abc-123.bin").exists(),
        "attachments must come along",
    );
    assert!(!vault_file_in(from.path()).exists(), "original database must be gone");

    // The moved database must actually open.
    let repo = crate::repository::VaultRepository::open_existing(&vault_file_in(&moved_dir)).unwrap();
    assert!(repo.vault_header_exists().unwrap());
}

#[test]
fn relocate_to_the_same_directory_is_a_no_op_success() {
    let from = tempdir().unwrap();
    seed_vault(from.path());

    assert!(relocate(from.path(), from.path(), from.path()).unwrap());
    assert!(vault_file_in(from.path()).exists(), "vault must be untouched");
}

#[test]
fn relocate_rejects_a_destination_nested_inside_the_source() {
    let from = tempdir().unwrap();
    seed_vault(from.path());

    let nested = from.path().join("inner");
    let error = relocate(from.path(), from.path(), &nested).unwrap_err();

    assert_eq!(command_error_code(error), "StorageError");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
}

#[test]
fn relocate_rejects_a_destination_that_already_holds_a_vault() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    seed_vault(to.path());

    let error = relocate(from.path(), from.path(), to.path()).unwrap_err();

    assert_eq!(command_error_code(error), "VaultAlreadyExists");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
}

#[test]
fn relocate_refuses_while_a_restore_is_in_progress() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    // The marker name is what `restore_in_progress` looks for.
    fs::write(from.path().join(crate::backup::RESTORE_MARKER_NAME), b"{}").unwrap();

    let error = relocate(from.path(), from.path(), &to.path().join("moved")).unwrap_err();

    assert_eq!(command_error_code(error), "RestoreConflict");
    assert!(vault_file_in(from.path()).exists(), "source must be untouched");
}

#[test]
fn relocate_does_not_move_the_pointer_file_when_config_and_vault_dirs_coincide() {
    // The default configuration: vault_dir == config_dir, so the source
    // directory CONTAINS vault-location.json. Dragging it along would leave a
    // stale pointer at the destination.
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    write_location(from.path(), from.path()).unwrap();

    relocate(from.path(), from.path(), &to.path().join("moved")).unwrap();

    assert!(
        !to.path().join("moved").join("vault-location.json").exists(),
        "the pointer must never be copied to the destination",
    );
}

#[test]
fn relocate_carries_the_safety_backup_directory_rather_than_stranding_it() {
    // `attachments-safety-backup` is a DIRECTORY, not a file — a plain
    // `fs::copy` over the moved-set list would fail on it.
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());
    let safety_att = from.path().join("attachments-safety-backup");
    fs::create_dir_all(&safety_att).unwrap();
    fs::write(safety_att.join("old.bin"), b"older-ciphertext").unwrap();
    fs::write(from.path().join("vault-safety-backup.sqlite3"), b"older-db").unwrap();

    let moved_dir = to.path().join("moved");
    relocate(from.path(), from.path(), &moved_dir).unwrap();

    assert!(
        moved_dir.join("attachments-safety-backup").join("old.bin").exists(),
        "the safety-backup directory must travel with the vault",
    );
    assert!(moved_dir.join("vault-safety-backup.sqlite3").exists());
    assert!(!safety_att.exists(), "the original safety-backup directory must be gone");
}

#[test]
fn moved_database_still_contains_no_plaintext() {
    let from = tempdir().unwrap();
    let to = tempdir().unwrap();
    seed_vault(from.path());

    relocate(from.path(), from.path(), &to.path().join("moved")).unwrap();

    let bytes = fs::read(vault_file_in(&to.path().join("moved"))).unwrap();
    let haystack = String::from_utf8_lossy(&bytes);
    assert!(!haystack.contains(PASSWORD), "password must never appear in the file");
    assert!(!haystack.contains("Owner"), "owner name must never appear in the file");
}
