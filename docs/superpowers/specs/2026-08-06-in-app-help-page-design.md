# In-app Help page — design

**Date:** 2026-08-06
**Status:** Approved (brainstorm)

## Problem

`docs/user-guide.md` explains recovery-critical behavior — there is no
password reset, how attachments/backups/restore work, what the Recovery Kit
does and doesn't include — but it only exists in the GitHub repo. A user who
needs it (confused about a feature, worried about data loss) has to leave the
100%-local app and go find it online, which cuts against the app's own
"nothing depends on the network" premise and adds friction exactly when a user
is already anxious.

## Goals

1. The user guide is readable from inside the app, reachable in one click from
   the main navigation.
2. `docs/user-guide.md` remains the single source of truth — no second copy of
   the content to keep in sync by hand.
3. No new runtime dependency on vault data, Tauri IPC, or network access; the
   page works identically to every other static page in the app.

## Non-goals (deferred, not needed for v1)

- Access from the Locked/Setup screens. Help is reachable only once the vault
  is unlocked, alongside Recovery Kit/Backup/Settings — the same place a user
  already looks for "how does this work" answers.
- A table of contents or in-page anchor navigation. The guide is rendered as
  one scrollable page; the browser/WebView's native find-in-page covers
  lookup. The guide's few internal anchor links (e.g.
  `[Where your vault is stored](#where-your-vault-is-stored)`) will render as
  inert links with no heading-id/TOC infrastructure to resolve them — harmless
  no-ops, not worth solving now.
- Search, print, or export of the Help content — it's already available as a
  file in the repo for anyone who wants that.

## Approach

### Content source: render the markdown file at runtime

`docs/user-guide.md` is bundled as a static asset and rendered directly, not
duplicated as hand-written JSX and not precompiled to HTML at build time.
Editing the `.md` file is the only thing anyone ever needs to do — the in-app
page and the GitHub-rendered doc can never drift apart.

- **Renderer:** `react-markdown`, a new frontend dependency. It's AST-based —
  it never uses `dangerouslySetInnerHTML` and does not render raw embedded
  HTML unless a plugin explicitly opts in. `docs/user-guide.md` contains no
  raw HTML and no tables, so no additional remark/rehype plugins are needed.
- **Import:** `docs/user-guide.md` is imported with Vite's `?raw` suffix
  (`import guideMarkdown from "../../../../docs/user-guide.md?raw"`), which
  inlines the file's text content as a JS string at build time. Since the file
  lives outside `apps/desktop` (the Vite project root), `vite.config.ts` needs
  `server.fs.allow: [searchForWorkspaceRoot(process.cwd())]` — Vite's own
  documented fix for a monorepo importing across the workspace-root boundary.
  This is the only config change required; no build step, no generated or
  copied file.

### Component

`apps/desktop/src/routes/HelpPage.tsx` — a route component matching the shape
of `SettingsPage.tsx`/`BackupPage.tsx`: no props beyond what routing needs, no
state, renders `<ReactMarkdown>{guideMarkdown}</ReactMarkdown>` inside a
scrollable `.help-page` container.

A new CSS block in `App.css` styles the rendered markdown elements (`h1`–`h3`,
`p`, `ul`/`li`, `blockquote`, `code`, `a`) to match the app's existing
typography. This is the one place the guide's content structure is reflected
outside the markdown file itself — CSS selectors targeting element types, not
a second copy of any content.

### Navigation

`Dashboard.tsx`'s route union gains `"help"` alongside the existing
`"recovery-kit" | "backup" | "settings"`. A "Help" sidebar item is added after
Settings, following the same nav-item pattern (icon, label, active-state
styling, click handler) as the other three.

### Data flow

None. `HelpPage` touches no `vaultApi`, no Tauri IPC, no vault data. It is
fully static and behaves identically regardless of what's in the vault. This
also means there is no new security surface — nothing rendered here can
depend on or leak vault content, and the risk profile is the same as any other
static page in the app.

### Error handling

None needed. The `?raw` import is resolved at build time; if the file were
ever missing or the import misconfigured, the build fails — there is no
runtime failure mode, so no loading state or fallback UI is warranted.

## Testing

- `apps/desktop/src/routes/HelpPage.test.tsx` — renders the page and asserts
  a few known strings/headings from the guide appear (e.g. "Getting Started",
  "Recovery Kit"), confirming the markdown pipeline actually renders content
  rather than just not-crashing.
- `apps/desktop/src/routes/Dashboard.test.tsx` — extend the existing
  nav-switching test coverage (the same pattern already used for
  Recovery Kit/Backup/Settings) to cover clicking "Help" and landing on the
  Help page.

## Summary of decisions

| Question | Decision |
|---|---|
| Content source | Render `docs/user-guide.md` at runtime via `react-markdown` + Vite `?raw` import |
| Availability | Unlocked only (sidebar nav, alongside Recovery Kit/Backup/Settings) |
| In-page navigation | Scrollable page only, no table of contents (v1) |
