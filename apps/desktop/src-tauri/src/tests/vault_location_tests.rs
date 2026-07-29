//! Vault location pointer + relocation tests, against real files via `tempfile`.

use std::fs;

use tempfile::tempdir;

use crate::vault_location::{
    read_location, resolve_vault_dir, vault_file_in, write_location,
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
fn vault_file_in_appends_the_database_name() {
    let dir = tempdir().unwrap();
    assert_eq!(vault_file_in(dir.path()), dir.path().join("vault.sqlite3"));
}
