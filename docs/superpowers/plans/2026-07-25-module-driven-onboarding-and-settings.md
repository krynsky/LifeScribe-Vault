# Module-Driven Onboarding & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app's onboarding and in-app settings render generically from the pack's `modules` list, replacing the hardwired `secrets`/`formMode` binary, and reword the `secrets` module for users as "passwords".

**Architecture:** Three shared units (`ModuleQuestion` component, `useComposedPreview` hook, `applyModuleSelections` Dashboard action) back both surfaces. `SetupScreen` becomes a stepped wizard with one module question per step. A new `SettingsPage` route hosts a generic `VaultOptions` section. `moduleSelections` becomes the source of truth end to end; `profile.formMode` is kept only loosely synced for snapshot back-compat. The internal `moduleId: "secrets"` is unchanged; only user-facing copy becomes "passwords".

**Tech Stack:** React 19 + TypeScript (Vite), Vitest + React Testing Library. `vaultApi` is mocked in tests; `loadDefaultPack` falls back to the statically-imported bundled pack when `invoke` is unavailable, so pack-driven tests exercise real definitions.

---

## Reference: existing shapes (already in the codebase)

```ts
// src/domain/formModel.ts
interface FormModule {
  moduleId: string; title: string; question: string; helperText?: string;
  options: FormModuleOption[]; defaultOptionId: string; order: number;
}
interface FormModuleOption { optionId: string; label?: string; description?: string; /* + add/remove arrays */ }

// src/domain/snapshot.ts
type FormMode = "hint" | "credential";
function moduleSelectionsFromFormMode(formMode: FormMode): Record<string,string>; // { secrets: on|off }
function composePack(base, base.modules ?? [], selections): FormPack; // src/domain/composePack.ts
```

`resolveBasePack` in `Dashboard.tsx` already composes over all modules — **do not change it.**

## File structure

| File | Responsibility |
|---|---|
| `src/forms/ModuleQuestion.tsx` (new) | Presentational: render one module's question + options as radios |
| `src/forms/ModuleQuestion.test.tsx` (new) | Tests for the above |
| `src/domain/useComposedPreview.ts` (new) | Hook: `composePack` → `{ sections, error }` for previews + guards |
| `src/domain/useComposedPreview.test.ts` (new) | Tests for the above |
| `src/domain/snapshot.ts` (modify) | `emptySnapshot`/`normalizeSnapshot` seed from `moduleSelections`; sync `formMode` from `secrets` |
| `src/domain/snapshot.test.ts` (modify) | Cover the seed/sync behavior |
| `src/routes/SetupScreen.tsx` (modify) | Stepped wizard over modules; `onCreate` emits `moduleSelections` |
| `src/routes/SetupScreen.test.tsx` (modify) | Wizard tests |
| `src/App.tsx` (modify) | `handleCreate` seeds via `moduleSelections`; pass `moduleSelectionsHint` to Dashboard |
| `src/routes/Dashboard.tsx` (modify) | `applyModuleSelections` replaces `handleSwitchMode`; remove sidebar mode toggle; add Settings nav item; accept `moduleSelectionsHint` |
| `src/routes/SettingsPage.tsx` (new) | Settings route/shell (sections stack) |
| `src/routes/settings/VaultOptions.tsx` (new) | Generic module-options section |
| `src/routes/settings/VaultOptions.test.tsx` (new) | Tests for the above |
| `src-tauri/resources/packs/default-pack.json` (modify) | `secrets` module copy → "passwords" |
| `docs/user-guide.md` (modify) | "secrets" → "passwords" wording |

---

## Task 1: `ModuleQuestion` component

**Files:**
- Create: `apps/desktop/src/forms/ModuleQuestion.tsx`
- Test: `apps/desktop/src/forms/ModuleQuestion.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/desktop/src/forms/ModuleQuestion.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FormModule } from "../domain/formModel";
import { ModuleQuestion } from "./ModuleQuestion";

const module: FormModule = {
  moduleId: "secrets",
  title: "Store passwords",
  question: "Hold your actual passwords & PINs, or only where to find them?",
  helperText: "You can change this later.",
  defaultOptionId: "off",
  order: 1,
  options: [
    { optionId: "off", label: "Locations only" },
    { optionId: "on", label: "Store the actual passwords" },
  ],
};

describe("ModuleQuestion", () => {
  it("renders the question, helper text, and one radio per option, marking the selection", () => {
    render(<ModuleQuestion module={module} selected="off" onChange={vi.fn()} />);
    expect(screen.getByText(module.question)).toBeInTheDocument();
    expect(screen.getByText("You can change this later.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /locations only/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /store the actual passwords/i })).not.toBeChecked();
  });

  it("fires onChange with the option id when a different option is chosen", async () => {
    const onChange = vi.fn();
    render(<ModuleQuestion module={module} selected="off" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: /store the actual passwords/i }));
    expect(onChange).toHaveBeenCalledWith("on");
  });

  it("falls back to the optionId as the label when an option has none", () => {
    const noLabel: FormModule = { ...module, options: [{ optionId: "off" }, { optionId: "on" }] };
    render(<ModuleQuestion module={noLabel} selected="off" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "off" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/desktop run test -- src/forms/ModuleQuestion.test.tsx`
Expected: FAIL — cannot resolve `./ModuleQuestion`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/desktop/src/forms/ModuleQuestion.tsx
import type { FormModule } from "../domain/formModel";

export interface ModuleQuestionProps {
  module: FormModule;
  selected: string;
  onChange: (optionId: string) => void;
}

/**
 * Presentational render of one onboarding module as a labelled radio group.
 * Pure — no composition or persistence. Shared by the setup wizard and the
 * Settings "Vault options" section.
 */
export function ModuleQuestion({ module, selected, onChange }: ModuleQuestionProps) {
  return (
    <fieldset className="module-question">
      <legend className="module-question__title">{module.title}</legend>
      <p className="module-question__prompt">{module.question}</p>
      {module.helperText ? (
        <p className="module-question__help">{module.helperText}</p>
      ) : null}
      <div className="module-question__options">
        {module.options.map((option) => {
          const label = option.label ?? option.optionId;
          return (
            <label key={option.optionId} className="module-question__option">
              <input
                type="radio"
                name={`module-${module.moduleId}`}
                value={option.optionId}
                checked={selected === option.optionId}
                onChange={() => onChange(option.optionId)}
              />
              <span className="module-question__option-label">{label}</span>
              {option.description ? (
                <span className="module-question__option-desc">{option.description}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix apps/desktop run test -- src/forms/ModuleQuestion.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/forms/ModuleQuestion.tsx apps/desktop/src/forms/ModuleQuestion.test.tsx
git commit -m "feat: ModuleQuestion — presentational module radio group"
```

---

## Task 2: `useComposedPreview` hook

Returns the composed sections for a `(base, selections)` pair, or an error string when `composePack` rejects the combination. Extracts the pattern currently inline in `SetupScreen`'s `PackPreview` and `Dashboard`.

**Files:**
- Create: `apps/desktop/src/domain/useComposedPreview.ts`
- Test: `apps/desktop/src/domain/useComposedPreview.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/domain/useComposedPreview.test.ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FormPack } from "./formModel";
import { useComposedPreview } from "./useComposedPreview";

function packWithSecretsModule(): FormPack {
  return {
    packId: "p", packVersion: "1.0.0", schemaVersion: 1, minAppVersion: "0.0.0", migrations: [],
    sections: [
      {
        sectionKey: "identity", title: "Identity", lede: "", multiRecord: false, order: 1,
        groups: [{ groupKey: "g", title: "Details", repeatable: false, order: 1, fields: [
          { systemKey: "fullName", label: "Full name", type: "text", required: true, protected: true, order: 1 },
        ]}],
        readinessRule: { requiredKeys: ["fullName"] }, kitMapping: { entries: [{ heading: "Identity", fields: ["fullName"] }] },
      },
    ],
    modules: [{
      moduleId: "secrets", title: "Store passwords", question: "?", defaultOptionId: "off", order: 1,
      options: [
        { optionId: "off" },
        { optionId: "on", addFields: [{ sectionKey: "identity", groupKey: "g", order: 2, field: {
          systemKey: "masterPassword", label: "Master password", type: "text", required: false, protected: false, order: 2 } }] },
      ],
    }],
  };
}

describe("useComposedPreview", () => {
  it("returns composed sections and no error for a valid combination", () => {
    const base = packWithSecretsModule();
    const { result } = renderHook(() => useComposedPreview(base, { secrets: "on" }));
    expect(result.current.error).toBe("");
    const keys = result.current.sections.flatMap((s) => s.groups.flatMap((g) => g.fields.map((f) => f.systemKey)));
    expect(keys).toContain("masterPassword");
  });

  it("returns an error and empty sections when the combination is invalid", () => {
    const base = packWithSecretsModule();
    // addFields targets a section that a (hypothetical) removal deleted -> composePack throws.
    base.modules![0].options[1].addFields![0].sectionKey = "missing-section";
    const { result } = renderHook(() => useComposedPreview(base, { secrets: "on" }));
    expect(result.current.error).not.toBe("");
    expect(result.current.sections).toEqual([]);
  });

  it("returns empty sections and no error when base is null", () => {
    const { result } = renderHook(() => useComposedPreview(null, {}));
    expect(result.current).toEqual({ sections: [], error: "" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/desktop run test -- src/domain/useComposedPreview.test.ts`
Expected: FAIL — cannot resolve `./useComposedPreview`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/desktop/src/domain/useComposedPreview.ts
import { useMemo } from "react";
import { composePack } from "./composePack";
import type { FormPack, PackSection } from "./formModel";

export interface ComposedPreview {
  /** Composed sections in ascending order; empty when base is null or on error. */
  sections: PackSection[];
  /** Non-empty when composePack rejected the combination; empty otherwise. */
  error: string;
}

/**
 * Compose `base` with `selections` for preview + validity-guard purposes.
 * A combination composePack rejects (e.g. an addFields target a removal
 * deleted) surfaces as `error`, never a thrown render.
 */
export function useComposedPreview(
  base: FormPack | null,
  selections: Record<string, string>,
): ComposedPreview {
  return useMemo(() => {
    if (!base) return { sections: [], error: "" };
    try {
      const composed = composePack(base, base.modules ?? [], selections);
      const sections = [...composed.sections].sort((a, b) => a.order - b.order);
      return { sections, error: "" };
    } catch (caught) {
      return { sections: [], error: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [base, selections]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix apps/desktop run test -- src/domain/useComposedPreview.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/domain/useComposedPreview.ts apps/desktop/src/domain/useComposedPreview.test.ts
git commit -m "feat: useComposedPreview hook — compose+guard for previews"
```

---

## Task 3: Snapshot seeds from `moduleSelections`; `formMode` synced from `secrets`

`emptySnapshot`/`normalizeSnapshot` currently take a `formMode`. Add `moduleSelections`-first overloads and keep `formMode` derived (loosely synced) so old app builds still read the snapshot.

**Files:**
- Modify: `apps/desktop/src/domain/snapshot.ts`
- Test: `apps/desktop/src/domain/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to apps/desktop/src/domain/snapshot.test.ts
import { describe, expect, it } from "vitest";
import { emptySnapshot, formModeFromModuleSelections } from "./snapshot";

describe("moduleSelections-first seeding", () => {
  it("emptySnapshot seeds the profile from moduleSelections and syncs formMode from secrets", () => {
    const snap = emptySnapshot("Dana", { secrets: "on", "file-method": "attach" });
    expect(snap.profile.moduleSelections).toEqual({ secrets: "on", "file-method": "attach" });
    expect(snap.profile.formMode).toBe("credential");
  });

  it("formModeFromModuleSelections maps secrets on->credential, else hint", () => {
    expect(formModeFromModuleSelections({ secrets: "on" })).toBe("credential");
    expect(formModeFromModuleSelections({ secrets: "off" })).toBe("hint");
    expect(formModeFromModuleSelections({})).toBe("hint");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/desktop run test -- src/domain/snapshot.test.ts`
Expected: FAIL — `formModeFromModuleSelections` is not exported; `emptySnapshot("Dana", { … })` type error.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/domain/snapshot.ts`, add near `moduleSelectionsFromFormMode`:

```ts
/** Legacy back-compat sync: derive a formMode from the secrets module selection. */
export function formModeFromModuleSelections(selections: Record<string, string>): FormMode {
  return selections.secrets === "on" ? "credential" : "hint";
}
```

Replace the `emptySnapshot` signature/body:

```ts
/** A brand-new snapshot for a vault that has never been saved. */
export function emptySnapshot(
  ownerName: string,
  moduleSelections: Record<string, string> = { secrets: "off" },
): ParsedSnapshot {
  return {
    snapshotFormat: SNAPSHOT_FORMAT,
    schemaVersion: 0,
    profile: {
      ownerName,
      reviewCadenceMonths: DEFAULT_REVIEW_CADENCE_MONTHS,
      formMode: formModeFromModuleSelections(moduleSelections),
      moduleSelections,
    },
    values: {},
    sectionMeta: {},
    overlay: null,
    kitMeta: null,
    extra: {},
  };
}
```

Change `normalizeSnapshot`'s third parameter from `fallbackFormMode: FormMode` to
`fallbackSelections: Record<string, string> = { secrets: "off" }`, and update its body:

```ts
export function normalizeSnapshot(
  raw: VaultSnapshot | null,
  fallbackOwnerName = "",
  fallbackSelections: Record<string, string> = { secrets: "off" },
): ParsedSnapshot {
  if (!isRecord(raw)) {
    return emptySnapshot(fallbackOwnerName, fallbackSelections);
  }
  // …unchanged extra/cadence handling…
  const formMode = asFormMode(profileRaw.formMode, formModeFromModuleSelections(fallbackSelections));
  const moduleSelections = asModuleSelections(profileRaw.moduleSelections, formMode);
  return {
    // …unchanged snapshotFormat/schemaVersion…
    profile: {
      ownerName: asString(profileRaw.ownerName, fallbackOwnerName),
      reviewCadenceMonths,
      // Keep formMode loosely synced to the live selection for back-compat.
      formMode: formModeFromModuleSelections(moduleSelections),
      moduleSelections,
      ...(typeof profileRaw.basePackId === "string" && profileRaw.basePackId.length > 0
        ? { basePackId: profileRaw.basePackId }
        : {}),
    },
    // …rest unchanged…
  };
}
```

Note: `asModuleSelections(value, formMode)` still falls back via `moduleSelectionsFromFormMode` when the snapshot has no `moduleSelections` (legacy). Keep it as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix apps/desktop run test -- src/domain/snapshot.test.ts`
Expected: PASS (existing tests still pass; new ones pass). If existing tests pass `fallbackFormMode` positionally, update those call sites to pass a selections object (e.g. `{ secrets: "on" }` for the old `"credential"`).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/domain/snapshot.ts apps/desktop/src/domain/snapshot.test.ts
git commit -m "feat: seed snapshots from moduleSelections; keep formMode synced for back-compat"
```

---

## Task 4: `SetupScreen` becomes a stepped wizard

Step 0 = name + password + no-recovery ack. Steps 1..N = one `ModuleQuestion` per module (defaults pre-selected) with a per-step preview. Final step creates the vault, emitting `moduleSelections`.

**Files:**
- Modify: `apps/desktop/src/routes/SetupScreen.tsx`
- Test: `apps/desktop/src/routes/SetupScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// replace the mode-specific tests in apps/desktop/src/routes/SetupScreen.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupScreen } from "./SetupScreen";

// loadDefaultPack falls back to the bundled pack when invoke is unavailable,
// so the wizard enumerates the real shipped modules (secrets, file-method).
const PW = "correct horse battery staple";

async function completeStepOne(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Your name"), "Dana");
  await user.type(screen.getByLabelText("Master password"), PW);
  await user.type(screen.getByLabelText("Confirm master password"), PW);
  await user.click(screen.getByRole("checkbox", { name: /no recovery/i }));
  await user.click(screen.getByRole("button", { name: /^next$/i }));
}

describe("SetupScreen wizard", () => {
  it("walks name/password, then one step per module, and Create emits moduleSelections", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SetupScreen onCreate={onCreate} />);
    const user = userEvent.setup();

    await completeStepOne(user);

    // First module step: secrets. Default (off) preselected. Choose "on".
    const secretsRadio = await screen.findByRole("radio", { name: /store the actual passwords/i });
    await user.click(secretsRadio);
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    // Second module step: file-method. Leave its default. Final button creates.
    await user.click(screen.getByRole("button", { name: /create vault/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const [password, name, selections] = onCreate.mock.calls[0];
    expect(password).toBe(PW);
    expect(name).toBe("Dana");
    expect(selections.secrets).toBe("on");
    expect(selections["file-method"]).toBe("path"); // module default untouched
  });

  it("blocks leaving step one until the password is valid and acknowledged", async () => {
    render(<SetupScreen onCreate={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Master password"), "short");
    await user.type(screen.getByLabelText("Confirm master password"), "short");
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 15 characters/i);
  });

  it("lets the user go Back to a previous step without losing entries", async () => {
    render(<SetupScreen onCreate={vi.fn()} />);
    const user = userEvent.setup();
    await completeStepOne(user);
    await screen.findByRole("radio", { name: /store the actual passwords/i });
    await user.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByLabelText("Your name")).toHaveValue("Dana");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix apps/desktop run test -- src/routes/SetupScreen.test.tsx`
Expected: FAIL — no "Next" button (screen is single-step today).

- [ ] **Step 3: Rewrite `SetupScreen.tsx` as a wizard**

Replace the component (keep `EyeIcon`, `RevealToggle`, `MIN_MASTER_PASSWORD_LENGTH`, `GUIDANCE_ID`, `ERROR_ID`, `createErrorMessage`). Change the prop type and the `PackPreview` to take `selections`:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { FormModule, FormPack } from "../domain/formModel";
import { loadDefaultPack } from "../domain/loadDefaultPack";
import { useComposedPreview } from "../domain/useComposedPreview";
import { ModuleQuestion } from "../forms/ModuleQuestion";

export interface SetupScreenProps {
  onCreate: (masterPassword: string, ownerName: string, moduleSelections: Record<string, string>) => Promise<void>;
}

function PackPreview({ base, selections }: { base: FormPack | null; selections: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const { sections, error } = useComposedPreview(base, selections);
  return (
    <details className="setup-preview" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="setup-preview__summary">Preview this choice</summary>
      {error ? (
        <p className="setup-preview__status">{`This combination isn't valid: ${error}`}</p>
      ) : (
        <ul className="setup-preview__sections">
          {sections.map((section) => {
            const fieldCount = section.groups.reduce((c, g) => c + g.fields.length, 0);
            return (
              <li key={section.sectionKey} className="setup-preview__section">
                <span className="setup-preview__section-title">
                  {section.title}
                  <span className="setup-preview__count">{fieldCount} {fieldCount === 1 ? "field" : "fields"}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
```

Then the wizard component:

```tsx
export function SetupScreen({ onCreate }: SetupScreenProps) {
  const [base, setBase] = useState<FormPack | null>(null);
  const [step, setStep] = useState(0); // 0 = identity; 1..N = modules
  const [ownerName, setOwnerName] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmMasterPassword, setConfirmMasterPassword] = useState("");
  const [acknowledgedNoRecovery, setAcknowledgedNoRecovery] = useState(false);
  const [revealMaster, setRevealMaster] = useState(false);
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modules = useMemo(
    () => [...(base?.modules ?? [])].sort((a, b) => a.order - b.order),
    [base],
  );
  // Guard: a combination composePack rejects must block Create (never submit
  // a broken composition). The preview surfaces the message; this disables Create.
  const composeError = useComposedPreview(base, selections).error;

  useEffect(() => {
    let isCurrent = true;
    loadDefaultPack()
      .then((pack) => {
        if (!isCurrent) return;
        setBase(pack);
        setSelections(Object.fromEntries((pack.modules ?? []).map((m) => [m.moduleId, m.defaultOptionId])));
      })
      .catch(() => { /* preview/steps degrade to identity-only */ });
    return () => { isCurrent = false; };
  }, []);

  const describedBy = error ? `${GUIDANCE_ID} ${ERROR_ID}` : GUIDANCE_ID;
  const lastStep = modules.length; // step index of the final module (or 0 if none)
  const currentModule: FormModule | undefined = step > 0 ? modules[step - 1] : undefined;

  function validateIdentity(): boolean {
    if (masterPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
      setError(`Use a master password with at least ${MIN_MASTER_PASSWORD_LENGTH} characters — a few unrelated words work well.`);
      return false;
    }
    if (masterPassword !== confirmMasterPassword) {
      setError("The passwords don't match. Re-enter both before continuing.");
      return false;
    }
    if (!acknowledgedNoRecovery) {
      setError("Please confirm you understand the password cannot be reset.");
      return false;
    }
    return true;
  }

  function goNext() {
    setError("");
    if (step === 0 && !validateIdentity()) return;
    setStep((s) => Math.min(s + 1, lastStep));
  }
  function goBack() {
    setError("");
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleCreate() {
    setError("");
    if (!validateIdentity()) { setStep(0); return; }
    setIsSubmitting(true);
    try {
      await onCreate(masterPassword, ownerName.trim(), selections);
    } catch (caught) {
      setError(createErrorMessage(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  const onFinalStep = step === lastStep; // true on the last module step, or on step 0 when no modules

  return (
    <div className="centered-screen">
      <section className="vault-panel" aria-labelledby="setup-title">
        <p className="vault-panel__eyebrow">LifeScribe Vault</p>
        <h1 className="vault-panel__title" id="setup-title">Let's set up your vault</h1>

        {/* progress dots */}
        <ol className="setup-steps" aria-label={`Step ${step + 1} of ${modules.length + 1}`}>
          {Array.from({ length: modules.length + 1 }, (_, i) => (
            <li key={i} className={i === step ? "setup-steps__dot setup-steps__dot--current" : "setup-steps__dot"} />
          ))}
        </ol>

        {step === 0 ? (
          <div className="vault-form">
            <div className="vault-form__field">
              <label htmlFor="owner-name">Your name</label>
              <input id="owner-name" type="text" autoComplete="name" value={ownerName}
                onChange={(e) => setOwnerName(e.currentTarget.value)} />
            </div>
            <div className="vault-form__field">
              <label htmlFor="master-password">Master password</label>
              <div className="password-field">
                <input id="master-password" aria-describedby={describedBy} aria-invalid={error ? "true" : undefined}
                  autoComplete="new-password" required spellCheck={false}
                  type={revealMaster ? "text" : "password"} value={masterPassword}
                  onChange={(e) => { setError(""); setMasterPassword(e.currentTarget.value); }} />
                <RevealToggle fieldLabel="master password" shown={revealMaster} onToggle={() => setRevealMaster((s) => !s)} />
              </div>
            </div>
            <div className="vault-form__field">
              <label htmlFor="confirm-master-password">Confirm master password</label>
              <div className="password-field">
                <input id="confirm-master-password" aria-describedby={describedBy} aria-invalid={error ? "true" : undefined}
                  autoComplete="new-password" required spellCheck={false}
                  type={revealConfirm ? "text" : "password"} value={confirmMasterPassword}
                  onChange={(e) => { setError(""); setConfirmMasterPassword(e.currentTarget.value); }} />
                <RevealToggle fieldLabel="confirmation password" shown={revealConfirm} onToggle={() => setRevealConfirm((s) => !s)} />
              </div>
            </div>
            <ul className="vault-panel__guidance" id={GUIDANCE_ID}>
              <li>A long passphrase of a few unrelated words is strong and memorable.</li>
              <li>This vault never touches the cloud — nobody can reset the password for you.</li>
            </ul>
            <label className="checkbox-control checkbox-control--acknowledge">
              <input type="checkbox" checked={acknowledgedNoRecovery}
                onChange={(e) => { setError(""); setAcknowledgedNoRecovery(e.currentTarget.checked); }} />
              <span>I understand there is no recovery — this password cannot be reset, and losing it means losing access to the vault.</span>
            </label>
          </div>
        ) : currentModule ? (
          <div className="vault-form">
            <ModuleQuestion
              module={currentModule}
              selected={selections[currentModule.moduleId] ?? currentModule.defaultOptionId}
              onChange={(optionId) => setSelections((prev) => ({ ...prev, [currentModule.moduleId]: optionId }))}
            />
            <PackPreview base={base} selections={selections} />
          </div>
        ) : null}

        {error ? <p className="form-error" id={ERROR_ID} role="alert">{error}</p> : null}

        <div className="setup-nav">
          {step > 0 ? (
            <button type="button" className="button button--secondary" onClick={goBack}>Back</button>
          ) : null}
          {onFinalStep ? (
            <button type="button" className="button button--primary"
              disabled={isSubmitting || (step === 0 && !acknowledgedNoRecovery) || Boolean(composeError)}
              onClick={() => void handleCreate()}>
              {isSubmitting ? "Creating your vault…" : "Create vault"}
            </button>
          ) : (
            <button type="button" className="button button--primary"
              disabled={step === 0 && !acknowledgedNoRecovery} onClick={goNext}>
              Next
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix apps/desktop run test -- src/routes/SetupScreen.test.tsx`
Expected: PASS. (Delete/replace the old `formMode`-radio assertions from Task 4 Step 1.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/routes/SetupScreen.tsx apps/desktop/src/routes/SetupScreen.test.tsx
git commit -m "feat: setup wizard — one module question per step, emits moduleSelections"
```

---

## Task 5: `App` seeds via `moduleSelections`; wire the Settings screen flag

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Update `handleCreate` and the hint state**

Change the hint state and `handleCreate` signature/body:

```tsx
// replace: const [formModeHint, setFormModeHint] = useState<FormMode>("hint");
const [moduleSelectionsHint, setModuleSelectionsHint] = useState<Record<string, string>>({ secrets: "off" });

async function handleCreate(masterPassword: string, ownerName: string, moduleSelections: Record<string, string>) {
  const status = await createVault(masterPassword, ownerName);
  setOwnerNameHint(ownerName);
  setModuleSelectionsHint(moduleSelections);
  localStorage.removeItem("lifescribe.packEditorEnabled");
  try {
    await saveVaultSnapshot(buildSnapshot(emptySnapshot(ownerName, moduleSelections)), 0);
  } catch {
    // Non-fatal: the vault exists; the choice is held in moduleSelectionsHint until the first save.
  }
  setScreen(screenFromStatus(status));
}
```

Remove the now-unused `FormMode` import if nothing else uses it. Update the Dashboard render:

```tsx
return (
  <Dashboard
    ownerNameHint={ownerNameHint}
    moduleSelectionsHint={moduleSelectionsHint}
    onLocked={() => setScreen("locked")}
  />
);
```

- [ ] **Step 2: Run the app typecheck to surface the Dashboard prop change**

Run: `npm --prefix apps/desktop run typecheck`
Expected: FAIL — `Dashboard` still declares `formModeHint`. Fixed in Task 6.

- [ ] **Step 3: Commit (with Task 6, since types span both)**

Defer the commit; App + Dashboard prop rename are one type-consistent change. Proceed to Task 6, then commit both together.

---

## Task 6: Dashboard — `applyModuleSelections`, remove sidebar toggle, add Settings nav

**Files:**
- Modify: `apps/desktop/src/routes/Dashboard.tsx`
- Test: `apps/desktop/src/routes/Dashboard.test.tsx`

- [ ] **Step 1: Rename the hint prop and generalize the switch action**

In `DashboardProps`, replace `formModeHint?: FormMode` with
`moduleSelectionsHint?: Record<string, string>`, defaulting to `{ secrets: "off" }`.
Update the `normalizeSnapshot(raw, ownerNameHint, formModeHint)` call sites (three of
them) to pass `moduleSelectionsHint`.

Replace `handleSwitchMode(newMode)` with a generic action:

```tsx
async function applyModuleSelections(next: Record<string, string>) {
  if (!loaded) return;
  const current = loaded.vault.profile.moduleSelections;
  const unchanged = Object.keys({ ...current, ...next }).every((k) => current[k] === next[k]);
  if (unchanged) return;
  let nextBasePackId: string | undefined;
  try { nextBasePackId = (await loadDefaultPack()).packId; } catch { nextBasePackId = undefined; }
  const nextLoaded: LoadedVault = {
    ...loaded,
    vault: {
      ...loaded.vault,
      profile: {
        ...loaded.vault.profile,
        moduleSelections: next,
        formMode: formModeFromModuleSelections(next), // keep synced for back-compat
        basePackId: nextBasePackId,
      },
      customPack: null,
    },
  };
  const ok = await persist(nextLoaded, loaded.vault.savedValues, loaded.vault.sectionMeta, null);
  if (ok) setLoadKey((k) => k + 1); // reload so sections rebuild from the new composition
}
```

Import `formModeFromModuleSelections` from `../domain/snapshot`. Remove the
`pendingModeSwitch`/`handleSwitchMode` machinery **only after** the Settings section
(Task 7) consumes `applyModuleSelections`; for now expose `applyModuleSelections` and
keep the old confirm modal wired to a secrets-only call so the app still builds. (The
old modal + `pendingModeSwitch` state are deleted in Task 7 Step 4.)

- [ ] **Step 2: Remove the sidebar mode toggle block, add a Settings nav item**

Delete the entire `<div className="sidebar__mode">…</div>` block (the "Form detail"
label + switch button). Add Dashboard-local state for the Settings view and a sidebar
nav item that opens it (SettingsPage itself is wired in Task 7; for now the button just
sets the flag):

```tsx
// near the other Dashboard useState hooks:
const [showSettings, setShowSettings] = useState(false);
```

```tsx
// in the sidebar <nav> list, alongside the existing route buttons:
<li>
  <button type="button" className="sidebar__nav-button" onClick={() => setShowSettings(true)}>
    Settings
  </button>
</li>
```

- [ ] **Step 3: Update the mode regression test**

In `apps/desktop/src/routes/Dashboard.test.tsx`, the `formModeHint` describe block and
the sidebar "Switch to…" assertions no longer apply. Replace them with a test that the
Settings nav item renders and that a legacy `formMode: "credential"` snapshot still
composes the secret field (proving back-compat seeding):

```tsx
it("still composes the secret field from a legacy formMode-only snapshot", async () => {
  mocked.loadVaultSnapshot.mockResolvedValue({
    snapshot: { profile: { ownerName: "Dana", formMode: "credential" } }, generation: 3, recovered: false,
  });
  renderDashboard();
  expect(await screen.findByRole("button", { name: /^Settings/ })).toBeInTheDocument();
  // secret field (masterPassword) present because formMode->moduleSelections seeds secrets: on
  // (assert via a section/field the secrets module adds in the bundled pack)
});
```

Adjust the existing calls to `renderDashboard()` / `<Dashboard .../>` in the test file
to pass `moduleSelectionsHint` where the old `formModeHint` was used.

- [ ] **Step 4: Run typecheck + Dashboard tests**

Run: `npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run test -- src/routes/Dashboard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit App + Dashboard together**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/routes/Dashboard.tsx apps/desktop/src/routes/Dashboard.test.tsx
git commit -m "feat: generalize module switching (applyModuleSelections); drop sidebar mode toggle; Settings nav"
```

---

## Task 7: Settings page + generic Vault options section

**Files:**
- Create: `apps/desktop/src/routes/SettingsPage.tsx`
- Create: `apps/desktop/src/routes/settings/VaultOptions.tsx`
- Test: `apps/desktop/src/routes/settings/VaultOptions.test.tsx`
- Modify: `apps/desktop/src/routes/Dashboard.tsx` (render SettingsPage on `showSettings`; delete old modal)

- [ ] **Step 1: Write the failing test for `VaultOptions`**

```tsx
// apps/desktop/src/routes/settings/VaultOptions.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FormPack } from "../../domain/formModel";
import { VaultOptions } from "./VaultOptions";

function packWithTwoModules(): FormPack {
  return {
    packId: "p", packVersion: "1.0.0", schemaVersion: 1, minAppVersion: "0.0.0", migrations: [], sections: [],
    modules: [
      { moduleId: "secrets", title: "Store passwords", question: "?", defaultOptionId: "off", order: 1,
        options: [{ optionId: "off", label: "Locations only" }, { optionId: "on", label: "Store the actual passwords" }] },
      { moduleId: "file-method", title: "File handling", question: "?", defaultOptionId: "path", order: 2,
        options: [{ optionId: "path", label: "Point to location" }, { optionId: "attach", label: "Attach files" }] },
    ],
  };
}

describe("VaultOptions", () => {
  it("renders a question per module and disables Apply until a selection differs", async () => {
    const onApply = vi.fn();
    render(<VaultOptions base={packWithTwoModules()} selections={{ secrets: "off", "file-method": "path" }} onApply={onApply} />);
    expect(screen.getByText("Store passwords")).toBeInTheDocument();
    expect(screen.getByText("File handling")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /store the actual passwords/i }));
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeEnabled();
  });

  it("confirms, then calls onApply with the working selections", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<VaultOptions base={packWithTwoModules()} selections={{ secrets: "off", "file-method": "path" }} onApply={onApply} />);
    await userEvent.click(screen.getByRole("radio", { name: /attach files/i }));
    await userEvent.click(screen.getByRole("button", { name: /apply changes/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm/i }));
    expect(onApply).toHaveBeenCalledWith({ secrets: "off", "file-method": "attach" });
  });

  it("shows an empty state when the pack has no modules", () => {
    const noModules: FormPack = { ...packWithTwoModules(), modules: [] };
    render(<VaultOptions base={noModules} selections={{}} onApply={vi.fn()} />);
    expect(screen.getByText(/no vault options/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply changes/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/desktop run test -- src/routes/settings/VaultOptions.test.tsx`
Expected: FAIL — cannot resolve `./VaultOptions`.

- [ ] **Step 3: Implement `VaultOptions`**

```tsx
// apps/desktop/src/routes/settings/VaultOptions.tsx
import { useMemo, useState } from "react";
import type { FormPack } from "../../domain/formModel";
import { useComposedPreview } from "../../domain/useComposedPreview";
import { ModuleQuestion } from "../../forms/ModuleQuestion";

export interface VaultOptionsProps {
  base: FormPack | null;
  selections: Record<string, string>;
  onApply: (next: Record<string, string>) => Promise<void>;
}

export function VaultOptions({ base, selections, onApply }: VaultOptionsProps) {
  const modules = useMemo(() => [...(base?.modules ?? [])].sort((a, b) => a.order - b.order), [base]);
  const [working, setWorking] = useState<Record<string, string>>(selections);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const { error } = useComposedPreview(base, working);

  const dirty = modules.some((m) => (working[m.moduleId] ?? m.defaultOptionId) !== (selections[m.moduleId] ?? m.defaultOptionId));

  if (modules.length === 0) {
    return (
      <section className="settings-section">
        <h2 className="settings-section__title">Vault options</h2>
        <p className="settings-section__empty">This vault has no vault options to change.</p>
      </section>
    );
  }

  async function handleApply() {
    setApplying(true);
    try { await onApply(working); setConfirming(false); }
    finally { setApplying(false); }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Vault options</h2>
      <p className="settings-section__lede">
        These choices shape which sections and fields your vault includes. Changing one rebuilds your
        forms — entered data is kept (orphaned values are archived); any custom form edits are replaced.
      </p>
      {modules.map((m) => (
        <ModuleQuestion key={m.moduleId} module={m}
          selected={working[m.moduleId] ?? m.defaultOptionId}
          onChange={(optionId) => setWorking((prev) => ({ ...prev, [m.moduleId]: optionId }))} />
      ))}
      {error ? <p className="form-error" role="alert">{`This combination isn't valid: ${error}`}</p> : null}

      {confirming ? (
        <div className="settings-confirm" role="alertdialog" aria-label="Confirm vault options change">
          <p>Rebuild your forms with these options? Entered data is kept; custom form edits are replaced.</p>
          <div className="settings-confirm__actions">
            <button type="button" className="button button--ghost button--small" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="button button--small" disabled={applying}
              aria-label="Confirm apply changes" onClick={() => void handleApply()}>
              {applying ? "Applying…" : "Confirm"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="button button--primary" disabled={!dirty || Boolean(error)}
          onClick={() => setConfirming(true)}>Apply changes</button>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix apps/desktop run test -- src/routes/settings/VaultOptions.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `SettingsPage` shell and route it from App/Dashboard**

Create `apps/desktop/src/routes/SettingsPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { FormPack } from "../domain/formModel";
import { loadDefaultPack } from "../domain/loadDefaultPack";
import { VaultOptions } from "./settings/VaultOptions";

export interface SettingsPageProps {
  selections: Record<string, string>;
  onApply: (next: Record<string, string>) => Promise<void>;
  onBack: () => void;
}

export function SettingsPage({ selections, onApply, onBack }: SettingsPageProps) {
  const [base, setBase] = useState<FormPack | null>(null);
  useEffect(() => {
    let isCurrent = true;
    loadDefaultPack().then((p) => { if (isCurrent) setBase(p); }).catch(() => { /* empty state */ });
    return () => { isCurrent = false; };
  }, []);
  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <button type="button" className="button button--ghost button--small" onClick={onBack}>← Back</button>
        <h1 className="settings-page__title">Settings</h1>
      </header>
      <VaultOptions base={base} selections={selections} onApply={onApply} />
      {/* Future sections (Security / change password, review cadence) stack here. */}
    </div>
  );
}
```

Render `SettingsPage` from within `Dashboard` when the Task 6 `showSettings` flag is set
(Dashboard already owns `loaded.vault.profile.moduleSelections` and
`applyModuleSelections`, so no App-level routing or extra props are needed):

```tsx
// in Dashboard.tsx, near the top of the ready ("loaded") render branch:
if (showSettings) {
  return (
    <SettingsPage
      selections={loaded.vault.profile.moduleSelections}
      onApply={async (next) => { await applyModuleSelections(next); setShowSettings(false); }}
      onBack={() => setShowSettings(false)}
    />
  );
}
```

Delete the old `pendingModeSwitch` state and its confirmation modal JSX from
`Dashboard.tsx` (superseded by the VaultOptions confirm). Note: `App.tsx` needs **no**
Settings routing — Dashboard owns the Settings view via `showSettings`.

- [ ] **Step 6: Run typecheck + full app test suite**

Run: `npm --prefix apps/desktop run typecheck && npm --prefix apps/desktop run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/routes/SettingsPage.tsx apps/desktop/src/routes/settings/VaultOptions.tsx apps/desktop/src/routes/settings/VaultOptions.test.tsx apps/desktop/src/routes/Dashboard.tsx
git commit -m "feat: Settings page with generic Vault options section"
```

---

## Task 8: Copy — "secrets" → "passwords"

**Files:**
- Modify: `apps/desktop/src-tauri/resources/packs/default-pack.json`
- Modify: `docs/user-guide.md`

- [ ] **Step 1: Reword the `secrets` module in the pack**

Locate the `"moduleId": "secrets"` object in `default-pack.json` and set:
- `"title": "Store passwords"`
- `"question": "Do you want the vault to hold your actual passwords and PINs, or only where to find them?"`
- `"helperText": "Passwords and PINs are encrypted in this vault. Choose \"Locations only\" to keep this vault free of live credentials."`
- Option labels: the `off` option label → `"Locations only"`; the `on` option label → `"Store the actual passwords"`.

Leave `"moduleId": "secrets"` and the option ids (`off`/`on`) unchanged.

- [ ] **Step 2: Verify the shipped-pack tests still pass**

Run: `npm --prefix apps/desktop run test -- src/domain/defaultPack.test.ts`
Expected: PASS (no test asserts these strings; `validatePack` unaffected).

- [ ] **Step 3: Reword `docs/user-guide.md`**

In `docs/user-guide.md`, replace "secrets" wording in the setup-choice table and the
"Changing what the vault stores" section with "passwords" (e.g. "Store the actual
passwords & PINs"), and reword the Recovery Kit note ("never includes secret values,
even in passwords mode"). Keep the meaning identical; only the consumer term changes.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/resources/packs/default-pack.json docs/user-guide.md
git commit -m "feat: reword the secrets module as 'passwords' for users (internal id unchanged)"
```

---

## Final verification

- [ ] **Full suite + typecheck + lint**

```bash
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run test
npm --prefix apps/desktop run lint
```

Expected: all green. Then run `npm run dev` and manually confirm: setup wizard steps
through both module questions; the vault composes per the choices; Settings → Vault
options changes a module (with confirm) and the forms rebuild; a fresh vault defaults
to locations-only + point-to-location.

## Notes for the implementer

- **Do not** change `composePack`, `resolveBasePack`, or the snapshot wire format.
- `formMode` stays in the profile purely as a synced back-compat field; never read it
  for behavior in new code — read `moduleSelections`.
- The bundled pack always has modules, so onboarding always has ≥1 module step; the
  "no modules" paths (wizard collapse, VaultOptions empty state) guard legacy
  `customPack` vaults only.
- Match existing CSS conventions; new class names (`module-question__*`, `setup-steps__*`,
  `settings-*`) need styles in the app stylesheet, mirroring nearby components.
