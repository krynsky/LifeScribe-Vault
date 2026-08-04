use crate::commands::{pdf_export_tmp_path, write_pdf_export_at_path};

#[test]
fn stages_the_export_beside_its_destination_not_in_the_system_temp_dir() {
    // rename() is atomic only within one filesystem, and the user may save to
    // any volume. Staging elsewhere would look fine locally and silently stop
    // being atomic on a USB stick or network share.
    let output_path = std::path::Path::new("D:/Backups/recovery-kit.pdf");
    let tmp_path = pdf_export_tmp_path(output_path).unwrap();

    assert_eq!(tmp_path.parent(), output_path.parent());
    assert_eq!(
        tmp_path.file_name().unwrap(),
        std::ffi::OsStr::new("recovery-kit.pdf.tmp")
    );
    assert!(pdf_export_tmp_path(std::path::Path::new("/")).is_none());
}

#[test]
fn writes_pdf_bytes_to_the_selected_path() {
    let dir = tempfile::tempdir().unwrap();
    let output_path = dir.path().join("recovery-kit.pdf");
    let bytes = b"%PDF-1.4\nkit";

    write_pdf_export_at_path(&output_path, bytes).unwrap();

    assert_eq!(std::fs::read(output_path).unwrap(), bytes);
}

#[test]
fn rejects_non_pdf_paths_and_payloads() {
    let dir = tempfile::tempdir().unwrap();

    assert!(write_pdf_export_at_path(&dir.path().join("recovery-kit.txt"), b"%PDF-1.4").is_err());
    assert!(write_pdf_export_at_path(&dir.path().join("recovery-kit.pdf"), b"not a pdf").is_err());
}

#[test]
fn replaces_an_existing_pdf_without_leaving_a_temp_file_behind() {
    let dir = tempfile::tempdir().unwrap();
    let output_path = dir.path().join("recovery-kit.pdf");
    std::fs::write(&output_path, b"%PDF-1.4\nolder export").unwrap();

    write_pdf_export_at_path(&output_path, b"%PDF-1.4\nnewer export").unwrap();

    assert_eq!(std::fs::read(&output_path).unwrap(), b"%PDF-1.4\nnewer export");
    let leftovers: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "left temp files behind: {leftovers:?}");
}

#[test]
fn a_rejected_export_leaves_an_existing_file_untouched() {
    // The destination is a path the user picked, so it may already hold a file
    // worth keeping. A refused export must not damage it.
    let dir = tempfile::tempdir().unwrap();
    let output_path = dir.path().join("important.pdf");
    std::fs::write(&output_path, b"%PDF-1.4\nkeep me").unwrap();

    assert!(write_pdf_export_at_path(&output_path, b"not a pdf").is_err());

    assert_eq!(std::fs::read(&output_path).unwrap(), b"%PDF-1.4\nkeep me");
}
