# Pack Editor UI v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the dev-only pack editor with drag-and-drop field reordering, a select-to-edit property panel, per-row adorners, Design/Preview/JSON tabs, and an add-field type picker.

**Architecture:** Split the single `PackEditorApp.tsx` into focused components (`FieldList`, `FieldPropertyPanel`, sortable rows) under `apps/desktop/pack-editor/`. Reuse the pure `packEdits` ops plus two new editor-local ops in `fieldOps.ts`. Add `@dnd-kit` as a devDependency (only the pack-editor imports it, so it never ships). Save/derive/regenerate flow is unchanged from v1.

**Tech Stack:** React 19 + TypeScript, `@dnd-kit/core`/`sortable`/`utilities`, Vitest + RTL, the existing dev-only tooling (`credential-pack.mjs`, `derive-overlay.mjs`).

**Spec:** `docs/superpowers/specs/2026-07-04-pack-editor-ui-v2-design.md`

---

## Background the engineer needs

- The editor lives at `apps/desktop/pack-editor/` and is a separate Vite app (`vite.pack-editor.config.ts`, run via `npm --prefix apps/desktop run pack-editor`). It reuses modules from `../src`. It is NEVER bundled into the Tauri app (which uses `src/main.tsx`).
- Reusable pure ops from `../src/creator/packEdits` (immutable, return a new `FormPack`): `updateField(pack, sectionKey, groupKey, systemKey, updater)`, `removeField(pack, sectionKey, groupKey, systemKey)` (throws on protected), `addOptionalField(pack, sectionKey, groupKey, type?)`, `updateGroup(pack, sectionKey, groupKey, updater)`.
- Types from `../src/domain/formModel`: `FormPack`, `PackSection`, `FieldGroup`, `FieldDefinition`, `FieldOption`, `FieldType`, `FIELD_TYPES = ["text","textarea","date","select","email","phone"]`, and `isCustomFieldKey(systemKey)`.
- Dev tooling (`.mjs` with `.d.mts`): `buildCredentialPack(hint, overlay)`, `deriveOverlay(hint, credentialPack)` from `../scripts/lib/`.
- The editor talks to the dev server via `./api` (`getPack`, `savePack`) — mocked in tests.
- Current `PackEditorApp.tsx` (v1): loads the pack, renders a section nav, an edit pane (`FormRenderer` in editing mode) + a read-only preview pane, and a save bar. This plan replaces the edit pane with `FieldList` + `FieldPropertyPanel` and moves the preview into a tab.
- Run tests: `npm --prefix apps/desktop run test -- <substring>`. Editor typecheck: `npm --prefix apps/desktop run typecheck:pack-editor`.
- The editor uses plain unicode glyphs for icon buttons (matching `InlineFieldEditor`'s `↑ ↓ ✕`), each with an `aria-label`. No icon-font dependency.

## File structure

- `apps/desktop/package.json` — add `@dnd-kit/*` devDependencies. (Task 1)
- `apps/desktop/pack-editor/fieldOps.ts` (+ `fieldOps.test.ts`) — `reorderFields`, `duplicateField`. (Task 1)
- `apps/desktop/pack-editor/FieldPropertyPanel.tsx` (+ `.test.tsx`) — edits one field. (Task 2)
- `apps/desktop/pack-editor/FieldList.tsx` (+ `.test.tsx`) — sortable rows + adorners + add-menu. (Task 3)
- `apps/desktop/pack-editor/pack-editor.css` — editor layout styles (imported by `main.tsx`, NOT by the app). (Task 4)
- `apps/desktop/pack-editor/PackEditorApp.tsx` + `.test.tsx` — integrate list+panel; then tabs. (Tasks 4–5)

---

## Task 1: `@dnd-kit` + `fieldOps` (reorder, duplicate)

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/pack-editor/fieldOps.ts`
- Test: `apps/desktop/pack-editor/fieldOps.test.ts`

- [ ] **Step 1: Install @dnd-kit (devDependencies)**

Run:
```bash
npm --prefix apps/desktop install --save-dev @dnd-kit/core@^6 @dnd-kit/sortable@^8 @dnd-kit/utilities@^3
```
Expected: the three packages appear under `devDependencies` in `apps/desktop/package.json`.

- [ ] **Step 2: Write the failing tests**

Create `apps/desktop/pack-editor/fieldOps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import hintPack from "../src-tauri/resources/packs/default-pack.json";
import overlay from "../scripts/credential-overlay.json";
import { buildCredentialPack } from "../scripts/lib/credential-pack.mjs";
import { deriveOverlay } from "../scripts/lib/derive-overlay.mjs";
import type { FormPack } from "../src/domain/formModel";
import { duplicateField, reorderFields } from "./fieldOps";

const hint = hintPack as unknown as Record<string, unknown>;

function group(pack: FormPack, sectionKey: string, groupKey: string) {
  return pack.sections
    .find((s) => s.sectionKey === sectionKey)!
    .groups.find((g) => g.groupKey === groupKey)!;
}

describe("reorderFields", () => {
  it("moves a field and renumbers order to sequential integers", () => {
    const pack = buildCredentialPack(hint, overlay) as FormPack;
    // devices/device order: deviceName(1) deviceType(2) deviceOwner(3) devicePin(4) ...
    const next = reorderFields(pack, "devices", "device", 1, 3); // deviceType -> slot 4
    const keys = [...group(next, "devices", "device").fields]
      .sort((a, b) => a.order - b.order)
      .map((f) => f.systemKey);
    expect(keys.slice(0, 4)).toEqual([
      "deviceName",
      "deviceOwner",
      "devicePin",
      "deviceType",
    ]);
    expect(group(next, "devices", "device").fields.map((f) => f.order).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("round-trips through derive + generate", () => {
    const pack = buildCredentialPack(hint, overlay) as FormPack;
    const next = reorderFields(pack, "devices", "device", 1, 2);
    expect(buildCredentialPack(hint, deriveOverlay(hint, next))).toEqual(next);
  });
});

describe("duplicateField", () => {
  it("inserts a distinct added clone right after the original", () => {
    const pack = buildCredentialPack(hint, overlay) as FormPack;
    const next = duplicateField(pack, "password-manager", "plan", "passwordManagerMasterPassword");
    const fields = [...group(next, "password-manager", "plan").fields].sort((a, b) => a.order - b.order);
    const idx = fields.findIndex((f) => f.systemKey === "passwordManagerMasterPassword");
    const clone = fields[idx + 1]!;
    expect(clone.systemKey).not.toBe("passwordManagerMasterPassword");
    expect(clone.label).toBe("Master password");
    expect(clone.protected).toBe(false);
    // the clone is a NEW key not present in the hint pack (an added field)
    expect(clone.systemKey.startsWith("field_")).toBe(true);
  });

  it("round-trips through derive + generate", () => {
    const pack = buildCredentialPack(hint, overlay) as FormPack;
    const next = duplicateField(pack, "devices", "device", "devicePin");
    expect(buildCredentialPack(hint, deriveOverlay(hint, next))).toEqual(next);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --prefix apps/desktop run test -- fieldOps`
Expected: FAIL — `fieldOps` module not found.

- [ ] **Step 4: Implement `fieldOps.ts`**

Create `apps/desktop/pack-editor/fieldOps.ts`:

```ts
import { updateGroup } from "../src/creator/packEdits";
import type { FieldGroup, FormPack } from "../src/domain/formModel";
import { isCustomFieldKey } from "../src/domain/formModel";

function renumbered(fields: FieldGroup["fields"]): FieldGroup["fields"] {
  return fields.map((field, index) => ({ ...field, order: index + 1 }));
}

function uniqueFieldKey(existing: Set<string>): string {
  let key = "";
  do {
    key = `field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  } while (existing.has(key) || isCustomFieldKey(key));
  return key;
}

/**
 * Move a field within a group from one display position to another, then
 * renumber `order` to sequential integers so the group stays internally
 * consistent (array order == order-value order) — which deriveOverlay requires.
 */
export function reorderFields(
  pack: FormPack,
  sectionKey: string,
  groupKey: string,
  fromIndex: number,
  toIndex: number,
): FormPack {
  return updateGroup(pack, sectionKey, groupKey, (group) => {
    const sorted = [...group.fields].sort((a, b) => a.order - b.order);
    if (fromIndex < 0 || fromIndex >= sorted.length) return group;
    const [moved] = sorted.splice(fromIndex, 1);
    sorted.splice(toIndex, 0, moved!);
    return { ...group, fields: renumbered(sorted) };
  });
}

/**
 * Clone a field as a new, non-protected added field with a fresh systemKey that
 * is absent from any pack (so it reads as an overlay-representable added field),
 * inserted immediately after the original. The group is renumbered.
 */
export function duplicateField(
  pack: FormPack,
  sectionKey: string,
  groupKey: string,
  systemKey: string,
): FormPack {
  return updateGroup(pack, sectionKey, groupKey, (group) => {
    const sorted = [...group.fields].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((f) => f.systemKey === systemKey);
    if (index === -1) return group;
    const existing = new Set(group.fields.map((f) => f.systemKey));
    const clone = {
      ...sorted[index]!,
      systemKey: uniqueFieldKey(existing),
      protected: false,
    };
    sorted.splice(index + 1, 0, clone);
    return { ...group, fields: renumbered(sorted) };
  });
}
```

- [ ] **Step 5: Run tests + editor typecheck**

Run: `npm --prefix apps/desktop run test -- fieldOps`
Expected: PASS (4).

Run: `npm --prefix apps/desktop run typecheck:pack-editor`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
# Under npm workspaces the lockfile is the repo-root package-lock.json. Stage
# whichever lockfile actually changed (check `git status`).
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/package.json package-lock.json apps/desktop/pack-editor/fieldOps.ts apps/desktop/pack-editor/fieldOps.test.ts
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(pack-editor): add @dnd-kit and reorder/duplicate field ops"
```

---

## Task 2: `FieldPropertyPanel`

**Files:**
- Create: `apps/desktop/pack-editor/FieldPropertyPanel.tsx`
- Test: `apps/desktop/pack-editor/FieldPropertyPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/pack-editor/FieldPropertyPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FieldDefinition } from "../src/domain/formModel";
import { FieldPropertyPanel } from "./FieldPropertyPanel";

const field: FieldDefinition = {
  systemKey: "demoField",
  label: "Demo",
  helperText: "help",
  type: "text",
  required: false,
  protected: false,
  order: 1,
};

describe("FieldPropertyPanel", () => {
  it("shows an empty prompt when no field is selected", () => {
    render(<FieldPropertyPanel field={null} onChange={vi.fn()} />);
    expect(screen.getByText(/select a field/i)).toBeInTheDocument();
  });

  it("emits label edits", async () => {
    const onChange = vi.fn();
    render(<FieldPropertyPanel field={field} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Label"), "!");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "Demo!" }),
    );
  });

  it("changes the type", async () => {
    const onChange = vi.fn();
    render(<FieldPropertyPanel field={field} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Type"), "textarea");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "textarea" }),
    );
  });

  it("adds an option for a select field", async () => {
    const onChange = vi.fn();
    const selectField: FieldDefinition = { ...field, type: "select", options: [] };
    render(<FieldPropertyPanel field={selectField} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Option value"), "yes");
    await userEvent.type(screen.getByLabelText("Option label"), "Yes");
    await userEvent.click(screen.getByRole("button", { name: /add option/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: [{ value: "yes", label: "Yes" }] }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/desktop run test -- FieldPropertyPanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FieldPropertyPanel.tsx`**

Create `apps/desktop/pack-editor/FieldPropertyPanel.tsx`:

```tsx
import { useState } from "react";
import type { FieldDefinition, FieldOption, FieldType } from "../src/domain/formModel";
import { FIELD_TYPES } from "../src/domain/formModel";

export interface FieldPropertyPanelProps {
  field: FieldDefinition | null;
  onChange: (updated: FieldDefinition) => void;
}

export function FieldPropertyPanel({ field, onChange }: FieldPropertyPanelProps) {
  const [optionValue, setOptionValue] = useState("");
  const [optionLabel, setOptionLabel] = useState("");

  if (!field) {
    return (
      <div className="field-panel field-panel--empty">
        <p>Select a field to edit its properties.</p>
      </div>
    );
  }

  function addOption() {
    const value = optionValue.trim();
    const label = optionLabel.trim();
    if (!value || !label) return;
    const next: FieldOption = { value, label };
    onChange({ ...field!, options: [...(field!.options ?? []), next] });
    setOptionValue("");
    setOptionLabel("");
  }

  return (
    <div className="field-panel">
      <label className="field-panel__control">
        <span>Label</span>
        <input
          type="text"
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
        />
      </label>

      <label className="field-panel__control">
        <span>Helper text</span>
        <textarea
          rows={3}
          value={field.helperText ?? ""}
          onChange={(e) =>
            onChange({ ...field, helperText: e.target.value || undefined })
          }
        />
      </label>

      <label className="field-panel__control">
        <span>Type</span>
        <select
          value={field.type}
          onChange={(e) => onChange({ ...field, type: e.target.value as FieldType })}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="field-panel__check">
        <input
          type="checkbox"
          checked={field.required}
          disabled={field.protected}
          onChange={(e) => {
            if (!e.target.checked && field.protected) return;
            onChange({ ...field, required: e.target.checked });
          }}
        />
        <span>Required</span>
      </label>

      {field.type === "select" ? (
        <div className="field-panel__options">
          <span className="field-panel__options-title">Options</span>
          {(field.options ?? []).length > 0 ? (
            <ul>
              {(field.options ?? []).map((opt, i) => (
                <li key={opt.value}>
                  <span>
                    <strong>{opt.value}</strong>: {opt.label}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove option ${opt.label}`}
                    className="button button--ghost button--small"
                    onClick={() =>
                      onChange({
                        ...field,
                        options: (field.options ?? []).filter((_, j) => j !== i),
                      })
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="field-panel__option-add">
            <input
              type="text"
              aria-label="Option value"
              placeholder="value"
              value={optionValue}
              onChange={(e) => setOptionValue(e.target.value)}
            />
            <input
              type="text"
              aria-label="Option label"
              placeholder="Display label"
              value={optionLabel}
              onChange={(e) => setOptionLabel(e.target.value)}
            />
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={addOption}
            >
              Add option
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test + editor typecheck**

Run: `npm --prefix apps/desktop run test -- FieldPropertyPanel`
Expected: PASS (4).

Run: `npm --prefix apps/desktop run typecheck:pack-editor`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/pack-editor/FieldPropertyPanel.tsx apps/desktop/pack-editor/FieldPropertyPanel.test.tsx
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(pack-editor): field property panel"
```

---

## Task 3: `FieldList` (sortable rows + adorners + add menu)

**Files:**
- Create: `apps/desktop/pack-editor/FieldList.tsx`
- Test: `apps/desktop/pack-editor/FieldList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/pack-editor/FieldList.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FieldGroup } from "../src/domain/formModel";
import { FieldList } from "./FieldList";

const groups: FieldGroup[] = [
  {
    groupKey: "g1",
    title: "Group one",
    repeatable: false,
    order: 1,
    fields: [
      { systemKey: "hintOne", label: "Hint one", type: "text", required: false, protected: false, order: 1 },
      { systemKey: "field_added", label: "Added", type: "text", required: false, protected: false, order: 2 },
    ],
  },
];

function renderList(overrides = {}) {
  const props = {
    groups,
    selectedKey: null as string | null,
    hintKeys: new Set(["hintOne"]),
    onSelect: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onAdd: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  render(<FieldList {...props} />);
  return props;
}

describe("FieldList", () => {
  it("selects a field when its row is clicked", async () => {
    const props = renderList();
    await userEvent.click(screen.getByRole("button", { name: /edit field Hint one/i }));
    expect(props.onSelect).toHaveBeenCalledWith("hintOne");
  });

  it("duplicates a field", async () => {
    const props = renderList();
    const row = screen.getByRole("button", { name: /edit field Added/i }).closest(".field-row")!;
    await userEvent.click(within(row as HTMLElement).getByRole("button", { name: /duplicate/i }));
    expect(props.onDuplicate).toHaveBeenCalledWith("g1", "field_added");
  });

  it("offers delete only for added (non-hint) fields", () => {
    renderList();
    const hintRow = screen.getByRole("button", { name: /edit field Hint one/i }).closest(".field-row")!;
    const addedRow = screen.getByRole("button", { name: /edit field Added/i }).closest(".field-row")!;
    expect(within(hintRow as HTMLElement).queryByRole("button", { name: /remove field/i })).toBeNull();
    expect(within(addedRow as HTMLElement).getByRole("button", { name: /remove field/i })).toBeInTheDocument();
  });

  it("adds a field of the chosen type", async () => {
    const props = renderList();
    await userEvent.selectOptions(screen.getByLabelText(/add field to Group one/i), "textarea");
    expect(props.onAdd).toHaveBeenCalledWith("g1", "textarea");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/desktop run test -- FieldList`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FieldList.tsx`**

Create `apps/desktop/pack-editor/FieldList.tsx`:

```tsx
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FieldDefinition, FieldGroup, FieldType } from "../src/domain/formModel";
import { FIELD_TYPES } from "../src/domain/formModel";

export interface FieldListProps {
  groups: FieldGroup[];
  selectedKey: string | null;
  /** systemKeys present in the hint pack — these cannot be deleted. */
  hintKeys: Set<string>;
  onSelect: (systemKey: string) => void;
  onDuplicate: (groupKey: string, systemKey: string) => void;
  onDelete: (groupKey: string, systemKey: string) => void;
  onAdd: (groupKey: string, type: FieldType) => void;
  onReorder: (groupKey: string, fromIndex: number, toIndex: number) => void;
}

interface RowProps {
  field: FieldDefinition;
  groupKey: string;
  selected: boolean;
  deletable: boolean;
  onSelect: (systemKey: string) => void;
  onDuplicate: (groupKey: string, systemKey: string) => void;
  onDelete: (groupKey: string, systemKey: string) => void;
}

function FieldRow({ field, groupKey, selected, deletable, onSelect, onDuplicate, onDelete }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.systemKey,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={selected ? "field-row field-row--selected" : "field-row"}
    >
      <button
        type="button"
        className="field-row__handle"
        aria-label={`Drag to reorder ${field.label}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <button
        type="button"
        className="field-row__label"
        aria-label={`Edit field ${field.label}`}
        onClick={() => onSelect(field.systemKey)}
      >
        {field.label}
      </button>
      <span className="field-row__type">{field.type}</span>
      <button
        type="button"
        className="button button--ghost button--small"
        aria-label={`Duplicate ${field.label}`}
        onClick={() => onDuplicate(groupKey, field.systemKey)}
      >
        ⧉
      </button>
      {deletable ? (
        <button
          type="button"
          className="button button--ghost button--small"
          aria-label={`Remove field ${field.label}`}
          onClick={() => onDelete(groupKey, field.systemKey)}
        >
          ✕
        </button>
      ) : null}
    </li>
  );
}

export function FieldList({
  groups,
  selectedKey,
  hintKeys,
  onSelect,
  onDuplicate,
  onDelete,
  onAdd,
  onReorder,
}: FieldListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <div className="field-list">
      {groups.map((group) => {
        const sorted = [...group.fields].sort((a, b) => a.order - b.order);
        const ids = sorted.map((f) => f.systemKey);
        const handleDragEnd = (event: DragEndEvent) => {
          const { active, over } = event;
          if (!over || active.id === over.id) return;
          const from = ids.indexOf(String(active.id));
          const to = ids.indexOf(String(over.id));
          if (from !== -1 && to !== -1) onReorder(group.groupKey, from, to);
        };
        return (
          <section key={group.groupKey} className="field-list__group">
            <h3 className="field-list__group-title">{group.title}</h3>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <ul className="field-list__rows">
                  {sorted.map((field) => (
                    <FieldRow
                      key={field.systemKey}
                      field={field}
                      groupKey={group.groupKey}
                      selected={field.systemKey === selectedKey}
                      deletable={!hintKeys.has(field.systemKey)}
                      onSelect={onSelect}
                      onDuplicate={onDuplicate}
                      onDelete={onDelete}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            <label className="field-list__add">
              <span className="sr-only">{`Add field to ${group.title}`}</span>
              <select
                aria-label={`Add field to ${group.title}`}
                value=""
                onChange={(e) => {
                  if (e.target.value) onAdd(group.groupKey, e.target.value as FieldType);
                  e.target.value = "";
                }}
              >
                <option value="">+ Add field…</option>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </section>
        );
      })}
    </div>
  );
}
```

Note: real pointer-drag is not exercisable in jsdom; the `onReorder` handler is covered by the `fieldOps` unit tests (Task 1) and the drag interaction is verified by manual smoke (final verification). The RTL tests here cover selection, duplicate, delete-gating, and add.

- [ ] **Step 4: Run test + editor typecheck**

Run: `npm --prefix apps/desktop run test -- FieldList`
Expected: PASS (4).

Run: `npm --prefix apps/desktop run typecheck:pack-editor`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/pack-editor/FieldList.tsx apps/desktop/pack-editor/FieldList.test.tsx
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(pack-editor): sortable field list with adorners and add menu"
```

---

## Task 4: Integrate list + panel into the editor (Design view) + styles

**Files:**
- Create: `apps/desktop/pack-editor/pack-editor.css`
- Modify: `apps/desktop/pack-editor/main.tsx` (import the css)
- Modify: `apps/desktop/pack-editor/PackEditorApp.tsx`
- Modify: `apps/desktop/pack-editor/PackEditorApp.test.tsx`

- [ ] **Step 1: Update the PackEditorApp tests for the new Design UI**

Replace the body of `apps/desktop/pack-editor/PackEditorApp.test.tsx` with (this drops the v1 two-pane assumptions and asserts the list+panel flow; the smoke test now finds the field's row button):

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import defaultPack from "../src-tauri/resources/packs/default-pack.json";
import overlay from "../scripts/credential-overlay.json";
import type { FormPack } from "../src/domain/formModel";
import * as api from "./api";
import { PackEditorApp } from "./PackEditorApp";

const hintPack = defaultPack as unknown as FormPack;

vi.mock("./api", () => ({ getPack: vi.fn(), savePack: vi.fn() }));
const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getPack.mockResolvedValue({ hintPack, overlay });
});

async function openPasswordManager() {
  render(<PackEditorApp />);
  await userEvent.click(await screen.findByRole("button", { name: /password manager plan/i }));
}

describe("PackEditorApp", () => {
  it("lists the credential-only field row after loading", async () => {
    await openPasswordManager();
    expect(
      await screen.findByRole("button", { name: /edit field Master password/i }),
    ).toBeInTheDocument();
  });

  it("selecting a field edits it in the property panel and saves", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    await openPasswordManager();
    await userEvent.click(await screen.findByRole("button", { name: /edit field Master password/i }));

    const label = screen.getByLabelText("Label");
    await userEvent.clear(label);
    await userEvent.type(label, "Vault master password");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mocked.savePack).toHaveBeenCalledTimes(1);
    const saved = mocked.savePack.mock.calls[0]![0];
    const field = saved.sections
      .find((s) => s.sectionKey === "password-manager")!
      .groups.flatMap((g) => g.fields)
      .find((f) => f.systemKey === "passwordManagerMasterPassword")!;
    expect(field.label).toBe("Vault master password");
  });

  it("blocks save with an alert when a label is emptied", async () => {
    mocked.savePack.mockResolvedValue(undefined);
    await openPasswordManager();
    await userEvent.click(await screen.findByRole("button", { name: /edit field Master password/i }));
    await userEvent.clear(screen.getByLabelText("Label"));
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mocked.savePack).not.toHaveBeenCalled();
  });

  it("removes an added field", async () => {
    await openPasswordManager();
    await userEvent.click(
      screen.getByRole("button", { name: /remove field Master password/i }),
    );
    expect(
      screen.queryByRole("button", { name: /edit field Master password/i }),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix apps/desktop run test -- PackEditorApp`
Expected: FAIL — the new list/panel UI does not exist yet.

- [ ] **Step 3: Rewrite `PackEditorApp.tsx` to use the list + panel**

Replace `apps/desktop/pack-editor/PackEditorApp.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { buildCredentialPack } from "../scripts/lib/credential-pack.mjs";
import {
  addOptionalField,
  removeField,
  updateField,
} from "../src/creator/packEdits";
import type { FieldType, FormPack } from "../src/domain/formModel";
import { validatePack } from "../src/domain/packValidation";
import { FieldList } from "./FieldList";
import { FieldPropertyPanel } from "./FieldPropertyPanel";
import { duplicateField, reorderFields } from "./fieldOps";
import { getPack, savePack } from "./api";

type Status = "loading" | "ready" | "error";

function hintSystemKeys(pack: FormPack): Set<string> {
  const keys = new Set<string>();
  for (const section of pack.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) keys.add(field.systemKey);
    }
  }
  return keys;
}

export function PackEditorApp() {
  const [status, setStatus] = useState<Status>("loading");
  const [hintPack, setHintPack] = useState<FormPack | null>(null);
  const [pack, setPack] = useState<FormPack | null>(null);
  const [activeSection, setActiveSection] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");

  useEffect(() => {
    let current = true;
    getPack()
      .then(({ hintPack: hint, overlay }) => {
        if (!current) return;
        const credential = buildCredentialPack(hint, overlay) as FormPack;
        setHintPack(hint);
        setPack(credential);
        setActiveSection(credential.sections[0]?.sectionKey ?? "");
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!current) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setStatus("error");
      });
    return () => {
      current = false;
    };
  }, []);

  const hintKeys = useMemo(() => (hintPack ? hintSystemKeys(hintPack) : new Set<string>()), [hintPack]);

  if (status === "loading") {
    return <main className="centered-screen">Loading the credential form…</main>;
  }
  if (status === "error" || !pack || !hintPack) {
    return (
      <main className="centered-screen">
        <p className="form-error" role="alert">
          {loadError || "The credential form could not be loaded."}
        </p>
      </main>
    );
  }

  const section = pack.sections.find((s) => s.sectionKey === activeSection);
  const selectedField =
    section?.groups.flatMap((g) => g.fields).find((f) => f.systemKey === selectedKey) ?? null;
  const selectedGroupKey =
    section?.groups.find((g) => g.fields.some((f) => f.systemKey === selectedKey))?.groupKey ?? null;

  async function handleSave() {
    if (!pack) return;
    const result = validatePack(pack);
    if (!result.ok) {
      setSaveError(`Cannot save: ${result.errors.join("; ")}`);
      setSaveMessage("");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      await savePack(pack);
      const { hintPack: hint, overlay } = await getPack();
      setHintPack(hint);
      setPack(buildCredentialPack(hint, overlay) as FormPack);
      setSaveMessage("Saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pack-editor">
      <nav className="pack-editor__nav" aria-label="Sections">
        {pack.sections.map((s) => (
          <button
            key={s.sectionKey}
            type="button"
            aria-current={s.sectionKey === activeSection ? "page" : undefined}
            onClick={() => {
              setActiveSection(s.sectionKey);
              setSelectedKey(null);
            }}
          >
            {s.title}
          </button>
        ))}
      </nav>

      <main className="pack-editor__main">
        {section ? (
          <div className="pack-editor__design">
            <FieldList
              groups={section.groups}
              selectedKey={selectedKey}
              hintKeys={hintKeys}
              onSelect={setSelectedKey}
              onDuplicate={(gk, key) => setPack((p) => (p ? duplicateField(p, section.sectionKey, gk, key) : p))}
              onDelete={(gk, key) => {
                setPack((p) => (p ? removeField(p, section.sectionKey, gk, key) : p));
                setSelectedKey((cur) => (cur === key ? null : cur));
              }}
              onReorder={(gk, from, to) =>
                setPack((p) => (p ? reorderFields(p, section.sectionKey, gk, from, to) : p))
              }
              onAdd={(gk, type: FieldType) =>
                setPack((p) => (p ? addOptionalField(p, section.sectionKey, gk, type) : p))
              }
            />
            <FieldPropertyPanel
              field={selectedField}
              onChange={(updated) => {
                if (!selectedGroupKey) return;
                setPack((p) =>
                  p ? updateField(p, section.sectionKey, selectedGroupKey, updated.systemKey, () => updated) : p,
                );
              }}
            />
          </div>
        ) : null}

        <div className="pack-editor__savebar">
          <button
            className="button button--primary"
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMessage ? <span>{saveMessage}</span> : null}
          {saveError ? (
            <span className="form-error" role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Add editor styles**

Create `apps/desktop/pack-editor/pack-editor.css`:

```css
.pack-editor { display: grid; grid-template-columns: 12rem 1fr; min-height: 100vh; }
.pack-editor__nav { display: flex; flex-direction: column; gap: 2px; padding: var(--space-4); border-right: 1px solid var(--color-border); }
.pack-editor__nav button { text-align: left; padding: var(--space-2) var(--space-3); border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--color-ink); }
.pack-editor__nav button[aria-current="page"] { background: var(--color-accent-tint); color: var(--color-accent); }
.pack-editor__main { padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); }
.pack-editor__design { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: var(--space-4); align-items: start; }
.field-list__group { margin-bottom: var(--space-4); }
.field-list__group-title { font-size: var(--text-xs); color: var(--color-ink-secondary); margin: 0 0 var(--space-2); }
.field-list__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.field-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
.field-row--selected { border-color: var(--color-accent); background: var(--color-accent-tint); }
.field-row__handle { border: none; background: transparent; cursor: grab; color: var(--color-ink-tertiary); font-size: 1rem; padding: 0 2px; }
.field-row__label { flex: 1; text-align: left; border: none; background: transparent; cursor: pointer; color: inherit; font: inherit; }
.field-row__type { font-size: var(--text-xs); color: var(--color-ink-tertiary); background: var(--color-surface-sunken); padding: 1px 7px; border-radius: var(--radius-sm); }
.field-list__add { margin-top: var(--space-2); display: block; }
.field-list__add select { width: 100%; }
.field-panel { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
.field-panel--empty { color: var(--color-ink-tertiary); }
.field-panel__control { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-xs); color: var(--color-ink-secondary); }
.field-panel__check { display: flex; align-items: center; gap: 8px; font-size: var(--text-xs); color: var(--color-ink-secondary); }
.field-panel__options ul { list-style: none; margin: 0 0 var(--space-2); padding: 0; display: flex; flex-direction: column; gap: 4px; }
.field-panel__options li { display: flex; align-items: center; justify-content: space-between; font-size: var(--text-xs); }
.field-panel__option-add { display: flex; gap: 6px; }
.pack-editor__tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-2); }
.pack-editor__tabs button { border: none; background: transparent; padding: 5px 12px; border-radius: var(--radius-sm); cursor: pointer; color: var(--color-ink-secondary); font: inherit; }
.pack-editor__tabs button[aria-selected="true"] { background: var(--color-accent-tint); color: var(--color-accent); }
.pack-editor__json { font-family: var(--font-mono, monospace); font-size: var(--text-xs); white-space: pre; overflow: auto; background: var(--color-surface-sunken); padding: var(--space-3); border-radius: var(--radius-md); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
```

Add the import to `apps/desktop/pack-editor/main.tsx` (after the existing CSS imports):

```tsx
import "../src/styles/tokens.css";
import "../src/App.css";
import "./pack-editor.css";
```

- [ ] **Step 5: Run tests + editor typecheck**

Run: `npm --prefix apps/desktop run test -- PackEditorApp`
Expected: PASS (4).

Run: `npm --prefix apps/desktop run typecheck:pack-editor`
Expected: no errors.

Run: `npm --prefix apps/desktop run test`
Expected: full suite passes.

- [ ] **Step 6: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/pack-editor/PackEditorApp.tsx apps/desktop/pack-editor/PackEditorApp.test.tsx apps/desktop/pack-editor/pack-editor.css apps/desktop/pack-editor/main.tsx
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(pack-editor): select-to-edit design view with field list + property panel"
```

---

## Task 5: Design / Preview / JSON tabs

**Files:**
- Modify: `apps/desktop/pack-editor/PackEditorApp.tsx`
- Modify: `apps/desktop/pack-editor/PackEditorApp.test.tsx`

- [ ] **Step 1: Write failing tests**

Add these tests inside the `describe("PackEditorApp", ...)` block in `apps/desktop/pack-editor/PackEditorApp.test.tsx`:

```tsx
  it("switches to the Preview tab and shows the field read-only", async () => {
    await openPasswordManager();
    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
    // The preview renders the field label as plain text (not an edit row button).
    const preview = screen.getByRole("tabpanel");
    expect(within(preview).getByText("Master password")).toBeInTheDocument();
  });

  it("switches to the JSON tab and shows the derived overlay", async () => {
    await openPasswordManager();
    await userEvent.click(screen.getByRole("tab", { name: /json/i }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/"packId": "lifescribe-default-credential"/)).toBeInTheDocument();
  });
```

Also add `within` to the RTL import at the top of the file:

```tsx
import { render, screen, within } from "@testing-library/react";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix apps/desktop run test -- PackEditorApp`
Expected: FAIL — no tabs yet.

- [ ] **Step 3: Add tabs to `PackEditorApp.tsx`**

Add imports:

```tsx
import { deriveOverlay } from "../scripts/lib/derive-overlay.mjs";
import { mergePackWithOverlay } from "../src/domain/packMerge";
import { createSectionValues } from "../src/domain/valuesStore";
import { FormRenderer } from "../src/forms/FormRenderer";
```

Add tab state next to the other `useState` calls:

```tsx
  const [activeTab, setActiveTab] = useState<"design" | "preview" | "json">("design");
```

In the ready branch, compute the resolved preview section and the JSON text (place after `section`/`selectedField` are computed):

```tsx
  const resolvedSection = section
    ? mergePackWithOverlay(pack, null, {}).resolved.sections.find(
        (s) => s.sectionKey === activeSection,
      )
    : undefined;
  const overlayJson = JSON.stringify(deriveOverlay(hintPack, pack), null, 2);
```

Replace the `<main className="pack-editor__main">` body's `{section ? (<div className="pack-editor__design"> … </div>) : null}` block with a tab bar + the three panels. The `<main>` becomes:

```tsx
      <main className="pack-editor__main">
        <div className="pack-editor__tabs" role="tablist">
          <button role="tab" aria-selected={activeTab === "design"} onClick={() => setActiveTab("design")}>
            Design
          </button>
          <button role="tab" aria-selected={activeTab === "preview"} onClick={() => setActiveTab("preview")}>
            Preview
          </button>
          <button role="tab" aria-selected={activeTab === "json"} onClick={() => setActiveTab("json")}>
            JSON
          </button>
        </div>

        {activeTab === "design" && section ? (
          <div className="pack-editor__design" role="tabpanel">
            <FieldList
              groups={section.groups}
              selectedKey={selectedKey}
              hintKeys={hintKeys}
              onSelect={setSelectedKey}
              onDuplicate={(gk, key) => setPack((p) => (p ? duplicateField(p, section.sectionKey, gk, key) : p))}
              onDelete={(gk, key) => {
                setPack((p) => (p ? removeField(p, section.sectionKey, gk, key) : p));
                setSelectedKey((cur) => (cur === key ? null : cur));
              }}
              onReorder={(gk, from, to) =>
                setPack((p) => (p ? reorderFields(p, section.sectionKey, gk, from, to) : p))
              }
              onAdd={(gk, type: FieldType) =>
                setPack((p) => (p ? addOptionalField(p, section.sectionKey, gk, type) : p))
              }
            />
            <FieldPropertyPanel
              field={selectedField}
              onChange={(updated) => {
                if (!selectedGroupKey) return;
                setPack((p) =>
                  p ? updateField(p, section.sectionKey, selectedGroupKey, updated.systemKey, () => updated) : p,
                );
              }}
            />
          </div>
        ) : null}

        {activeTab === "preview" && resolvedSection ? (
          <div className="pack-editor__preview" role="tabpanel">
            <FormRenderer
              section={resolvedSection}
              values={createSectionValues(resolvedSection.sectionKey)}
              schemaVersion={pack.schemaVersion}
              onChange={() => {}}
            />
          </div>
        ) : null}

        {activeTab === "json" ? (
          <pre className="pack-editor__json" role="tabpanel">
            {overlayJson}
          </pre>
        ) : null}

        <div className="pack-editor__savebar">
          <button
            className="button button--primary"
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMessage ? <span>{saveMessage}</span> : null}
          {saveError ? (
            <span className="form-error" role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
      </main>
```

- [ ] **Step 4: Run tests + editor typecheck**

Run: `npm --prefix apps/desktop run test -- PackEditorApp`
Expected: PASS (6 — the 4 from Task 4 plus the 2 tab tests).

Run: `npm --prefix apps/desktop run typecheck:pack-editor`
Expected: no errors.

Run: `npm --prefix apps/desktop run test`
Expected: full suite passes.

- [ ] **Step 5: Commit**

```bash
git -C "D:\My Data\My Apps\LifeScribe Vault" add apps/desktop/pack-editor/PackEditorApp.tsx apps/desktop/pack-editor/PackEditorApp.test.tsx
git -C "D:\My Data\My Apps\LifeScribe Vault" commit -m "feat(pack-editor): Design / Preview / JSON tabs"
```

---

## Final verification

- [ ] Full frontend suite: `npm --prefix apps/desktop run test` → all pass
- [ ] App typecheck: `npm --prefix apps/desktop run typecheck` → clean
- [ ] Editor typecheck: `npm --prefix apps/desktop run typecheck:pack-editor` → clean
- [ ] Lint: `npm --prefix apps/desktop run lint` → no new findings (`pack-editor` is ignored by the app eslint config)
- [ ] Drift/round-trip still green: `npm --prefix apps/desktop run test -- credentialPack deriveOverlay saveArtifacts fieldOps`
- [ ] Confirm `@dnd-kit` is NOT in the shipped app: `npm run build` (Tauri/Vite app build) still uses `src/main.tsx`; grep the app bundle or confirm nothing under `src/` imports `@dnd-kit`.
- [ ] **Manual smoke** (`npm run pack-editor`, open http://localhost:1430/):
  - Select a field → edit its label/helper/type in the property panel → the Design list updates.
  - **Drag a field row by its handle to reorder** (the one interaction not unit-tested) → order changes.
  - Duplicate a field → a clone appears after it; delete an added field.
  - Add a field via the type menu (e.g. textarea).
  - Switch to Preview (read-only form) and JSON (the overlay that will be saved).
  - Save → `git diff` shows the expected overlay + regenerated pack; `git checkout` to restore if it was only a smoke test.

## Notes on laws honored

- **Dev-only, never shipped:** `@dnd-kit` and all `pack-editor/` code are imported only by the separate editor app; the Tauri build uses `src/main.tsx`.
- **Reuse over reinvention:** editing uses `packEdits`; preview uses `FormRenderer`; save uses `deriveOverlay`/`buildCredentialPack`.
- **Overlay integrity:** reorder and duplicate produce internally-consistent packs that round-trip through `deriveOverlay`; delete stays gated to added fields (the overlay cannot encode hint-field removal).
- **Form definitions are data:** no expression strings or executable logic introduced.
