# Form Editor Runtime Toggle — Design Spec

**Date:** 2026-06-17
**Status:** Approved

---

## Summary

Move the Pack Editor (Form Editor) from a compile-time `VITE_CREATOR_MODE` build flag to a runtime toggle any user can enable within the app. Edited form definitions are stored encrypted in the user's vault as a personal `customPack`, replacing the bundled default pack for that user only.

---

## Goals

- Any user can enable the Form Editor from within the running app — no env vars, no rebuild.
- Changes to form definitions are stored in the user's encrypted vault and affect only that user.
- The compile-time `VITE_CREATOR_MODE` gate is removed entirely.
- The "Write to source" developer escape hatch is removed from the UI.

## Non-Goals

- Sharing custom packs between users or devices.
- App-wide pack replacement (all users of an install see the change).
- Export/import of custom packs as files (can be a future follow-on).
- Resetting to the bundled default pack (follow-on).

---

## Architecture

### 1. Snapshot storage — `customPack`

`customPack?: FormPack` is added as a top-level field in the vault snapshot TypeScript type.

- `buildSnapshot` writes `customPack` into the snapshot object when it is present in vault state.
- `normalizeSnapshot` extracts `customPack` from the raw snapshot (undefined if absent).
- Rust treats the snapshot as opaque JSON — no Rust changes required for storage.

**Load pipeline:** After `normalizeSnapshot`, Dashboard checks for `customPack`. If present, it is used as the active `FormPack` directly (skipping `readDefaultPack()`). If absent, the bundled default pack is loaded as before. Either way the pack passes through the existing `mergePackWithOverlay → migrateVaultValues → reconcileSectionValues` pipeline unchanged.

### 2. Pack Editor save flow

`CreatorModePage` receives a new `onSave(pack: FormPack) => void` prop.

**"Save to vault" button (primary action):**
1. Runs the existing export validation pipeline: `validatePack` → `creatorOnlyErrors` → `validatePackUpgrade(strict: true)`.
2. On success, calls `onSave(validatedPack)`.
3. Dashboard's `onSave` handler stores the pack as `customPack` in vault state and immediately triggers a CAS snapshot save via the normal `saveVaultSnapshot` path.

**"Write to source" button:** Removed from the UI entirely.

**Error display:** Existing export error panel already surfaces validation failures — no new UI needed.

### 3. Sidebar toggle — pill switch

A toggle switch sits in the sidebar footer, above the Lock button, labelled **"Form Editor"**.

**Implementation:**
- Styled `<input type="checkbox">` with custom CSS track-and-thumb giving a pill-shaped on/off slider.
- Active state uses the existing teal/green accent color; inactive state uses a muted grey.
- Toggle state persisted in `localStorage` under key `lifescribe.packEditorEnabled`.
- Initial state read from localStorage on component mount.

**Behavior:**
- Toggling **on** adds a "Form Editor" item to the bottom of the sidebar nav list.
- Toggling **off** while the Form Editor route is active silently navigates to the welcome screen, then removes the nav item.

### 4. Build & Rust cleanup

**`vite.config.ts`:** Remove the `define` block for `VITE_CREATOR_MODE`. `CreatorModePage` is always included in the build as a lazy code-split chunk (loaded on first navigation, not in the initial bundle).

**`Dashboard.tsx`:** Replace the compile-time conditional lazy import with an unconditional `React.lazy(...)`. Replace `VITE_CREATOR_MODE` sidebar/route checks with the runtime `packEditorEnabled` state.

**`pack_resources.rs`:** Remove `#[cfg(feature = "creator-mode")]` from `write_pack_at_path` and `write_default_pack`. Both are always compiled. In a production install, `write_default_pack` returns a `FileOperation` error gracefully (the button is gone so this is never called).

**`lib.rs`:** Collapse to a single `generate_handler!` list that always includes `write_default_pack`.

**`Cargo.toml`:** The `creator-mode` feature remains as a declared no-op for stripped builds but is no longer required for normal operation.

---

## Data Flow

```
User toggles "Form Editor" ON
  → localStorage.setItem("lifescribe.packEditorEnabled", "true")
  → "Form Editor" nav item appears

User navigates to Form Editor
  → LazyCreatorModePage loads (code-split chunk)
  → Editor initialises with current active pack (customPack ?? bundledDefault)

User edits fields, clicks "Save to vault"
  → validatePack + creatorOnlyErrors + validatePackUpgrade(strict)
  → onSave(validatedPack) → Dashboard updates vault.customPack
  → saveVaultSnapshot (CAS) → encrypted snapshot written to SQLite

Next unlock
  → normalizeSnapshot extracts customPack
  → customPack used as active FormPack
  → user sees their customised forms
```

---

## Files Changed

| File | Change |
|---|---|
| `src/domain/snapshot.ts` | Add `customPack?: FormPack` to snapshot type, `buildSnapshot`, `normalizeSnapshot` |
| `src/routes/Dashboard.tsx` | Runtime toggle state + localStorage; unconditional lazy import; `onSave` handler; sidebar pill switch + nav item |
| `src/creator/CreatorModePage.tsx` | Add `onSave` prop; replace "Write to source" with "Save to vault" button |
| `src/api/vaultApi.ts` | No change |
| `vite.config.ts` | Remove `VITE_CREATOR_MODE` define |
| `src-tauri/src/pack_resources.rs` | Remove `cfg(feature = "creator-mode")` gates |
| `src-tauri/src/lib.rs` | Single handler list always including `write_default_pack` |

---

## Testing

- **`snapshot.test.ts`** (or colocated): round-trip `customPack` through `buildSnapshot` → `normalizeSnapshot`; confirm absent field returns `undefined`.
- **`Dashboard.test.tsx`**: toggle on → Form Editor nav item present; toggle off → absent; toggle off while on creator route → route resets to welcome.
- **`CreatorModePage.test.tsx`**: `onSave` called with validated pack after "Save to vault"; validation errors shown and `onSave` not called on invalid pack.
- All existing 250 frontend + 72 Rust tests continue to pass.
