# Pack-Editor Redesign — Engine Section-Extension (Plan 3a of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the composition engine so a module option can add or remove **whole sections**, symmetric with its existing field add/remove — with zero UI change.

**Architecture:** `FormModuleOption` gains `addSections` (whole `PackSection` defs + placement `order`) and `removeSectionKeys`. `composePack` applies section removes then adds (insert at `order − 0.5`, renumber section orders) *before* its existing field ops, so an option that adds a section and adds fields into it works. `validateModules` validates the new ops the same way it validates field ops. Pure domain code; nothing UI-facing.

**Tech Stack:** TypeScript, Vitest. Files under `apps/desktop/src/domain/`.

**Decomposition — this is Plan 3a of 3:**
- **Plan 3a (this doc): Engine section-extension.** Types, `composePack` section ops, `validateModules` section rules. Pure, fully unit-tested, no UI change.
- **Plan 3b: Pack-editor overlay redesign.** The `buildEditorView` provenance helper, the overlay editor (active target, section editing, module authoring, preview), and the new save path.
- **Plan 3c: Credential-tooling retirement.** Delete the legacy credential generator/overlay/save-plugin path and the Rust `readDefaultPack` variant plumbing (tightly coupled to 3b's new save path).

Source spec: `docs/superpowers/specs/2026-07-23-pack-editor-authoring-redesign-design.md` (§3).

All commands run from repo root. Test command shape: `npm --prefix apps/desktop run test -- <path>`.

---

## Task 1: Section-op module types

**Files:**
- Modify: `apps/desktop/src/domain/formModel.ts` (add `ModuleAddSection`; extend `FormModuleOption`)

- [ ] **Step 1: Add `ModuleAddSection` and extend `FormModuleOption`**

In `formModel.ts`, add this interface next to `ModuleAddField` (just before `FormModuleOption`):

```typescript
/** A whole section a module option inserts, with its placement among sections. */
export interface ModuleAddSection {
  /** Desired FINAL slot among sections; inserted at order-0.5 then renumbered. */
  order: number;
  section: PackSection;
}
```

Then add the two new optional properties to the existing `FormModuleOption` interface:

```typescript
export interface FormModuleOption {
  optionId: string;
  label?: string;
  description?: string;
  addFields?: ModuleAddField[];
  removeKeys?: string[];
  kitAdditions?: Record<string, string[]>;
  /** Whole sections this option inserts into the composed pack. */
  addSections?: ModuleAddSection[];
  /** sectionKeys this option removes from the composed pack. */
  removeSectionKeys?: string[];
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm --prefix apps/desktop run typecheck`
Expected: no errors (additive, optional). `PackSection` is already declared above this point in the file.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/domain/formModel.ts
git commit -m "feat(modules): add section-level add/remove to module option types"
```

---

## Task 2: `composePack` section add/remove

**Files:**
- Modify: `apps/desktop/src/domain/composePack.ts`
- Test: `apps/desktop/src/domain/composePack.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `apps/desktop/src/domain/composePack.test.ts`. Add a two-section fixture and section tests (the existing file already imports `FormModule`, `FormPack`, `composePack`):

```typescript
function twoSectionBase(): FormPack {
  const first = basePack().sections[0]!; // the "devices" section
  return {
    ...basePack(),
    sections: [
      first,
      {
        sectionKey: "notes",
        title: "Notes",
        lede: "",
        multiRecord: false,
        order: 2,
        readinessRule: { requiredKeys: [] },
        kitMapping: { entries: [{ heading: "Notes", fields: [] }] },
        groups: [
          {
            groupKey: "note",
            title: "Note",
            repeatable: false,
            order: 1,
            fields: [
              { systemKey: "noteBody", label: "Note", type: "textarea", required: false, protected: false, order: 1 },
            ],
          },
        ],
      },
    ],
  };
}

const cryptoSection = {
  sectionKey: "crypto",
  title: "Crypto Wallets",
  lede: "",
  multiRecord: true,
  order: 2,
  readinessRule: { requiredKeys: ["walletName"] },
  kitMapping: { entries: [{ heading: "Crypto", fields: ["walletName"] }] },
  groups: [
    {
      groupKey: "wallet",
      title: "Wallet",
      repeatable: false,
      order: 1,
      fields: [
        { systemKey: "walletName", label: "Wallet name", type: "text", required: true, protected: true, order: 1 },
      ],
    },
  ],
};

describe("composePack — sections", () => {
  it("adds a whole section at the requested slot and renumbers section orders", () => {
    const addSectionModule: FormModule = {
      moduleId: "crypto", title: "Crypto", question: "?", order: 1, defaultOptionId: "off",
      options: [
        { optionId: "off" },
        { optionId: "on", addSections: [{ order: 2, section: cryptoSection }] },
      ],
    };
    const out = composePack(twoSectionBase(), [addSectionModule], { crypto: "on" });
    expect(out.sections.map((s) => s.sectionKey)).toEqual(["devices", "crypto", "notes"]);
    expect(out.sections.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it("removes a whole section by key and renumbers", () => {
    const removeSectionModule: FormModule = {
      moduleId: "trim", title: "Trim", question: "?", order: 1, defaultOptionId: "keep",
      options: [{ optionId: "keep" }, { optionId: "drop", removeSectionKeys: ["notes"] }],
    };
    const out = composePack(twoSectionBase(), [removeSectionModule], { trim: "drop" });
    expect(out.sections.map((s) => s.sectionKey)).toEqual(["devices"]);
    expect(out.sections.map((s) => s.order)).toEqual([1]);
  });

  it("default option is a no-op on sections", () => {
    const mod: FormModule = {
      moduleId: "crypto", title: "Crypto", question: "?", order: 1, defaultOptionId: "off",
      options: [{ optionId: "off" }, { optionId: "on", addSections: [{ order: 2, section: cryptoSection }] }],
    };
    const out = composePack(twoSectionBase(), [mod], {});
    expect(out.sections.map((s) => s.sectionKey)).toEqual(["devices", "notes"]);
  });

  it("an option can add a section and add a field into it in the same option", () => {
    const mod: FormModule = {
      moduleId: "crypto", title: "Crypto", question: "?", order: 1, defaultOptionId: "off",
      options: [
        { optionId: "off" },
        {
          optionId: "on",
          addSections: [{ order: 2, section: cryptoSection }],
          addFields: [
            {
              sectionKey: "crypto",
              groupKey: "wallet",
              order: 2,
              field: { systemKey: "walletSeedLocation", label: "Seed location", type: "text", required: false, protected: false, order: 2 },
            },
          ],
        },
      ],
    };
    const out = composePack(twoSectionBase(), [mod], { crypto: "on" });
    const crypto = out.sections.find((s) => s.sectionKey === "crypto")!;
    expect(crypto.groups[0]!.fields.map((f) => f.systemKey)).toEqual(["walletName", "walletSeedLocation"]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm --prefix apps/desktop run test -- src/domain/composePack.test.ts`. Expected: the four new tests fail (sections not added/removed; `addSections`/`removeSectionKeys` are ignored).

- [ ] **Step 3: Implement the section ops** — in `apps/desktop/src/domain/composePack.ts`:

Add `ModuleAddSection` to the type import:
```typescript
import type {
  FieldGroup,
  FormModule,
  FormModuleOption,
  FormPack,
  ModuleAddField,
  ModuleAddSection,
} from "./formModel";
```

Add these helpers (place them above `composePack`):
```typescript
function removeSections(pack: FormPack, keys: Set<string>): boolean {
  if (keys.size === 0) return false;
  const before = pack.sections.length;
  pack.sections = pack.sections.filter((section) => !keys.has(section.sectionKey));
  return pack.sections.length !== before;
}

function addSection(pack: FormPack, add: ModuleAddSection): void {
  // order-0.5 sorts the new section just ahead of whatever holds that slot.
  pack.sections.push({ ...add.section, order: add.order - 0.5 });
}

function renumberSections(pack: FormPack): void {
  pack.sections.sort((left, right) => left.order - right.order);
  pack.sections.forEach((section, index) => {
    section.order = index + 1;
  });
}
```

In `composePack`'s per-option loop body, apply section ops **before** the field ops. Replace the loop body so it reads:
```typescript
    const option = selectedOption(module, selections);
    if (!option) continue;
    // Sections first, so a field op in the same option can target a section this
    // option just added.
    let sectionsChanged = removeSections(pack, new Set(option.removeSectionKeys ?? []));
    for (const add of option.addSections ?? []) {
      addSection(pack, add);
      sectionsChanged = true;
    }
    if (sectionsChanged) renumberSections(pack);
    const touched = new Set<FieldGroup>();
    removeFields(pack, new Set(option.removeKeys ?? []), touched);
    for (const add of option.addFields ?? []) {
      addField(pack, add, touched);
    }
    renumber(touched);
    applyKitAdditions(pack, option.kitAdditions ?? {});
```

- [ ] **Step 4: Run to verify PASS** — `npm --prefix apps/desktop run test -- src/domain/composePack.test.ts` → all pass. Then run `npm --prefix apps/desktop run test -- src/domain/basePackModules.test.ts` to confirm the existing base-pack module composition is unaffected (the current modules use no section ops, so section handling is inert for them).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/domain/composePack.ts apps/desktop/src/domain/composePack.test.ts
git commit -m "feat(modules): compose whole-section add/remove in composePack"
```

---

## Task 3: `validateModules` section-op rules

**Files:**
- Modify: `apps/desktop/src/domain/packValidation.ts` (`validateModules`)
- Test: `apps/desktop/src/domain/packValidation.test.ts` (append to the `validateModules` describe block)

Rules (symmetric with the field rules already there): `removeSectionKeys` must reference an existing base section; an added `sectionKey` must not collide with a base section or a section added by another module. Deep validity of an added section (its fields, readiness, kit) and downstream integrity are already covered by the existing "every option composes to a pack that passes `validatePack`" gate.

- [ ] **Step 1: Write the failing tests** — append to the `validateModules` describe block in `apps/desktop/src/domain/packValidation.test.ts` (reuse its existing `moduleBasePack()` helper, which has a single `devices` section):

```typescript
  it("rejects removeSectionKeys that references an unknown section", () => {
    const mod: FormModule = {
      moduleId: "trim", title: "Trim", question: "?", order: 1, defaultOptionId: "keep",
      options: [{ optionId: "keep" }, { optionId: "drop", removeSectionKeys: ["ghost"] }],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [mod] }, composePack);
    expect(errors.join(" ")).toMatch(/unknown section/i);
  });

  it("rejects an added section whose key collides with a base section", () => {
    const mod: FormModule = {
      moduleId: "dup", title: "Dup", question: "?", order: 1, defaultOptionId: "off",
      options: [
        { optionId: "off" },
        {
          optionId: "on",
          addSections: [{ order: 2, section: {
            sectionKey: "devices", title: "Dupe", lede: "", multiRecord: false, order: 2,
            readinessRule: { requiredKeys: [] }, kitMapping: { entries: [{ heading: "x", fields: [] }] },
            groups: [{ groupKey: "g", title: "G", repeatable: false, order: 1, fields: [
              { systemKey: "gf", label: "GF", type: "text", required: false, protected: false, order: 1 },
            ] }],
          } }],
        },
      ],
    };
    const { errors } = validateModules({ ...moduleBasePack(), modules: [mod] }, composePack);
    expect(errors.join(" ")).toMatch(/collides with a base section|already exists/i);
  });

  it("rejects the same section key added by two different modules", () => {
    const makeAdder = (moduleId: string, order: number): FormModule => ({
      moduleId, title: moduleId, question: "?", order, defaultOptionId: "off",
      options: [
        { optionId: "off" },
        { optionId: "on", addSections: [{ order: 2, section: {
          sectionKey: "extra", title: "Extra", lede: "", multiRecord: false, order: 2,
          readinessRule: { requiredKeys: [] }, kitMapping: { entries: [{ heading: "x", fields: [] }] },
          groups: [{ groupKey: "g", title: "G", repeatable: false, order: 1, fields: [
            { systemKey: "gf", label: "GF", type: "text", required: false, protected: false, order: 1 },
          ] }],
        } }] },
      ],
    });
    const { errors } = validateModules(
      { ...moduleBasePack(), modules: [makeAdder("a", 1), makeAdder("b", 2)] },
      composePack,
    );
    expect(errors.join(" ")).toMatch(/section .* added by more than one module/i);
  });

  it("accepts a well-formed section-adding module", () => {
    const mod: FormModule = {
      moduleId: "crypto", title: "Crypto", question: "?", order: 1, defaultOptionId: "off",
      options: [
        { optionId: "off" },
        { optionId: "on", addSections: [{ order: 2, section: {
          sectionKey: "crypto", title: "Crypto", lede: "", multiRecord: true, order: 2,
          readinessRule: { requiredKeys: ["walletName"] },
          kitMapping: { entries: [{ heading: "Crypto", fields: ["walletName"] }] },
          groups: [{ groupKey: "wallet", title: "Wallet", repeatable: false, order: 1, fields: [
            { systemKey: "walletName", label: "Wallet name", type: "text", required: true, protected: true, order: 1 },
          ] }],
        } }] },
      ],
    };
    expect(validateModules({ ...moduleBasePack(), modules: [mod] }, composePack).errors).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify FAIL** — `npm --prefix apps/desktop run test -- src/domain/packValidation.test.ts`. Expected: the three rejection tests fail (no section-op validation yet; `removeSectionKeys:["ghost"]` is silently ignored, the collision cases may or may not be caught by the compose gate but not with these messages).

- [ ] **Step 3: Implement** — in `apps/desktop/src/domain/packValidation.ts`, inside `validateModules`. First index the base section keys (near where `baseFields` is built):

```typescript
  const baseSectionKeys = new Set(pack.sections.map((section) => section.sectionKey));
  const sectionAddedBy = new Map<string, string>(); // sectionKey -> moduleId
```

Then, inside the per-option loop (alongside the existing `removeKeys`/`addFields` checks), add:

```typescript
      for (const key of option.removeSectionKeys ?? []) {
        if (!baseSectionKeys.has(key)) {
          errors.push(`${label} option "${option.optionId}" removeSectionKeys references unknown section "${key}".`);
        }
      }
      for (const add of option.addSections ?? []) {
        const key = add.section.sectionKey;
        if (baseSectionKeys.has(key)) {
          errors.push(`${label} option "${option.optionId}" added section "${key}" collides with a base section.`);
        }
        const priorModule = sectionAddedBy.get(key);
        if (priorModule && priorModule !== module.moduleId) {
          errors.push(`Section "${key}" is added by more than one module ("${priorModule}" and "${module.moduleId}").`);
        }
        sectionAddedBy.set(key, module.moduleId);
      }
```

(The existing per-option `compose(pack, [module], …)` + `validatePack` gate at the end of `validateModules` already validates each added section's internal structure and all downstream integrity — no separate `validateSection` call is needed here, matching how field-add validity is delegated to that gate.)

- [ ] **Step 4: Run to verify PASS** — `npm --prefix apps/desktop run test -- src/domain/packValidation.test.ts` → all pass (existing + 4 new).

- [ ] **Step 5: Full suite + typecheck + lint + commit**

```bash
npm --prefix apps/desktop run test
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
git add apps/desktop/src/domain/packValidation.ts apps/desktop/src/domain/packValidation.test.ts
git commit -m "feat(modules): validate section add/remove module ops"
```

---

## Self-Review

**Spec coverage (this plan = spec §3):**
- §3.1 `ModuleAddSection` + option fields → Task 1. ✓
- §3.2 composePack section remove→add→renumber, before field ops → Task 2. ✓
- §3.3 validateModules section rules (removeSectionKeys exist, added key unique vs base + cross-module) → Task 3. ✓
- §4–§6 (editor, retirement, runtime UI) → Plans 3b / 3c / separate. Out of scope here.

**Placeholder scan:** No TBD/TODO; every code and test step is complete; commands and expected outcomes are explicit.

**Type consistency:** `ModuleAddSection` (`{ order, section }`) and the option fields (`addSections`, `removeSectionKeys`) are used identically in Tasks 1–3 and the tests. `composePack(base, modules, selections)` and `validateModules(pack, compose)` signatures are unchanged from the merged engine. Section-op ordering (sections before fields, remove before add, renumber) matches the spec §3.2.

**Risk note:** the section renumber reuses the field `order-0.5` insert trick; the "add section + add field into it in one option" test guards the sections-before-fields ordering. `composePack`'s existing `delete pack.modules` on output is unaffected.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-pack-editor-engine-section-extension.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, spec + code-quality review between tasks.
2. **Inline Execution** — batch execution with checkpoints.

After this lands, **Plan 3b (pack-editor overlay redesign)** builds the authoring UI on this extended engine, and **Plan 3c** retires the legacy credential tooling.
