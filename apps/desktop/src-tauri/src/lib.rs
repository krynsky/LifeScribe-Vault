pub mod commands;
pub mod crypto;
pub mod error;
pub mod repository;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let vault_path = app_data_dir.join("vault.sqlite3");
            app.manage(commands::SharedVaultSession::new(
                commands::VaultSession::new(vault_path),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_vault_status,
            commands::create_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::save_vault_snapshot,
            commands::load_vault_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[path = "crypto_tests.rs"]
    mod crypto_tests;
    #[path = "snapshot_tests.rs"]
    mod snapshot_tests;
    #[path = "vault_lifecycle_tests.rs"]
    mod vault_lifecycle_tests;
}
