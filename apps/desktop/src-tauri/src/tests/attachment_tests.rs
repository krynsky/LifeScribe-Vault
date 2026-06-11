use std::fs;

use tempfile::tempdir;

use crate::attachments::{
    attachment_dir, decrypt_attachment, delete_attachment_file, encrypt_attachment,
    sweep_orphaned_attachments,
};
use crate::crypto::generate_data_key;

fn fake_vault_path(base: &std::path::Path) -> std::path::PathBuf {
    base.join("vault.sqlite3")
}

#[test]
fn encrypt_and_decrypt_round_trip() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("doc.txt");
    fs::write(&source, b"my secret document").unwrap();

    let key = generate_data_key();
    let vault_id = "test-vault";
    let att_dir = dir.path().join("attachments");

    let meta = encrypt_attachment(&source, &att_dir, &key, vault_id).unwrap();
    assert_eq!(meta.file_name, "doc.txt");
    assert_eq!(meta.size_bytes, 18);
    assert!(att_dir.join(format!("{}.bin", meta.id)).exists());

    let plaintext = decrypt_attachment(&att_dir, &meta.id, &key, vault_id).unwrap();
    assert_eq!(plaintext, b"my secret document");
}

#[test]
fn attachment_dir_derives_from_vault_path() {
    let vp = std::path::Path::new("/data/vault.sqlite3");
    assert_eq!(attachment_dir(vp), std::path::Path::new("/data/attachments"));
}

#[test]
fn encrypt_missing_source_returns_not_found() {
    let dir = tempdir().unwrap();
    let key = generate_data_key();
    let att_dir = dir.path().join("attachments");
    let result = encrypt_attachment(
        &dir.path().join("ghost.pdf"),
        &att_dir,
        &key,
        "vault-id",
    );
    assert!(matches!(result, Err(crate::error::VaultError::NotFound)));
    // No partial file should remain.
    assert!(!att_dir.exists() || fs::read_dir(&att_dir).unwrap().count() == 0);
}

#[test]
fn wrong_vault_id_fails_aad_check() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("file.txt");
    fs::write(&source, b"content").unwrap();
    let key = generate_data_key();
    let att_dir = dir.path().join("attachments");

    let meta = encrypt_attachment(&source, &att_dir, &key, "vault-a").unwrap();
    let result = decrypt_attachment(&att_dir, &meta.id, &key, "vault-b");
    assert!(matches!(result, Err(crate::error::VaultError::DecryptionFailed)));
}

#[test]
fn delete_removes_file() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("f.txt");
    fs::write(&source, b"data").unwrap();
    let key = generate_data_key();
    let att_dir = dir.path().join("attachments");

    let meta = encrypt_attachment(&source, &att_dir, &key, "v").unwrap();
    let bin = att_dir.join(format!("{}.bin", meta.id));
    assert!(bin.exists());
    delete_attachment_file(&att_dir, &meta.id).unwrap();
    assert!(!bin.exists());
}

#[test]
fn delete_missing_file_is_ok() {
    let dir = tempdir().unwrap();
    let att_dir = dir.path().join("attachments");
    let result = delete_attachment_file(&att_dir, "nonexistent-id");
    assert!(result.is_ok());
}

#[test]
fn sweep_removes_unreferenced_old_files() {
    let dir = tempdir().unwrap();
    let att_dir = dir.path().join("attachments");
    fs::create_dir_all(&att_dir).unwrap();

    // Write two .bin files with an old mtime.
    let orphan = att_dir.join("orphan-1111-2222-3333-4444.bin");
    let referenced = att_dir.join("ref-1111-2222-3333-4444.bin");
    fs::write(&orphan, b"old-ciphertext").unwrap();
    fs::write(&referenced, b"old-ciphertext").unwrap();

    // Back-date both files by 300 seconds (well past the 120s grace period).
    let old_time = std::time::SystemTime::now() - std::time::Duration::from_secs(300);
    filetime::set_file_mtime(&orphan, filetime::FileTime::from_system_time(old_time)).unwrap();
    filetime::set_file_mtime(&referenced, filetime::FileTime::from_system_time(old_time)).unwrap();

    let referenced_ids = vec!["ref-1111-2222-3333-4444".to_string()];
    let swept = sweep_orphaned_attachments(&att_dir, &referenced_ids).unwrap();
    assert_eq!(swept, 1);
    assert!(!orphan.exists(), "orphan should be swept");
    assert!(referenced.exists(), "referenced file must survive");
}

#[test]
fn sweep_skips_files_within_grace_period() {
    let dir = tempdir().unwrap();
    let att_dir = dir.path().join("attachments");
    fs::create_dir_all(&att_dir).unwrap();

    let fresh = att_dir.join("fresh-1111-2222-3333-4444.bin");
    fs::write(&fresh, b"just-written").unwrap();
    // No mtime backdating — file is "just now".

    let swept = sweep_orphaned_attachments(&att_dir, &[]).unwrap();
    assert_eq!(swept, 0, "fresh unreferenced file must not be swept");
    assert!(fresh.exists());
}

#[test]
fn sweep_nonexistent_dir_is_ok() {
    let dir = tempdir().unwrap();
    let att_dir = dir.path().join("attachments");
    let result = sweep_orphaned_attachments(&att_dir, &[]);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 0);
}

#[test]
fn sweep_removes_stale_tmp_files() {
    let dir = tempdir().unwrap();
    let att_dir = dir.path().join("attachments");
    fs::create_dir_all(&att_dir).unwrap();
    let tmp = att_dir.join("whatever.tmp");
    fs::write(&tmp, b"stale").unwrap();
    sweep_orphaned_attachments(&att_dir, &[]).unwrap();
    assert!(!tmp.exists());
}
