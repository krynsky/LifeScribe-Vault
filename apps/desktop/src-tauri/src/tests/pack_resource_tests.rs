//! Pack-resource read tests (U6): raw passthrough of the bundled default
//! pack file, clean error codes for missing files, and a guard that the
//! shipped resource actually parses as JSON (full structural validation is
//! the frontend's job — Rust never interprets the pack).

use std::path::Path;

use crate::error::{command_error_code, VaultError};
use crate::pack_resources::{read_pack_at_path, DEFAULT_PACK_RESOURCE};

#[test]
fn reads_and_returns_the_file_content_verbatim() {
    let dir = tempfile::tempdir().expect("tempdir");
    let pack_path = dir.path().join("pack.json");
    let content = "{\n  \"packId\": \"lifescribe-default\",\n  \"sections\": []\n}\n";
    std::fs::write(&pack_path, content).expect("write pack");

    let read = read_pack_at_path(&pack_path).expect("read pack");
    assert_eq!(read, content, "the raw JSON string passes through untouched");
}

#[test]
fn missing_file_surfaces_a_clean_not_found_error_code() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("does-not-exist.json");

    let error = read_pack_at_path(&missing).expect_err("missing file must error");
    assert!(matches!(error, VaultError::NotFound));
    assert_eq!(command_error_code(error), "NotFound");
}

#[test]
fn unreadable_path_maps_to_a_file_operation_error() {
    // A directory is not a readable file: read_to_string fails with a
    // non-NotFound IO error, which must map to FileOperation (StorageError
    // on the wire), never a panic or a silent empty string.
    let dir = tempfile::tempdir().expect("tempdir");
    let error = read_pack_at_path(dir.path()).expect_err("directory must error");
    assert!(matches!(error, VaultError::FileOperation(_)));
    assert_eq!(command_error_code(error), "StorageError");
}

#[test]
fn shipped_default_pack_resource_exists_and_is_json() {
    let pack_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(DEFAULT_PACK_RESOURCE);
    let content = read_pack_at_path(&pack_path).expect("the shipped default pack must exist");
    let parsed: serde_json::Value =
        serde_json::from_str(&content).expect("the shipped default pack must be valid JSON");
    assert_eq!(
        parsed.get("packId").and_then(|value| value.as_str()),
        Some("lifescribe-default"),
    );
}
