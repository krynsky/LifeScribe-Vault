pub mod attachments;
pub mod backup;
pub mod commands;
pub mod crypto;
pub mod draft_stash;
pub mod error;
pub mod pack_resources;
pub mod repository;
pub mod vault_location;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let vault_dir = vault_location::resolve_vault_dir(&config_dir);
            let vault_path = vault_location::vault_file_in(&vault_dir);
            app.manage(commands::SharedVaultSession::new(
                commands::VaultSession::with_config_dir(vault_path, config_dir),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_vault_status,
            commands::create_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::change_vault_password,
            commands::set_vault_location,
            commands::check_vault_location,
            commands::relocate_vault,
            commands::save_vault_snapshot,
            commands::load_vault_snapshot,
            commands::stash_draft,
            commands::take_draft,
            commands::discard_draft,
            commands::add_attachment,
            commands::delete_attachment,
            commands::read_attachment,
            commands::open_attachment_external,
            commands::sweep_orphaned_attachments,
            commands::create_backup,
            commands::restore_backup,
            commands::write_pdf_export,
            pack_resources::read_default_pack,
            pack_resources::write_default_pack
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[path = "attachment_tests.rs"]
    mod attachment_tests;
    #[path = "backup_tests.rs"]
    mod backup_tests;
    #[path = "crypto_tests.rs"]
    mod crypto_tests;
    #[path = "draft_stash_tests.rs"]
    mod draft_stash_tests;
    #[path = "pack_resource_tests.rs"]
    mod pack_resource_tests;
    #[path = "pdf_export_tests.rs"]
    mod pdf_export_tests;
    #[path = "snapshot_tests.rs"]
    mod snapshot_tests;
    #[path = "vault_lifecycle_tests.rs"]
    mod vault_lifecycle_tests;
    #[path = "vault_location_tests.rs"]
    mod vault_location_tests;
}
