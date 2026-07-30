# Module-driven onboarding & Settings page — design

**Date:** 2026-07-25
**Status:** Approved (brainstorm)

## Problem

The composable-modules engine is generic — `resolveBasePack` already composes
`composePack(base, base.modules, profile.moduleSelections)` over *all* modules.
But the two user-facing touchpoints are still hardwired to the single legacy
`secrets` question via `formMode`:

- **Onboarding (`SetupScreen`)** presents one binary radio ("Store locations only"
  vs "Store the actual secrets") and maps it through `moduleSelectionsFromFormMode`.
  The second shipped module, `file-method` (attach files vs. point to their
  location), is **never presented** — a new user silently gets its default (`path`).
- **In-app switching (`Dashboard` sidebar toggle → `handleSwitchMode`)** flips only
  `moduleSelections.secrets`. No other module is changeable in the app.

As the pack editor can author more modules, both surfaces must be **driven by the
pack's `modules` list** instead of the hardwired secrets binary.

## Goals

1. Onboarding asks one question per module, generated from `base.modules`.
2. A new **Settings page** hosts a generic **Vault options** section that lets the
   user change any module's selection after setup.
3. Retire the hardwired `formMode` binary UI; keep `formMode` only as a legacy
   back-compat field.
4. Rename the user-facing wording of the `secrets` module from "secrets" to
   **"passwords"** (consumer term); keep the internal `moduleId` stable.

## Non-goals (separate specs)

- **Change master password** and any other Settings sections. The Settings page is
  designed so these slot in later as sibling sections; none are built here.
- Renaming the internal `moduleId: "secrets"` or the `moduleSelections` keys (no
  data migration). Only display copy changes.
- Any change to `composePack`, the snapshot shape, or the load pipeline beyond what
  is listed under Data flow.

## Approach (chosen from brainstorm)

- **Onboarding:** stepped wizard, one module question per step (vs. a single
  stacked screen). More guided; each module is one step.
- **In-app settings:** a **dedicated Settings page** with a **Vault options**
  section listing all modules together and a single confirmed **Apply** (vs. a
  sidebar modal or per-row inline controls).

## Shared building blocks

Three small, independently-testable units so the wizard and the settings section
share logic rather than duplicate it:

### `ModuleQuestion` (presentational component)
Given one `FormModule`, the current selection, and an `onChange`, renders the
module's `question`, `helperText`, and its options as a radio group. Pure — no
composition or persistence. Consumed by both the wizard step and the Vault options
section. Location: `apps/desktop/src/forms/ModuleQuestion.tsx`.

### `useComposedPreview(base, selections)` (hook)
Wraps `composePack` + `mergePackWithOverlay` to return either the resolved sections
(for a `FormRenderer`/`PackPreview`) or a `previewError` string when the combination
is one `composePack` rejects. This is the pattern already inline in `PackEditorApp`
and `Dashboard`; extract it to `apps/desktop/src/domain/useComposedPreview.ts` and
reuse in the wizard preview, the Settings preview, and the invalid-combo guards.

### `applyModuleSelections(...)` (Dashboard action)
Generalizes today's `handleSwitchMode`: accepts a full `moduleSelections` map,
recomposes the pack, clears `customPack`, and persists through the existing
`persist()` CAS path — so reconcile archives orphaned values into archived answers
and the lock flow can await the in-flight save. Replaces the secrets-only
`handleSwitchMode`.

## Onboarding wizard (`SetupScreen`)

`SetupScreen` becomes a step machine driven by `base.modules`:

- **Step 1** — owner name + master password, including the existing "no password
  reset" warning. (Unchanged content; now framed as step 1 of N.)
- **Steps 2 … N+1** — one `ModuleQuestion` per module in `base.modules`, each
  pre-selecting the module's `defaultOptionId`, with a per-step "Preview this
  choice" backed by `useComposedPreview`. Back/Next navigation; the final module
  step's primary action is **Create vault**.
- On create, the wizard assembles a full `moduleSelections` map and passes it to
  `createVault` (see Data flow). If `base.modules` is empty, the wizard collapses to
  step 1 only.
- A progress indicator shows step position (e.g. dots or a bar).

The setup screen loads the bundled base pack (via `loadDefaultPack`) to enumerate
its modules for the steps and to power the previews.

## Settings page & Vault options section

- **New `Settings` route**, reached from a new "Settings" item in the sidebar.
  Simple single-column layout; sections stack vertically so future settings
  (change password, review cadence, …) add as siblings. Location:
  `apps/desktop/src/routes/SettingsPage.tsx`.
- **Vault options section** (`apps/desktop/src/routes/settings/VaultOptions.tsx`):
  - Renders a `ModuleQuestion` for each module in the loaded pack's `modules`.
  - Working selections are local state seeded from `profile.moduleSelections`.
  - **Apply changes** is enabled only when working selections differ from the saved
    ones. Clicking it opens a confirmation (the generalized switch-confirmation
    modal) explaining that forms rebuild, entered data is kept (orphaned values
    archived), and custom form edits are replaced; on confirm it calls
    `applyModuleSelections`.
  - **Preview what changes** uses `useComposedPreview` on the working selections.
  - If the loaded pack has no modules (a legacy `customPack` vault whose base
    predates modules), the section shows a quiet empty state instead of an empty box.
- The old sidebar mode toggle and `handleSwitchMode` are **removed**; Settings is
  the single home for changing module selections.

## Data flow & back-compat

- `moduleSelections` is the **source of truth** for composition (unchanged in
  `resolveBasePack`).
- The onboarding choice flows as `moduleSelections` (not a `formMode`) through the
  existing frontend hint plumbing. The Rust `createVault(masterPassword, ownerName)`
  command is **unchanged** — it never carried the mode:
  - `SetupScreen.onCreate(masterPassword, ownerName, moduleSelections)`.
  - `App.handleCreate` seeds the initial profile via
    `emptySnapshot(ownerName, moduleSelections)` and passes a `moduleSelectionsHint`
    (replacing `formModeHint`) to `Dashboard`.
  - `emptySnapshot` / `normalizeSnapshot` take `moduleSelections` instead of
    `formMode` to seed a fresh vault's profile.
- `profile.formMode` is retained **only** as a legacy field: on every save we keep
  it loosely synced to the `secrets` module (`secrets: "on"` → `"credential"`, else
  `"hint"`) so an older app build can still read the snapshot, but no new code reads
  `formMode` for behavior. The existing `moduleSelectionsFromFormMode` /
  `asModuleSelections` migration stays for reading old snapshots.
- **Invalid combinations** that `composePack` rejects disable Apply / block Create
  and surface the existing `previewError` message — never a silent broken compose.

## Copy changes ("secrets" → "passwords")

User-facing only; internal `moduleId: "secrets"` and option ids are unchanged.

- **Pack** (`default-pack.json`, `secrets` module): rewrite `title`, `question`, and
  `helperText` to use "passwords" (e.g. title "Store passwords", question "Do you
  want the vault to hold your actual passwords & PINs, or only where to find them?").
  Option labels become e.g. "Locations only" / "Store the actual passwords".
- **`user-guide.md`**: replace "secrets" wording in the setup-choice table, the
  "Changing what the vault stores" section, and the Recovery Kit note ("never
  includes secret values, even in passwords mode" → reworded).
- Any remaining hardcoded "secrets" UI strings removed with the old sidebar toggle.

## Components touched

| File | Change |
|---|---|
| `src/forms/ModuleQuestion.tsx` | **new** — presentational module question |
| `src/domain/useComposedPreview.ts` | **new** — compose+preview hook (extracted) |
| `src/routes/SettingsPage.tsx` | **new** — Settings route/shell |
| `src/routes/settings/VaultOptions.tsx` | **new** — generic Vault options section |
| `src/routes/SetupScreen.tsx` | wizard step machine over modules; emits `moduleSelections` |
| `src/routes/Dashboard.tsx` | `applyModuleSelections` replaces `handleSwitchMode`; sidebar toggle removed; "Settings" nav item |
| `src/domain/snapshot.ts` | `emptySnapshot`/`normalizeSnapshot` seed from `moduleSelections`; `formMode` loosely synced from `secrets` on save |
| `src/App.tsx` | route to Settings; `handleCreate` seeds via `moduleSelections`, passes `moduleSelectionsHint` (replaces `formModeHint`); Rust `createVault` unchanged |
| `resources/packs/default-pack.json` | `secrets` module copy → "passwords" |
| `docs/user-guide.md` | "secrets" → "passwords" wording |

## Testing

- **`ModuleQuestion`** — renders question/options, reflects selection, fires onChange.
- **`useComposedPreview`** — returns resolved sections for a valid combo; returns
  `previewError` for a combo `composePack` rejects.
- **Wizard** — one step per module; defaults pre-selected; Back/Next; Create passes
  the assembled `moduleSelections`; an invalid combo blocks Create with the error.
- **Settings / Vault options** — Apply disabled until a selection differs;
  confirm→apply recomposes, clears `customPack`, archives orphaned values; empty
  state when the pack has no modules.
- **Regression** — update existing `SetupScreen` and `Dashboard` mode tests for the
  wizard and the Settings relocation; assert `formMode` stays synced to `secrets`
  for back-compat.
- Conventions unchanged: Vitest + RTL, `vaultApi` mocked; assert both the
  definition/selection side and the composed entry form.

## Risks / notes

- Removing the sidebar toggle is a visible relocation; the regression tests and the
  `user-guide.md` "Changing what the vault stores" section must move to Settings.
- `formMode` staying loosely synced is deliberate belt-and-suspenders for snapshot
  back/forward compatibility; it is never a behavioral input.
