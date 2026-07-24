# Pack-Editor Redesign — Overlay Editor UI (Plan 3b-2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble the React overlay pack editor over the pure core (`buildEditorView` + `editorEdits`), replacing the hint/credential two-mode toggle: the base form with any mix of module options toggled into view, one active editing target, section editing, module authoring, a selection-driven preview, and a save that writes the base pack (with `modules`) directly.

**Architecture:** `PackEditorApp` is rebuilt around three state atoms — `base: FormPack`, `viewSelections: Record<string,string|null>`, `activeTarget: EditTarget`. The Design view renders `buildEditorView(base, viewSelections)`; edits route through `editorEdits`; the modules side panel drives view toggles + the active target; Preview composes with `composePack`; Save posts the base pack (with `modules`) to a simplified dev save-plugin endpoint.

**Tech Stack:** React 19, TypeScript, Vitest + RTL, `@dnd-kit` (already used by `FieldList`). The pack editor lives under `apps/desktop/pack-editor/` and reuses components from `apps/desktop/src/forms/structure/`.

**Depends on:** Plan 3b editor core (`apps/desktop/src/creator/editorView.ts`, `editorEdits.ts`) and the section-extension engine (Plan 3a). Source spec: `docs/superpowers/specs/2026-07-23-pack-editor-authoring-redesign-design.md` (§4).

**IMPORTANT — the pack editor is excluded from `typecheck`/`lint`** (`apps/desktop/tsconfig.pack-editor.json`, `eslint.config.js` ignores `pack-editor`) but its tests run under Vitest. So: (a) every task must carry real RTL test coverage — the type/lint net doesn't cover `pack-editor/`; (b) run `npm --prefix apps/desktop run typecheck:pack-editor` after editor changes to catch type errors the main `typecheck` misses.

**Scope boundary:** This plan builds the editor UI and its new save path. **Plan 3c** then deletes the now-dead legacy credential tooling (`buildCredentialPack`/`deriveOverlay`/`renderSaveArtifacts`/the credential resource + Rust variant plumbing). Do NOT delete that tooling here — only stop the redesigned editor from using it.

All commands run from repo root. Test command shape: `npm --prefix apps/desktop run test -- <path>`. Read `apps/desktop/pack-editor/PackEditorApp.tsx`, `apps/desktop/pack-editor/PackEditorApp.test.tsx`, `apps/desktop/pack-editor/api.ts`, `apps/desktop/pack-editor/save-plugin.mjs`, and `apps/desktop/src/forms/structure/{FieldList,FieldPropertyPanel,SectionStructureEditor}.tsx` before starting.

---

## Task 1: Extend `editorEdits` with section routing

**Files:**
- Modify: `apps/desktop/src/creator/editorEdits.ts`
- Test: `apps/desktop/src/creator/editorEdits.test.ts` (append)

The core plan shipped field routing (`addFieldToTarget`/`removeInTarget`); the section-nav editing (Task 4) needs the symmetric section routing. `addSectionToTarget`: base target → append a `PackSection` to `pack.sections`; module target → append `{ order, section }` to that option's `addSections`. `removeSectionInTarget`: base target → drop the section from `pack.sections` (and defensively leave other sections' references alone); module target → add the sectionKey to that option's `removeSectionKeys` (no duplicates).

- [ ] **Step 1: Write failing tests** — append to `apps/desktop/src/creator/editorEdits.test.ts`:

```typescript
import { addSectionToTarget, removeSectionInTarget } from "./editorEdits";
import type { PackSection } from "../domain/formModel";

const NEW_SECTION: PackSection = {
  sectionKey: "crypto", title: "Crypto", lede: "", multiRecord: true, order: 5,
  readinessRule: { requiredKeys: ["walletName"] },
  kitMapping: { entries: [{ heading: "Crypto", fields: ["walletName"] }] },
  groups: [{ groupKey: "wallet", title: "Wallet", repeatable: false, order: 1, fields: [
    { systemKey: "walletName", label: "Wallet name", type: "text", required: true, protected: true, order: 1 },
  ] }],
};

describe("addSectionToTarget", () => {
  it("appends a section to the base pack when the target is base", () => {
    const out = addSectionToTarget(base(), BASE_TARGET, NEW_SECTION);
    expect(out.sections.map((s) => s.sectionKey)).toContain("crypto");
    expect(option(out, "secrets", "on").addSections ?? []).toHaveLength(0);
  });

  it("appends { order, section } to a module option's addSections when target is a module option", () => {
    const out = addSectionToTarget(base(), SECRETS_ON, NEW_SECTION);
    expect(out.sections.map((s) => s.sectionKey)).not.toContain("crypto"); // base untouched
    const added = option(out, "secrets", "on").addSections!;
    expect(added).toHaveLength(1);
    expect(added[0]!.section.sectionKey).toBe("crypto");
    expect(added[0]!.order).toBe(NEW_SECTION.order);
  });
});

describe("removeSectionInTarget", () => {
  it("drops the section from the base pack when the target is base", () => {
    const withSection = addSectionToTarget(base(), BASE_TARGET, NEW_SECTION);
    const out = removeSectionInTarget(withSection, BASE_TARGET, "crypto");
    expect(out.sections.map((s) => s.sectionKey)).not.toContain("crypto");
  });

  it("adds the sectionKey to a module option's removeSectionKeys when target is a module option", () => {
    const out = removeSectionInTarget(base(), SECRETS_ON, "devices");
    expect(out.sections.map((s) => s.sectionKey)).toContain("devices"); // base untouched
    expect(option(out, "secrets", "on").removeSectionKeys).toEqual(["devices"]);
  });

  it("does not duplicate a key already in removeSectionKeys", () => {
    const once = removeSectionInTarget(base(), SECRETS_ON, "devices");
    const twice = removeSectionInTarget(once, SECRETS_ON, "devices");
    expect(option(twice, "secrets", "on").removeSectionKeys).toEqual(["devices"]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm --prefix apps/desktop run test -- src/creator/editorEdits.test.ts`. Expected: `addSectionToTarget`/`removeSectionInTarget` undefined.

- [ ] **Step 3: Implement** — in `apps/desktop/src/creator/editorEdits.ts`, add (reuse the existing `updateOption`; add `PackSection` to the type import):

```typescript
export function addSectionToTarget(pack: FormPack, target: EditTarget, section: PackSection): FormPack {
  if (target.kind === "base") {
    return { ...pack, sections: [...pack.sections, section] };
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => ({
    ...option,
    addSections: [...(option.addSections ?? []), { order: section.order, section }],
  }));
}

export function removeSectionInTarget(pack: FormPack, target: EditTarget, sectionKey: string): FormPack {
  if (target.kind === "base") {
    return { ...pack, sections: pack.sections.filter((section) => section.sectionKey !== sectionKey) };
  }
  return updateOption(pack, target.moduleId, target.optionId, (option) => {
    const keys = option.removeSectionKeys ?? [];
    return keys.includes(sectionKey) ? option : { ...option, removeSectionKeys: [...keys, sectionKey] };
  });
}
```

- [ ] **Step 4: Run to verify PASS + typecheck + commit**

```bash
npm --prefix apps/desktop run test -- src/creator/editorEdits.test.ts
npm --prefix apps/desktop run typecheck
git add apps/desktop/src/creator/editorEdits.ts apps/desktop/src/creator/editorEdits.test.ts
git commit -m "feat(pack-editor): add section edit-routing helpers"
```

---

## Task 2: Editor shell — state atoms + modules side panel

**Files:**
- Modify: `apps/desktop/pack-editor/PackEditorApp.tsx`
- Modify: `apps/desktop/pack-editor/PackEditorApp.test.tsx`
- Modify: `apps/desktop/pack-editor/api.ts` (load returns the base pack directly — see Task 7 for save)

Replace the `packName: "hint" | "credential"` toggle and the `buildCredentialPack`-based load with the three-atom model: `base` (loaded pack), `viewSelections`, `activeTarget` (default `{ kind: "base" }`). Add a **modules panel**: for each `base.modules`, a control to pick which option is overlaid (`viewSelections[moduleId]`) and to set it as the active target; plus a "Base" active-target button. `api.getPack()` returns `{ pack }` (the base pack) instead of `{ hintPack, overlay }`.

- [ ] **Step 1** — write RTL tests in `PackEditorApp.test.tsx` asserting: the editor loads the base pack (no hint/credential toggle in the DOM); the modules panel lists each module by title; toggling a module's option overlays it (assert a module-added field appears in the Design view); selecting "Base" vs a module option sets the active target (assert an `aria-current`/active class on the chosen target). Mock `api.getPack` to return `{ pack: <a base pack with a secrets module> }`. Watch fail.

- [ ] **Step 2** — implement the state atoms and modules panel in `PackEditorApp.tsx`. Remove `packName` state, the `buildCredentialPack` import, and the pack-selector `<nav>`. Add:

```tsx
const [base, setBase] = useState<FormPack | null>(null);
const [viewSelections, setViewSelections] = useState<Record<string, string | null>>({});
const [activeTarget, setActiveTarget] = useState<EditTarget>({ kind: "base" });
```

Load: `getPack().then(({ pack }) => { setBase(pack); ... })`. Render a modules panel (each module: a select of its options bound to `viewSelections[moduleId]`, and a "Edit this layer" button setting `activeTarget` to `{ kind: "module", moduleId, optionId }`), plus a "Base" active-target button. Keep the section nav and Design/Preview/JSON tabs.

- [ ] **Step 3** — run `npm --prefix apps/desktop run test -- pack-editor/PackEditorApp.test.tsx` (green), `npm --prefix apps/desktop run typecheck:pack-editor` (clean). Commit: `feat(pack-editor): base/viewSelections/activeTarget state + modules panel`.

---

## Task 3: Overlay Design view

**Files:** `apps/desktop/pack-editor/PackEditorApp.tsx` (+ a new `apps/desktop/pack-editor/OverlayDesign.tsx`), test in `PackEditorApp.test.tsx`.

Render `buildEditorView(base, viewSelections)` as the Design view: fields grouped by section, each tagged by `source` (base plain; active-target items highlighted + editable; other overlays muted; `removed` struck-through). `+ Add field` and per-field remove route through `editorEdits.addFieldToTarget` / `removeInTarget` with `activeTarget`. Selecting a field opens it in the `FieldPropertyPanel` (edit routes to the owning layer via a new small helper `editFieldInLayer` — a follow-on to `editorEdits`; add it with tests when this task needs it). Surface `view.warnings` as an inline notice.

- [ ] **Step 1** — RTL tests: with `secrets:on` overlaid and active target `secrets:on`, adding a field appends it to the option's `addFields` (assert via a save spy or by re-reading state); a base field shows a remove control only when the active target is base or when removing-for-a-variant (module target) records a `removeKey`; a `removed` field renders with a struck-through / `data-removed` marker; a `warnings` entry renders as a notice. Watch fail.
- [ ] **Step 2** — implement `OverlayDesign.tsx` consuming `EditorView`; wire adds/removes through `editorEdits`. Reuse `FieldPropertyPanel` for the selected field.
- [ ] **Step 3** — test green, `typecheck:pack-editor` clean, commit: `feat(pack-editor): overlay Design view with provenance + active-target editing`.

---

## Task 4: Section nav editing

**Files:** `apps/desktop/pack-editor/PackEditorApp.tsx` (+ a `SectionNav.tsx`), test in `PackEditorApp.test.tsx`.

The left section list becomes editable: **rename** inline (routes to base `updateSection` title, or — if the section is module-added — the option's `addSections[].section.title`); **reorder** by `@dnd-kit` drag (rewrite base section `order`, reusing the `FieldList` dnd pattern); **add / delete** sections (through `editorEdits.addSectionToTarget`/`removeSectionInTarget` with the active target); **module membership** — with a module option active, an "add/remove this section in the option" control per base section, reflected as added/removed badges from `buildEditorView`.

- [ ] **Step 1** — RTL tests: rename a section updates its title; reorder changes order; "remove in this option" (module target) records a `removeSectionKey` (section shows struck-through); adding a new section with base target appends it. Watch fail.
- [ ] **Step 2** — implement `SectionNav.tsx`. For reorder, adapt `FieldList`'s `DndContext`/`SortableContext` usage. Route edits by active target.
- [ ] **Step 3** — test green, `typecheck:pack-editor` clean, commit: `feat(pack-editor): editable section nav (rename, reorder, add/remove, module membership)`.

---

## Task 5: Module authoring + property panels

**Files:** `apps/desktop/pack-editor/PackEditorApp.tsx` (+ `ModulePanel.tsx`, `SectionPropertyPanel.tsx`, `ModulePropertyPanel.tsx`), test in `PackEditorApp.test.tsx`.

- **Module authoring** — create a module (question, helperText, options with labels, default option); edit those; selecting an option sets the active target. New modules append to `base.modules`.
- **Property panels** — a **section property panel** (title, lede, multiRecord, readinessRule keys, kitMapping) editing the owning layer; a **module property panel** (question/options/default). Reuse the existing `FieldPropertyPanel` for fields.

- [ ] **Step 1** — RTL tests: create a module → it appears in the modules panel with its options; edit a section's `lede`/`multiRecord` → reflected in the saved base pack; edit a module's question → reflected. Watch fail.
- [ ] **Step 2** — implement the panels; module edits go through small immutable helpers (add to `editorEdits` or a new `moduleEdits.ts` with tests — keep each file focused).
- [ ] **Step 3** — test green, `typecheck:pack-editor` clean, commit: `feat(pack-editor): module authoring + section/module property panels`.

---

## Task 6: Preview

**Files:** `apps/desktop/pack-editor/PackEditorApp.tsx` (Preview tab), test in `PackEditorApp.test.tsx`.

Replace the current single-section preview with a **selection picker** (one option per module) feeding the real `FormRenderer` over `composePack(base, base.modules ?? [], selection)` — the exact end-user form for those choices, across all composed sections.

- [ ] **Step 1** — RTL test: pick `secrets:on` in the preview picker → the composed form renders the secret field (e.g. "Master password") via `FormRenderer`; pick a section-adding module → its section renders. Watch fail.
- [ ] **Step 2** — implement the picker + `composePack`-driven `FormRenderer` preview.
- [ ] **Step 3** — test green, `typecheck:pack-editor` clean, commit: `feat(pack-editor): selection-driven composed preview`.

---

## Task 7: Save the base pack with modules

**Files:**
- Modify: `apps/desktop/pack-editor/api.ts` (`savePack(base)` posts the base pack)
- Modify: `apps/desktop/pack-editor/save-plugin.mjs` (write `default-pack.json` directly; stop regenerating the credential pack / deriving the overlay)
- Modify: `apps/desktop/pack-editor/PackEditorApp.tsx` (Save button posts `base`)
- Test: a save-plugin unit test and/or an RTL save assertion

Save writes the edited `base` (with `modules`) straight to `default-pack.json`. Remove the save-plugin's `hintMode`/credential branch, the `buildCredentialPack`/`renderSaveArtifacts`/`deriveOverlay` imports, and the overlay read/write — the editor is now the single source and no longer generates the credential artifacts. Keep the "Back up packs" copy. Do NOT delete the credential files/tooling themselves (that is Plan 3c) — just stop the editor writing them.

- [ ] **Step 1** — test: saving posts the base pack (with `modules`) to the write endpoint; the written pack round-trips through `validatePack` OK; no credential regeneration occurs. Watch fail (current save regenerates credential).
- [ ] **Step 2** — implement the simplified `savePack`/save-plugin write path.
- [ ] **Step 3** — full suite + `typecheck:pack-editor` + commit: `feat(pack-editor): save base pack with modules; drop credential regeneration on save`.

---

## Self-Review

**Spec coverage (this plan = spec §4.1, §4.3–§4.7):**
- §4.1 shell state + modules panel → Task 2. ✓
- §4.3 overlay Design view + active-target editing → Task 3 (routes through `editorEdits`). ✓
- §4.4 section nav editing → Task 4 (+ section routing from Task 1). ✓
- §4.5 module authoring; §4.6 property panels → Task 5. ✓
- §4.7 preview → Task 6. ✓
- §5 save (editor side only) → Task 7. Legacy-tooling DELETION → **Plan 3c** (explicitly out of scope). ✓

**Placeholder scan:** Task 1 is fully coded (pure helpers). Tasks 2–7 are React-integration tasks specified by contract + representative code + explicit RTL test expectations rather than full hand-coded JSX, because they modify a large existing component (`PackEditorApp.tsx`) whose exact structure the implementer must read and adapt to — the acceptance criteria (what renders, what routes where, what the test asserts) are concrete. Small new immutable helpers (`editFieldInLayer`, module edits) are called out to be added with their own tests where a task needs them, keeping files focused.

**Type consistency:** `EditTarget` and `buildEditorView`/`editorEdits` signatures come from the merged core (Plan 3b). `PackSection`/`FormPack`/`FormModule` are the domain types. The pack editor's exclusion from the main `typecheck`/`lint` is handled by mandating `typecheck:pack-editor` + RTL coverage per task.

**Risk notes:**
- The pack editor has no type/lint safety net in the main gates — every task MUST add RTL tests and run `typecheck:pack-editor`.
- `PackEditorApp.tsx` is a large component; Tasks 2–6 extract focused subcomponents (`OverlayDesign`, `SectionNav`, `ModulePanel`, property panels) rather than growing one file.
- Task 7 stops the editor generating credential artifacts but must NOT delete them (Plan 3c). The old files remain on disk, just unwritten by the editor.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-pack-editor-overlay-ui.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, spec + code-quality review between tasks.
2. **Inline Execution** — batch execution with checkpoints.

After this lands, **Plan 3c** is a small, safe retirement: delete the now-unused `buildCredentialPack`/`deriveOverlay`/`renderSaveArtifacts`/credential resource/Rust `readDefaultPack` variant plumbing + the `build:credential-pack` script, guarded by a `git grep` proving no live references remain.
