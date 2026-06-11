//! Clipboard hygiene (U5).
//!
//! In-app copy affordances for vault values must go through this command,
//! never `navigator.clipboard.writeText`, because only the native clipboard
//! API can set the Windows exclusion formats:
//!
//! - `ExcludeClipboardContentFromMonitorProcessing` — clipboard monitors
//!   are asked not to process the content at all.
//! - `CanIncludeInClipboardHistory` = 0 — excluded from Win+V history.
//! - `CanUploadToCloudClipboard` = 0 — never synced to the cloud clipboard.
//!
//! After `clear_after_seconds` (default 45, clamped to 1..=600) a background
//! thread clears the clipboard ONLY if it still holds the value we placed —
//! something the user copied afterwards is never destroyed.
//!
//! Honest limits (documented in the plan): manual Ctrl+C of rendered text
//! bypasses this path and is not preventable; the lock screen therefore
//! renders no copyable vault plaintext.
//!
//! Structure: the Win32 calls are `#[cfg(windows)]`; other targets get a
//! no-op fallback (this is a Windows-only product — the fallback exists so
//! the crate still compiles elsewhere and sets nothing rather than setting
//! text without the exclusion formats). The clear/clamp decision logic is
//! pure and unit-tested; the Win32 calls themselves are not unit-tested.

use zeroize::Zeroizing;

pub const DEFAULT_CLEAR_AFTER_SECONDS: u32 = 45;
pub const MIN_CLEAR_AFTER_SECONDS: u32 = 1;
pub const MAX_CLEAR_AFTER_SECONDS: u32 = 600;

/// Clamp the requested auto-clear delay: default 45s, never 0 (the clear
/// must not be skippable), never longer than 10 minutes.
pub fn effective_clear_after_seconds(requested: Option<u32>) -> u32 {
    requested
        .unwrap_or(DEFAULT_CLEAR_AFTER_SECONDS)
        .clamp(MIN_CLEAR_AFTER_SECONDS, MAX_CLEAR_AFTER_SECONDS)
}

/// Clear only when the clipboard still holds exactly the value we placed.
/// `None` (cleared / non-text / unreadable) and any other text both mean
/// the user moved on — leave the clipboard alone.
pub fn should_clear_clipboard(current: Option<&str>, copied: &str) -> bool {
    matches!(current, Some(text) if text == copied)
}

/// Copy a vault value with exclusion formats, then schedule the auto-clear.
pub fn copy_vault_value_with_auto_clear(
    value: String,
    clear_after_seconds: Option<u32>,
) -> Result<(), String> {
    let value = Zeroizing::new(value);
    let delay = effective_clear_after_seconds(clear_after_seconds);

    platform::set_clipboard_excluded(&value)?;

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(u64::from(delay)));
        let current = platform::read_clipboard_text();
        if should_clear_clipboard(current.as_deref(), &value) {
            platform::clear_clipboard();
        }
        // `value` (Zeroizing) is zeroized on drop here.
    });

    Ok(())
}

#[cfg(windows)]
mod platform {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard,
        RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_UNICODETEXT: u32 = 13;

    /// Clipboard guard: closes the clipboard on drop, even on early return.
    struct OpenClipboardGuard;

    impl OpenClipboardGuard {
        fn open() -> Result<Self, String> {
            // Retry briefly: another process may hold the clipboard open.
            for _ in 0..10 {
                if unsafe { OpenClipboard(None) }.is_ok() {
                    return Ok(Self);
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            Err("The clipboard is in use by another application.".to_string())
        }
    }

    impl Drop for OpenClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    fn to_utf16(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Allocate a movable global buffer, copy `bytes` in, and hand it to the
    /// clipboard under `format`. Ownership transfers to the system on
    /// success.
    unsafe fn set_data(format: u32, bytes: &[u8]) -> Result<(), String> {
        let global: HGLOBAL =
            GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|error| error.to_string())?;
        let pointer = GlobalLock(global);
        if pointer.is_null() {
            return Err("Clipboard memory could not be locked.".to_string());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast::<u8>(), bytes.len());
        let _ = GlobalUnlock(global);
        SetClipboardData(format, Some(HANDLE(global.0)))
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn register_format(name: &str) -> u32 {
        let wide = to_utf16(name);
        unsafe { RegisterClipboardFormatW(PCWSTR(wide.as_ptr())) }
    }

    /// Set the clipboard to `value` (CF_UNICODETEXT) plus the three Windows
    /// exclusion formats: no monitor processing, no Win+V history, no cloud
    /// clipboard sync.
    pub fn set_clipboard_excluded(value: &str) -> Result<(), String> {
        let _guard = OpenClipboardGuard::open()?;
        unsafe {
            EmptyClipboard().map_err(|error| error.to_string())?;

            let utf16 = to_utf16(value);
            let bytes: &[u8] = std::slice::from_raw_parts(
                utf16.as_ptr().cast::<u8>(),
                utf16.len() * std::mem::size_of::<u16>(),
            );
            set_data(CF_UNICODETEXT, bytes)?;

            let zero: [u8; 4] = 0_u32.to_le_bytes();
            for name in [
                "ExcludeClipboardContentFromMonitorProcessing",
                "CanIncludeInClipboardHistory",
                "CanUploadToCloudClipboard",
            ] {
                let format = register_format(name);
                if format != 0 {
                    // Best-effort: a failed exclusion format must not block
                    // the copy itself, but DWORD 0 disables history/cloud.
                    let _ = set_data(format, &zero);
                }
            }
        }
        Ok(())
    }

    /// Current CF_UNICODETEXT clipboard content, if any.
    pub fn read_clipboard_text() -> Option<String> {
        let _guard = OpenClipboardGuard::open().ok()?;
        unsafe {
            let handle = GetClipboardData(CF_UNICODETEXT).ok()?;
            let global = HGLOBAL(handle.0);
            let pointer = GlobalLock(global).cast::<u16>();
            if pointer.is_null() {
                return None;
            }
            let mut length = 0_usize;
            while *pointer.add(length) != 0 {
                length += 1;
            }
            let slice = std::slice::from_raw_parts(pointer, length);
            let text = String::from_utf16_lossy(slice);
            let _ = GlobalUnlock(global);
            Some(text)
        }
    }

    pub fn clear_clipboard() {
        if let Ok(_guard) = OpenClipboardGuard::open() {
            unsafe {
                let _ = EmptyClipboard();
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    /// Non-Windows fallback: deliberately a no-op. Setting text WITHOUT the
    /// exclusion formats would silently violate the hygiene contract, so on
    /// non-Windows builds (compile-target completeness only — this is a
    /// Windows product) nothing is placed on the clipboard.
    pub fn set_clipboard_excluded(_value: &str) -> Result<(), String> {
        Ok(())
    }

    pub fn read_clipboard_text() -> Option<String> {
        None
    }

    pub fn clear_clipboard() {}
}
