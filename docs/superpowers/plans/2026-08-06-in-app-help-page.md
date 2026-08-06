# In-app Help Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `docs/user-guide.md` as a new "Help" page inside the app, reachable from the sidebar once the vault is unlocked.

**Architecture:** A new `react-markdown` dependency renders `docs/user-guide.md`'s content, imported at build time via Vite's `?raw` suffix so the file itself is the only copy of the content. A new `HelpPage.tsx` route component wraps the renderer; `Dashboard.tsx` gains a `"help"` route kind and a sidebar nav button, following the exact pattern already used for Settings/Backup/Recovery Kit.

**Tech Stack:** React 19, TypeScript, Vite, `react-markdown`, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-06-in-app-help-page-design.md`

---

### Task 1: Add the `react-markdown` dependency

**Files:**
- Modify: `apps/desktop/package.json:19-24`

- [ ] **Step 1: Add the dependency**

In `apps/desktop/package.json`, the `"dependencies"` block currently reads:

```json
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "jspdf": "^4.2.1",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
```

Change it to:

```json
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "jspdf": "^4.2.1",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-markdown": "^10"
  },
```

- [ ] **Step 2: Install**

Run (from the repo root):

```powershell
npm install
```

Expected: `apps/desktop/node_modules/react-markdown` exists; the root `package-lock.json` and `apps/desktop/package-lock.json` (if present) are updated. No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json package-lock.json
git commit -m "chore: add react-markdown for the in-app Help page"
```

(If `apps/desktop` has its own `package-lock.json`, add that path too instead of/alongside the root one — check `git status` and include whichever lockfile(s) actually changed.)

---

### Task 2: Allow Vite to read `docs/user-guide.md` across the workspace-root boundary

**Files:**
- Modify: `apps/desktop/vite.config.ts`

**Context:** `docs/user-guide.md` lives at the repo root, one level above `apps/desktop` (the Vite project root). Vite's dev server refuses to serve files outside the project root unless explicitly allowed. `searchForWorkspaceRoot` is Vite's own exported helper for exactly this monorepo case — it walks up from the current working directory looking for a `package.json` with a `workspaces` field (which the repo root has) and returns that directory.

- [ ] **Step 1: Update the config**

Current `apps/desktop/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

Change to:

```ts
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    fs: {
      // apps/desktop is the Vite project root, but HelpPage.tsx imports
      // docs/user-guide.md (repo root) via a `?raw` import — allow the dev
      // server to read across that workspace-root boundary.
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/vite.config.ts
git commit -m "chore(vite): allow reading files from the workspace root"
```

(This step alone has no independently-runnable verification — Task 3 exercises it. Committing now keeps commits small and focused; if Task 3's build fails because of this config, you'll come back and fix it before its own commit.)

---

### Task 3: `HelpPage` component

**Files:**
- Create: `apps/desktop/src/routes/HelpPage.tsx`
- Create: `apps/desktop/src/routes/HelpPage.test.tsx`
- Modify: `apps/desktop/src/App.css`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/routes/HelpPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpPage } from "./HelpPage";

describe("HelpPage", () => {
  it("renders the user guide's heading and section content", () => {
    render(<HelpPage />);

    expect(
      screen.getByRole("heading", { name: /LifeScribe Vault — User Guide/i, level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Getting Started", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recovery Kit", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/There is no password reset\./),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`):

```powershell
npm run test -- HelpPage
```

Expected: FAIL — `Cannot find module './HelpPage'` (the component doesn't exist yet).

- [ ] **Step 3: Write the component**

Create `apps/desktop/src/routes/HelpPage.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import guideMarkdown from "../../../../docs/user-guide.md?raw";

/**
 * Renders docs/user-guide.md directly — the file is the single source of
 * truth for this content, imported as raw text at build time. No fetch, no
 * vaultApi, no Tauri IPC: this page is fully static and behaves the same
 * regardless of what's in the vault.
 */
export function HelpPage() {
  return (
    <div className="help-page">
      <ReactMarkdown>{guideMarkdown}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 4: Add a TypeScript declaration for the `?raw` import**

Vite's `?raw` suffix isn't recognized by `tsc` by default. Check whether `apps/desktop/src/vite-env.d.ts` already references `vite/client` types:

```powershell
type apps\desktop\src\vite-env.d.ts
```

If it contains `/// <reference types="vite/client" />`, no change is needed — `vite/client` already declares `*.md?raw` style raw-import modules as `string`. If that reference is missing, add it as the first line of `apps/desktop/src/vite-env.d.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run (from `apps/desktop`):

```powershell
npm run test -- HelpPage
```

Expected: PASS (4 assertions).

If it fails with a Vite/Rollup error resolving `../../../../docs/user-guide.md?raw`, re-check Task 2 (the `fs.allow` config) and the relative path — `apps/desktop/src/routes/HelpPage.tsx` to `docs/user-guide.md` is four levels up (`routes` → `src` → `desktop` → `apps` → repo root), i.e. `../../../../docs/user-guide.md`.

- [ ] **Step 6: Add CSS for the rendered markdown**

In `apps/desktop/src/App.css`, after the existing `.settings-section__empty` block (around line 1419), add:

```css
.help-page {
  max-width: 46rem;
  padding: var(--space-7) var(--space-7) var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.help-page h1 {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-tight);
  line-height: var(--leading-tight);
}

.help-page h2 {
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-tight);
  margin-top: var(--space-5);
}

.help-page h3 {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  margin-top: var(--space-4);
}

.help-page p,
.help-page li {
  color: var(--color-ink);
  line-height: var(--leading-normal);
}

.help-page ul,
.help-page ol {
  padding-left: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.help-page blockquote {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--color-accent);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  color: var(--color-ink-secondary);
}

.help-page code {
  font-size: var(--text-xs);
  background: var(--color-surface);
  padding: 0.1em 0.35em;
  border-radius: var(--radius-sm);
}

.help-page a {
  color: var(--color-accent);
}

.help-page hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: var(--space-2) 0;
}
```

If `--leading-normal`, `--radius-md`, `--radius-sm`, or `--space-2` don't already exist as CSS variables, check `apps/desktop/src/App.css`'s `:root` block (top of the file) for the closest equivalents already in use elsewhere and substitute those names instead — don't invent new variable names.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/routes/HelpPage.tsx apps/desktop/src/routes/HelpPage.test.tsx apps/desktop/src/App.css apps/desktop/src/vite-env.d.ts
git commit -m "feat(help): add HelpPage rendering the user guide"
```

(Include `apps/desktop/src/vite-env.d.ts` only if Step 4 actually changed it.)

---

### Task 4: Wire `HelpPage` into `Dashboard`'s routing and sidebar

**Files:**
- Modify: `apps/desktop/src/routes/Dashboard.tsx:88` (import), `:101-106` (Route type), `:1164-1178` (sidebar nav), `:1463-1471` (route rendering)
- Modify: `apps/desktop/src/routes/Dashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/src/routes/Dashboard.test.tsx`, find the existing `describe("Dashboard Settings page", ...)` block (around line 1069) and add a new block immediately after its closing `});`:

```tsx
describe("Dashboard Help page", () => {
  it("shows Help in the main pane with the sidebar nav intact, and a section returns to the dashboard", async () => {
    renderDashboard();
    await screen.findByText("Welcome, Dana");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Help$/ }));

    // Help renders in the right pane, showing the guide's own top-level heading...
    expect(
      await screen.findByRole("heading", { name: /LifeScribe Vault — User Guide/i, level: 1 }),
    ).toBeInTheDocument();
    // ...while the left navigation stays put (a guided-checklist section is still there).
    expect(sidebarSectionButton()).toBeInTheDocument();

    // Navigating to a section from the sidebar leaves Help.
    await user.click(sidebarSectionButton());
    expect(
      screen.queryByRole("heading", { name: /LifeScribe Vault — User Guide/i, level: 1 }),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`):

```powershell
npm run test -- Dashboard
```

Expected: FAIL — no button named "Help" exists yet (`TestingLibraryElementError: Unable to find role="button" and name ...`).

- [ ] **Step 3: Add the `"help"` route kind**

In `apps/desktop/src/routes/Dashboard.tsx`, the `Route` type currently reads (lines 101-106):

```ts
type Route =
  | { kind: "welcome" }
  | { kind: "section"; sectionKey: string }
  | { kind: "recovery-kit" }
  | { kind: "backup" }
  | { kind: "settings" };
```

Change to:

```ts
type Route =
  | { kind: "welcome" }
  | { kind: "section"; sectionKey: string }
  | { kind: "recovery-kit" }
  | { kind: "backup" }
  | { kind: "settings" }
  | { kind: "help" };
```

- [ ] **Step 4: Import `HelpPage`**

Near the other route-component imports (around line 88, right after `import { SettingsPage } from "./SettingsPage";`), add:

```ts
import { HelpPage } from "./HelpPage";
```

- [ ] **Step 5: Add the sidebar nav button**

In the same file, the Settings sidebar `<li>` currently reads (lines 1164-1177):

```tsx
          <li>
            <button
              aria-current={route.kind === "settings" ? "page" : undefined}
              className={
                route.kind === "settings"
                  ? "sidebar__item sidebar__item--active"
                  : "sidebar__item"
              }
              type="button"
              onClick={() => setRoute({ kind: "settings" })}
            >
              <span className="sidebar__item-title">Settings</span>
            </button>
          </li>
        </ul>
      </nav>
```

Change to (adding a new `<li>` for Help immediately after Settings, before the closing `</ul>`):

```tsx
          <li>
            <button
              aria-current={route.kind === "settings" ? "page" : undefined}
              className={
                route.kind === "settings"
                  ? "sidebar__item sidebar__item--active"
                  : "sidebar__item"
              }
              type="button"
              onClick={() => setRoute({ kind: "settings" })}
            >
              <span className="sidebar__item-title">Settings</span>
            </button>
          </li>
          <li>
            <button
              aria-current={route.kind === "help" ? "page" : undefined}
              className={
                route.kind === "help"
                  ? "sidebar__item sidebar__item--active"
                  : "sidebar__item"
              }
              type="button"
              onClick={() => setRoute({ kind: "help" })}
            >
              <span className="sidebar__item-title">Help</span>
            </button>
          </li>
        </ul>
      </nav>
```

- [ ] **Step 6: Render `HelpPage` for the `"help"` route**

In the same file, the route-rendering `else if` chain currently ends with (lines 1463-1471):

```tsx
  } else if (route.kind === "settings") {
    content = (
      <SettingsPage
        vaultDir={vaultDir}
        onRelocate={handleRelocate}
        onChangePassword={changeVaultPassword}
      />
    );
  }
```

Change to:

```tsx
  } else if (route.kind === "settings") {
    content = (
      <SettingsPage
        vaultDir={vaultDir}
        onRelocate={handleRelocate}
        onChangePassword={changeVaultPassword}
      />
    );
  } else if (route.kind === "help") {
    content = <HelpPage />;
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run (from `apps/desktop`):

```powershell
npm run test -- Dashboard
```

Expected: PASS, including the new "Dashboard Help page" test.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/routes/Dashboard.tsx apps/desktop/src/routes/Dashboard.test.tsx
git commit -m "feat(help): wire the Help page into sidebar navigation"
```

---

### Task 5: Full verification and docs

**Files:**
- Modify: `README.md` (if it lists in-app screens/nav — check first)
- Modify: `docs/development.md` (architecture note)

- [ ] **Step 1: Run the full six-gate suite**

From the repo root:

```powershell
npm --prefix apps/desktop run test
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
npm --prefix apps/desktop run typecheck:pack-editor
npm --prefix apps/desktop run lint:pack-editor
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: all six pass. The Rust suite isn't expected to be affected by this change (no Rust files were touched), but run it anyway to confirm nothing else in the working tree is broken.

- [ ] **Step 2: Add a short architecture note to `docs/development.md`**

Search `docs/development.md` for its `### Draft Stash` section (the last item under the "Architecture" heading in `README.md`'s structure, mirrored in `docs/development.md`). Immediately after that section, add:

```markdown
### Help Page
`HelpPage.tsx` renders `docs/user-guide.md` directly via `react-markdown`, importing the file as raw text at build time (Vite's `?raw` suffix). The markdown file is the only copy of this content — there is no separate in-app rewrite to keep in sync. It is fully static: no `vaultApi`, no Tauri IPC, no vault data, reachable from the sidebar once the vault is unlocked.
```

(If `docs/development.md`'s structure differs from this description, add the note in whatever section documents other static/no-IPC route components, such as wherever `SettingsPage`'s App-version display or `BackupPage` is documented — match the existing document's actual organization rather than assuming this exact heading exists.)

- [ ] **Step 3: Check whether `README.md` needs a mention**

`README.md`'s "What It Does" section lists the guided checklist sections (Digital Executors, Password Manager, etc.) — Help is not a checklist section and does not belong in that table. Check the "Architecture" section of `README.md` for a components/pages list; if one exists and mirrors what you added to `docs/development.md`, add a one-line mention there too, in the same style as the existing entries. If no such list exists, skip this step — don't invent a new README section for it.

- [ ] **Step 4: Commit**

```bash
git add docs/development.md README.md
git commit -m "docs: document the in-app Help page"
```

(Only add `README.md` to the commit if Step 3 actually changed it.)

---

## Summary

| Task | Produces |
|---|---|
| 1 | `react-markdown` dependency installed |
| 2 | Vite can read `docs/user-guide.md` across the workspace-root boundary |
| 3 | `HelpPage` component + test + styling, verified in isolation |
| 4 | `HelpPage` wired into Dashboard's sidebar and routing, verified end-to-end |
| 5 | Full six-gate suite green, docs updated |
