//! Unit tests for the clipboard-hygiene DECISION logic only. The Win32
//! calls (exclusion formats, set/clear) are deliberately not unit-tested —
//! they mutate the real machine clipboard and would be flaky side effects
//! in a test run.

use crate::clipboard::{
    effective_clear_after_seconds, should_clear_clipboard, DEFAULT_CLEAR_AFTER_SECONDS,
    MAX_CLEAR_AFTER_SECONDS, MIN_CLEAR_AFTER_SECONDS,
};

#[test]
fn clear_delay_defaults_to_45_seconds() {
    assert_eq!(effective_clear_after_seconds(None), DEFAULT_CLEAR_AFTER_SECONDS);
    assert_eq!(DEFAULT_CLEAR_AFTER_SECONDS, 45);
}

#[test]
fn clear_delay_is_clamped_and_never_zero() {
    // Zero would mean "never clear by accident of timing" — clamp up.
    assert_eq!(effective_clear_after_seconds(Some(0)), MIN_CLEAR_AFTER_SECONDS);
    assert_eq!(effective_clear_after_seconds(Some(30)), 30);
    assert_eq!(
        effective_clear_after_seconds(Some(86_400)),
        MAX_CLEAR_AFTER_SECONDS
    );
}

#[test]
fn clears_only_when_clipboard_still_holds_our_value() {
    assert!(should_clear_clipboard(Some("hunter2"), "hunter2"));

    // The user copied something else afterwards — leave it alone.
    assert!(!should_clear_clipboard(Some("grocery list"), "hunter2"));

    // Clipboard already empty / non-text / unreadable — nothing to do.
    assert!(!should_clear_clipboard(None, "hunter2"));

    // Near-miss is not a match.
    assert!(!should_clear_clipboard(Some("hunter2 "), "hunter2"));
}
