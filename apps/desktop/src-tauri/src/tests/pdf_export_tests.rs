use crate::commands::write_pdf_export_at_path;

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
