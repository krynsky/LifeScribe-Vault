/**
 * Auto-lock policy (U5). Compile-time constant, matching v1's 15 minutes.
 * The timer runs only while the dashboard is mounted — it is structurally
 * inert on the setup and locked screens.
 */

export const INACTIVITY_LOCK_MS = 15 * 60 * 1000;

/** Webview events that count as user activity and reset the timer. */
export const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown"] as const;
