# Pack-Editor Authoring Redesign — Design

**Date:** 2026-07-23
**Status:** Approved design.
**Scope:** The creator-facing authoring surface — extend the composition engine to section-level module operations, redesign the pack editor into an overlay editor that authors *base + modules* in one place, and retire the legacy credential-generation tooling. The **end-user runtime UI** (onboarding iterating modules, a general switch surface, removing `formMode`) is a **separate follow-up plan**, not covered here.

**Depends on:** the merged composition engine (`composePack`, module types, `validateModules` — PR #1) and load integration (`moduleSelections`, compose-at-load — PR #2).

---

## 1. Problem

The pack editor is now out of sync with how the app actually works. It still presents a **hint / credential two-mode toggle** and authors packs the old way — a hint pack plus a derived credential overlay (`buildCredentialPack` / `deriveOverlay` / `renderSaveArtifacts`). But the runtime no longer uses that: it composes a **base pack + declarative modules** at load. So a creator has no way to author modules, and the editor's mental model contradicts the shipped model. This is the original motivating complaint ("a single form editor for the base, and a separate editor for the deltas — the current setup is confusing"), now generalized to N modules.

Two gaps compound it:
- **Sections can't be edited at all.** The left-nav sections list is read-only — no rename, no reorder, no add/delete.
- **Modules can only touch fields.** The engine adds/removes fields *within* existing sections; it can't add, remove, or gate a **whole section** — which a real variant (e.g. a crypto-only section) needs.

## 2. Goals / Non-goals

**Goals**
- Extend the engine so a module option can **add or remove whole sections**, symmetric with its existing field add/remove.
- Redesign the pack editor into an **overlay editor**: the base form with any mix of module options toggled into view, module-added fields/sections shown inline at their real position, one active editing target for authoring.
- Make **sections first-class editable**: rename, reorder (drag-and-drop), add/delete, and set module membership.
- Author **modules** (question, options, default, per-option field/section ops) inside the editor.
- **Retire** the legacy credential-generation tooling entirely (the deferred Plan-2 cleanup).

**Non-goals (separate follow-up plan)**
- End-user onboarding UI iterating `base.modules`.
- A general end-user "change a module choice" settings surface.
- Removing `formMode` from the profile.

## 3. Engine extension — section-level module operations

Mirror the field model one level up.

### 3.1 Types (`formModel.ts`)

```ts
interface ModuleAddSection {
  /** Desired FINAL slot among sections; inserted at order-0.5 then renumbered. */
  order: number;
  section: PackSection;
}

interface FormModuleOption {
  optionId: string;
  label?: string;
  description?: string;
  addFields?: ModuleAddField[];
  removeKeys?: string[];
  kitAdditions?: Record<string, string[]>;
  addSections?: ModuleAddSection[];      // NEW
  removeSectionKeys?: string[];          // NEW
}
```

### 3.2 Composition (`composePack.ts`)

Within each selected option, apply in this fixed sub-order so later steps see a consistent pack: **removeSectionKeys → addSections → (existing) field removeKeys → addFields → kitAdditions.** (Sections resolve before field ops so an option that adds a section *and* adds fields into it works.)
- `removeSectionKeys`: drop matching sections, then renumber remaining section `order` to sequential integers.
- `addSections`: insert each `section` at `order − 0.5`, then renumber section orders — the identical trick used for fields.
- `composePack` continues to strip `modules` from its output (already in place, prevents re-compose duplication).

### 3.3 Validation (`packValidation.ts` `validateModules`)

- Each `addSections[].section` must pass `validateSection`.
- Added `sectionKey`s unique across the base and across all module-added sections; never added by two modules.
- `removeSectionKeys` must reference an existing base section; not removed by two modules.
- The existing "every option composes to a pack that passes `validatePack`" gate already covers downstream integrity (readiness/kit within added sections, dangling references, etc.).

## 4. The overlay editor

Replaces `PackEditorApp`'s hint/credential toggle and its `buildCredentialPack`-based load/save.

### 4.1 State

- `base: FormPack` — the editable base pack (carries `modules`).
- `viewSelections: Record<string, string | null>` — per module, which option is overlaid into the view (`null` = not overlaid).
- `activeTarget: { kind: "base" } | { kind: "module"; moduleId: string; optionId: string }` — the single layer new edits flow into.

### 4.2 The compose-with-provenance view (editor-only)

The runtime `composePack` deliberately discards provenance. The editor needs it, so it gets its own pure helper — `buildEditorView(base, viewSelections)` — that returns the composed sections/fields **annotated by source**: `base`, `added-by:<moduleId>:<optionId>`, or `removed-by:<moduleId>:<optionId>` (kept in the list but flagged struck-through). This is a new editor module, distinct from and not replacing `composePack`.

### 4.3 Main view (Design)

Renders `buildEditorView(base, viewSelections)`:
- Base fields/sections plain.
- Fields/sections added by the **active target** highlighted and fully editable.
- Fields/sections added by *other* overlaid options shown muted ("from module X") — visible for placement context; switch target to edit them.
- Removed items struck-through.
- `+ Add field` inserts into the active target at the placed position; drag-reorder writes order into the owning layer.

### 4.4 Section editing (left nav)

- **Rename** inline; **reorder** by drag-and-drop (rewrites base section `order`, or the module option's `addSections[].order` for a module-added section); **add / delete** sections.
- **Module membership** per section: a badge marks it base / added-by / removed-by. With a module option as the active target, each base section row gets an "add/remove in this option" control — the section-level analogue of the field target model.

### 4.5 Module & option authoring (side panel)

- Create a module; edit its **question**, **helperText**, **options** (each a label), and **default option**.
- Selecting an option sets it as the **active editing target**; its field- and section-ops are then authored inline.
- Binary (secrets on/off) and choice (file-method path/attach) modules are the same shape.

### 4.6 Property panel

Contextual to the selection: the existing `FieldPropertyPanel` for fields; a new **section property panel** (title, lede, multiRecord, readiness keys, kit mapping); a new **module property panel** (question, options, default).

### 4.7 Preview & JSON

- **Preview** tab: a **selection picker** (choose one option per module) feeding the real `FormRenderer` over `composePack(base, base.modules, selection)` — exactly what an end user with those choices sees.
- **JSON** tab: the base pack with embedded `modules` — the actual saved artifact.

## 5. Save & retirement

- **Save** writes the base pack (with `modules`) directly to `default-pack.json`, through a simplified dev save-plugin endpoint — no overlay derivation, no credential regeneration.
- **Retire** the entire legacy path:
  - `apps/desktop/src-tauri/resources/packs/default-pack-credential.json`, `apps/desktop/scripts/credential-overlay.json`
  - `apps/desktop/scripts/build-credential-pack.mjs`, `apps/desktop/scripts/lib/credential-pack.mjs` (+ `.d.mts`)
  - `apps/desktop/scripts/lib/save-artifacts.mjs`, `apps/desktop/scripts/lib/derive-overlay.mjs` (if used only by the pack editor / credential path — verify by grep)
  - `apps/desktop/src/domain/credentialPack.test.ts`, `saveArtifacts.test.ts`, `deriveOverlay.test.ts`
  - the `readDefaultPack` `variant` parameter and its Rust `pack_resource_for_variant` credential branch + credential resource registration
  - the `build:credential-pack` npm script
- The frozen `legacy-credential-pack.json` compatibility fixture/test from Plan 2 can be retired too once the `secrets` module is the sole source of the credential variant.

## 6. Scope boundary

This spec is entirely **creator/tooling side** and internally coupled (the engine section-extension, the editor that authors it, and the retirement of what the editor replaces). The **end-user runtime UI** — `SetupScreen` iterating modules, a general switch surface, `formMode` removal — is mechanical and end-user-facing, and becomes its own follow-up plan.

## 7. Testing strategy

- **Engine:** `composePack` section add / remove / renumber / ordering-relative-to-field-ops; `validateModules` section-op rules; an option that both adds a section and adds fields into it.
- **Editor view model:** `buildEditorView` provenance unit tests (base vs added vs removed; multiple overlays; active-target highlighting logic is derivable from its output).
- **Editor interactions** (`PackEditorApp.test.tsx`): add a field into a module target; add/remove a whole section via a module option; rename + reorder sections; author a module (question/options/default); preview composes for a chosen selection; save writes the base pack with `modules`.
- **Save-plugin:** POST writes `default-pack.json` with `modules`; no credential artifacts touched.
- **Retirement:** `git grep` proves no shipped `src/` reference to the deleted tooling; suite green after deletions.

## 8. Risks / open questions

- **Provenance view model** (`buildEditorView`) is the most complex new piece — it must stay a pure, well-tested function separate from `composePack`.
- **Retirement blast radius** — `derive-overlay.mjs`/`save-artifacts.mjs` may have non-credential importers; grep before deleting, and if shared, keep or refactor rather than delete.
- **Pack editor is excluded from `typecheck`/`lint`** (`tsconfig.pack-editor.json`, eslint ignores) but runs under Vitest — new editor logic must carry real test coverage since the type/lint safety net doesn't cover `pack-editor/`.
- **Added-section internals** — an added section brings its own protected fields, readiness rule, and kit mapping; validation must treat it like any base section (the "each option composes to a valid pack" gate enforces this).
- **Reorder semantics for module-added sections** — dragging a base section writes base order; dragging a module-added section writes that option's `addSections[].order`. The editor must route the reorder to the owning layer.
