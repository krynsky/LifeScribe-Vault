# Pack Editor UI v2 — Drag-and-drop + Property Panel + Tabs

**Date:** 2026-07-04
**Status:** Approved design, ready for implementation planning
**Builds on:** `docs/superpowers/specs/2026-07-04-credential-pack-editor-design.md` (the v1 editor)

## Problem

The v1 pack editor renders every field's full inline editor stacked on a design
pane, beside a second full form preview. It works, but:

- Reordering is up/down buttons — slow and clumsy for long sections.
- Every field shows all its controls at once — cluttered; hard to scan.
- The always-on two-pane (edit + preview of the same section) is heavy and
  caused the "Master password appears in both panes" test brittleness.
- Adding a field always adds a `text` field; the type must then be changed.

## Goal

Adopt the proven builder patterns from survey-creator (adapted to our data
model and laws) to make editing fast and legible:

- **Drag-and-drop reordering** of fields within a group.
- **Select-to-edit**: a compact field list on the left; a **property panel** on
  the right edits the one selected field.
- **Per-row adorners**: drag handle, duplicate, delete (delete gated to added
  fields, as in v1).
- **Design / Preview / JSON tabs** replacing the always-on two-pane.
- **Add-field type picker** (text / textarea / select / date).

## Scope

**In:** the five items above.

**Out (deferred):** Recovery-Kit membership toggle (the overlay encodes kit
*additions* only, not removals — needs a `kitRemovals` overlay extension);
collapsible group panels; declarative-condition (`visibleWhen`) editing;
group/section structural editing; editing the hint pack. Survey-creator's
Logic tab (expression strings) and Translations tab are permanently out — the
former violates "form definitions are data, no expression strings."

## Dependency

Add **`@dnd-kit/core`** and **`@dnd-kit/sortable`** (MIT, ~10 KB, keyboard-
accessible) as **devDependencies** of `apps/desktop`. Only the pack-editor
imports them; the Tauri app entry (`src/main.tsx`) never does, so they are not
in any shipped bundle. (Confirm via the editor being a separate Vite app — the
app build uses `index.html`/`src/main.tsx` only.)

## Architecture

The single `apps/desktop/pack-editor/PackEditorApp.tsx` splits into focused
components; all reuse the existing pure modules (`packEdits`, `FormRenderer`,
`mergePackWithOverlay`, `validatePack`, `deriveOverlay`).

### Components (all under `apps/desktop/pack-editor/`)

- **`PackEditorApp.tsx`** — shell. Owns state: `pack`, `hintPack`,
  `activeSection`, `selectedFieldKey`, `activeTab` (`"design" | "preview" |
  "json"`), and the save state. Renders the section nav, the tab bar, the active
  tab, and the save bar. Load/save flow is unchanged from v1.
- **`FieldList.tsx`** — the Design tab's left column: for the active section, a
  dnd-kit `SortableContext` per group with one sortable row per field. Each row:
  drag handle (`ti-grip-vertical`), label, type badge, and duplicate/delete
  adorners. Selecting a row sets `selectedFieldKey`. Below each group, the
  `AddFieldMenu`.
- **`FieldPropertyPanel.tsx`** — the Design tab's right column: edits the
  selected field — label, helper text, type, required, and (for `select`) the
  options list (add/remove option). Emits changes via `packEdits.updateField`.
  Shows an empty prompt when no field is selected.
- **`AddFieldMenu.tsx`** — the "Add field" control: a button that opens a small
  menu of field types; choosing one calls `addOptionalField(pack, sk, gk, type)`.
- **`PreviewTab`** — the existing read-only `FormRenderer` of the active section.
- **`JsonTab`** — a read-only `<pre>` of the overlay that would be saved:
  `JSON.stringify(deriveOverlay(hintPack, pack), null, 2)`.
- **`fieldOps.ts`** — pure, editor-local pack operations not general enough for
  `src/creator/packEdits`:
  - `reorderFields(pack, sectionKey, groupKey, fromIndex, toIndex)` — moves a
    field within a group and reassigns `order` to sequential integers (built on
    `updateGroup`).
  - `duplicateField(pack, sectionKey, groupKey, systemKey)` — clones the field
    as a new, non-protected added field with a fresh unique non-hint systemKey,
    inserted immediately after the original, group renumbered.

### Reuse (unchanged from v1)

`packEdits` (`updateField`, `removeField`, `addOptionalField`, `updateGroup`),
`FormRenderer` (preview + option-control patterns), `validatePack`,
`mergePackWithOverlay`, `buildCredentialPack`/`deriveOverlay`, and the `api.ts`
`getPack`/`savePack` seam. `InlineFieldEditor` is retired from the editor in
favor of the dedicated `FieldPropertyPanel` (the app itself still uses
`InlineFieldEditor` for its own inline editing — unchanged).

## Key interactions → data model

- **Reorder (drag):** dnd-kit `onDragEnd` yields the field's from/to index within
  its group → `reorderFields(...)`. The result is an internally consistent group
  (array order == `order` values), so `deriveOverlay` reproduces it (it emits
  `order` overrides only on a genuine reorder — already round-trip tested).
- **Duplicate:** `duplicateField(...)`. The clone has a new systemKey absent
  from the hint pack, so it is representable as an overlay `addedField`. Cloning
  a protected field yields a non-protected clone (added fields are optional).
- **Add with type:** `addOptionalField(pack, sk, gk, type)` — the type picker
  supplies the type; no post-hoc retype needed.
- **Delete:** unchanged — the delete adorner only appears for added fields (the
  overlay cannot encode removing a shared hint field; it would reappear on
  reload).
- **Edit props:** the property panel calls `updateField(pack, sk, gk, key,
  () => nextField)` on each change.

## Data flow

```
load    →  GET /__pack  →  buildCredentialPack  →  pack state
design  →  select field → property panel edits → packEdits.updateField
        →  drag row      → fieldOps.reorderFields
        →  duplicate     → fieldOps.duplicateField
        →  add (type)    → packEdits.addOptionalField(…, type)
        →  delete        → packEdits.removeField (added fields only)
preview →  read-only FormRenderer of the active section
json    →  read-only deriveOverlay(hintPack, pack)
save    →  validatePack (client) → POST /__pack → server derives overlay +
           regenerates pack → reload  (unchanged from v1)
```

## Error handling

- Save is unchanged: client `validatePack` before POST; failure shown in the UI,
  no request; server write errors surfaced.
- Reorder / duplicate / add all produce structurally valid packs; any invalid
  state (e.g. an emptied label) is caught by `validatePack` on save.
- The drift-guard and `deriveOverlay` round-trip tests continue to guarantee the
  overlay and committed pack stay in sync.

## Testing

- **`fieldOps.ts`** — unit tests: `reorderFields` produces the expected order
  and round-trips through `deriveOverlay`/`buildCredentialPack`; `duplicateField`
  inserts a distinct added field after the original and round-trips.
- **`FieldPropertyPanel`** — RTL: editing the label/helper/type updates the pack;
  the options editor adds/removes an option for a `select` field.
- **`AddFieldMenu`** — RTL: choosing "textarea" adds a textarea field.
- **Tabs** — RTL: switching to Preview shows the read-only field; switching to
  JSON shows the overlay text; Design shows the editor.
- **Save** — RTL (as v1): a property-panel edit + Save posts the edited pack;
  invalid pack blocks save with an alert.
- **Honest limitation:** real pointer-drag reordering is not exercisable in
  jsdom. The drag *handler* is covered via `reorderFields` unit tests; the drag
  *interaction* (pointer/keyboard sensors) is verified by manual smoke only. The
  plan will state this explicitly rather than assert false coverage.

## Out of scope (future)

- Recovery-Kit membership toggle (needs overlay `kitRemovals`).
- Collapsible group panels; group/section structural editing.
- Declarative `visibleWhen` condition editor.
- Drag-from-a-toolbox-palette to add (the type-picker add button covers adding).
