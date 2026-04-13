use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BackendReady {
    pub host: String,
    pub port: u16,
    pub token: String,
}

pub struct BackendState {
    pub ready: Mutex<Option<BackendReady>>,
    pub child: Mutex<Option<CommandChild>>,
}

pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64url_encode(&bytes)
}

fn base64url_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut i = 0usize;
    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | (bytes[i + 2] as u32);
        out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 6) & 63) as usize] as char);
        out.push(ALPHABET[(n & 63) as usize] as char);
        i += 3;
    }
    out
}

pub fn spawn_backend(app: &AppHandle) -> Result<(), String> {
    let token = generate_token();
    let cmd = app
        .shell()
        .sidecar("lifescribe-backend")
        .map_err(|e| format!("resolve sidecar: {e}"))?
        .args(["--host", "127.0.0.1", "--port", "0", "--auth-token", &token]);

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let state: tauri::State<BackendState> = app.state();
    *state.child.lock().unwrap() = Some(child);

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line_bytes) = event {
                if let Ok(line) = String::from_utf8(line_bytes) {
                    if let Ok(ready) = serde_json::from_str::<BackendReady>(line.trim()) {
                        let state: tauri::State<BackendState> = app_for_task.state();
                        *state.ready.lock().unwrap() = Some(ready.clone());
                        let _ = app_for_task.emit("backend-ready", ready);
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn backend_info(state: tauri::State<BackendState>) -> Option<BackendReady> {
    state.ready.lock().unwrap().clone()
}
