# Dashboard Shell — Design

**Status:** Draft — 2026-04-12
**Parent umbrella:** `docs/superpowers/specs/2026-04-12-lifescribe-vault-overview.md` §3.3
**Depends on:** Vault Foundation (merged) and Ingestion Pipeline (merged).

## 1. Purpose

Deliver the first real UI for LifeScribe Vault: a Tauri shell that lets a
user browse the `SourceRecord` notes produced by the Ingestion Pipeline,
import more files (picker + drag-drop) with live job status, inspect
past job logs, and toggle a privacy master-switch. This closes M1
(v0.1): **local files → vault → browse**, shippable as an OSS alpha.

## 2. Scope

**In scope (v1):**
- Fixed sidebar + main pane layout.
- `/browse` — flat list of `SourceRecord` with a client-side filter, click to open a read-only Markdown viewer.
- `/import` — native file picker (Tauri dialog plugin) and a window-level drop-zone; both funnel into `POST /ingest/jobs`. Live progress via 500ms polling of `GET /ingest/jobs/{id}`. Cancel button.
- `/logs` — flat list of `IngestJobLog` notes; click reuses the same Markdown viewer.
- `/settings` — read-only vault path; privacy master-switch persisted to a new `VaultSettings` note type (no enforcement yet).
- New backend endpoints: `GET /vault/notes?type=`, `GET /vault/notes/{id}`, `GET /vault/settings`, `PUT /vault/settings`.

**Explicitly deferred:**
- Note editor, drag-to-reorder, graph view, search, tags UI.
- Hierarchical folders in Browse — flat list only.
- Toast/notification system — errors render inline.
- Multiple concurrent jobs (Ingestion enforces single-flight).
- Playwright / end-to-end browser tests.
- Privacy enforcement (toggle persists but does not gate behavior yet).
- Onboarding beyond the existing FirstRunWizard.

## 3. Invariants honored

| # | Invariant | How this sub-project honors it |
|---|---|---|
| 1 | Vault is system of record | Settings stored as a `VaultSettings` note in the vault. No app-side config DB. |
| 4 | Schema-versioned frontmatter | `VaultSettings` (`schema_version: 1`) added to the Foundation schema module. |
| 5 | Hand-edit safety | `PUT /vault/settings` goes through `VaultStore.write_note`, so hand edits route to conflict files. |
| 12 | Git-backed vault | Each settings save is one commit. Reads are free. |
| 13 | Inspectable in plain Obsidian | Settings note is Markdown with YAML frontmatter at `system/settings.md`. |

## 4. Architecture

### 4.1 Routing

Single-page Tauri app at `apps/desktop/src/`, routes via `react-router-dom` v6:

```
/browse         BrowseRoute        list SourceRecords
/browse/:id     NoteViewerRoute    read-only viewer
/import         ImportRoute        picker + drop-zone + live job status
/logs           LogsRoute          list IngestJobLog
/logs/:id       NoteViewerRoute    same viewer, different source type
/settings       SettingsRoute      vault path + privacy toggle
```

If no vault is open → existing `FirstRunWizard` (unchanged). Else default
redirect to `/browse`.

### 4.2 Shell

`AppShell` owns a fixed left sidebar + `<Outlet/>`. Sidebar entries come
from a static `SECTIONS` array (`{path, label, icon}`) so sub-projects
3.4–3.7 add themselves by appending a line.

### 4.3 Data layer

`@tanstack/react-query` wraps the existing `api/client.ts`. All hooks
live in `src/api/queries.ts`:

```ts
useNotes(type)           // GET /vault/notes?type=…
useNote(id)              // GET /vault/notes/{id}
useJob(id, {enabled})    // GET /ingest/jobs/{id}, 500ms refetchInterval until terminal
useCreateJob()           // POST /ingest/jobs
useCancelJob(id)         // DELETE /ingest/jobs/{id}
useSettings()            // GET /vault/settings
useSaveSettings()        // PUT /vault/settings
```

**Query keys:** `["notes", type]`, `["note", id]`, `["job", id]`, `["settings"]`.

### 4.4 Boundaries

- `api/client.ts` — thin fetch wrapper, no react-query.
- `api/queries.ts` — all query/mutation hooks.
- Routes are presentational; they consume hooks, never call fetch directly.
- `AppShell` knows nothing about route internals.

### 4.5 Styling

CSS Modules per component (`AppShell.module.css`, etc.). No component
kit, no Tailwind. Icons are text/emoji placeholders, replaceable with
SVGs later without touching Sidebar.

## 5. Backend additions

### 5.1 `GET /vault/notes?type=<NoteType>`

Reuses `VaultStore.list_notes(type_=...)`. Returns an array of
frontmatter dicts (no body), sorted by the note's `imported_at` /
`started_at` / `created_at` depending on type (desc).

```http
GET /vault/notes?type=SourceRecord
→ 200 OK
  [
    { "id": "src_report-abc12345", "type": "SourceRecord",
      "title": "Q1 report", "imported_at": "2026-04-12T14:08:03Z", ... },
    ...
  ]
```

Unknown `type` → 400.

### 5.2 `GET /vault/notes/{id}`

Reuses `VaultStore.read_note`. Returns:

```json
{
  "note": { "id": "...", "type": "SourceRecord", ... },
  "body": "## Page 1\n\n..."
}
```

Missing id → 404.

### 5.3 `GET /vault/settings`, `PUT /vault/settings`

- `GET` reads (or synthesizes defaults for) a `VaultSettings` note at
  `system/settings.md`.
- `PUT` accepts the settings frontmatter and writes via
  `VaultStore.write_note`.
- On a fresh vault (no settings file yet), `GET` returns defaults
  without writing. The first `PUT` creates the note.

### 5.4 New note type: `VaultSettings`

Added to `vault/schemas.py` as a new discriminated-union branch:

```python
class VaultSettings(_NoteBase):
    type: Literal["VaultSettings"] = "VaultSettings"
    schema_version: int = 1
    privacy_mode: bool = False   # master-switch; no enforcement yet
```

Routed by `_relative_path_for` to `system/settings.md`. Id prefix:
`settings_`. Singleton — id is always `settings_default` in v1.

## 6. Component breakdown

```
apps/desktop/src/
├── App.tsx                          # existing; add <RouterProvider/>
├── router.tsx                       # NEW — route tree
├── shell/
│   ├── AppShell.tsx                 # sidebar + <Outlet/>
│   ├── AppShell.module.css
│   ├── Sidebar.tsx                  # renders SECTIONS
│   └── sections.ts                  # SECTIONS array
├── routes/
│   ├── BrowseRoute.tsx              # list SourceRecords + filter
│   ├── NoteViewerRoute.tsx          # /browse/:id and /logs/:id
│   ├── ImportRoute.tsx              # picker + drop-zone + live status
│   ├── LogsRoute.tsx                # list IngestJobLog
│   └── SettingsRoute.tsx            # path + privacy toggle
├── components/
│   ├── NoteList.tsx                 # shared list + filter
│   ├── NoteList.module.css
│   ├── MarkdownViewer.tsx           # react-markdown + remark-gfm
│   ├── JobProgress.tsx              # live counters + cancel
│   ├── DropZone.tsx                 # wraps onDragDropEvent
│   └── ErrorBoundary.tsx
├── api/
│   ├── client.ts                    # existing; add notes, note, settings
│   └── queries.ts                   # react-query hooks
└── firstrun/                        # existing
```

**Responsibilities (non-obvious parts only):**

- `NoteList` — generic over `{id, title?, ...}[]`; filter box narrows client-side; `onSelect(id)` is the only outward dependency. Reused verbatim by Browse and Logs.
- `MarkdownViewer` — `react-markdown` + `remark-gfm`. Never fetches.
- `NoteViewerRoute` — route-agnostic; reads `:id` from params and calls `useNote(id)`. Works for SourceRecord and IngestJobLog without branching.
- `DropZone` — registers `getCurrentWebviewWindow().onDragDropEvent` once; exposes `onPaths(string[])`. Does not know what to do with paths.
- `ImportRoute` — owns picker state, DropZone, active-job id, and renders `JobProgress` when active. Single-flight enforced by disabling the picker/drop-zone while `useJob` is still polling.

**Static `SECTIONS`:**

```ts
export const SECTIONS = [
  { path: "/browse",   label: "Browse",   icon: "📄" },
  { path: "/import",   label: "Import",   icon: "⬇" },
  { path: "/logs",     label: "Logs",     icon: "📜" },
  { path: "/settings", label: "Settings", icon: "⚙" },
] as const;
```

## 7. Data flow

### 7.1 Browse

1. `BrowseRoute` → `useNotes("SourceRecord")`
2. `NoteList` renders rows; filter box narrows.
3. Click → `navigate(/browse/:id)`
4. `NoteViewerRoute` → `useNote(id)` → `MarkdownViewer` + frontmatter panel.

### 7.2 Import

1. User selects via `@tauri-apps/plugin-dialog` **or** drops into `DropZone`.
2. Both emit `string[]` of absolute paths → `useCreateJob().mutate({files})`.
3. Mutation returns `{job_id, status: "queued"}`; route records the id.
4. `useJob(job_id)` polls every 500ms; `JobProgress` renders counters live.
5. On terminal status: `refetchInterval` returns `false`; `onSuccess` invalidates `["notes","SourceRecord"]` and `["notes","IngestJobLog"]`.
6. Cancel → `useCancelJob(job_id).mutate()`; polling naturally ends when status flips to `cancelled`.

### 7.3 Logs

1. `LogsRoute` → `useNotes("IngestJobLog")` sorted desc by `started_at`.
2. Click → `/logs/:id` → same `NoteViewerRoute`.

### 7.4 Settings

1. `SettingsRoute` → `useSettings()` prefills form.
2. Submit → `useSaveSettings().mutate()` → invalidates `["settings"]`.

### 7.5 Single-flight import

`ImportRoute` lifts active-job-id into an `ImportContext` so picker/drop-zone
both see "job running — cancel to start another." Backend's 409 is
defense-in-depth.

### 7.6 Cache invalidation

| Action | Invalidates |
|---|---|
| Job reaches terminal | `["notes","SourceRecord"]`, `["notes","IngestJobLog"]` |
| Save settings | `["settings"]` |

No websockets. Polling is deliberate.

## 8. Error handling

### 8.1 Surfaces

**Network / sidecar unreachable.**
- `api/client.ts` throws `ApiError {status, message, detail?}` on non-2xx and `SidecarDownError` on fetch reject.
- Top-level `ErrorBoundary` in `AppShell` catches render throws.
- Per-query: react-query's `error` state renders an inline `<ErrorBanner>` with a "Retry" button.
- `SidecarDownError` → full-screen overlay "Sidecar not responding" + Retry.

**Expected domain errors (4xx):**

| Status | Source | UI |
|---|---|---|
| 409 `POST /ingest/jobs` | Active job exists | Inline banner: "A job is already running." |
| 404 `GET /vault/notes/{id}` | Stale link | Viewer shows "Note not found" + back button |
| 400 `POST /ingest/jobs` | No files | Submit disabled when list empty; server 400 surfaces as inline banner |
| 401 | Bearer mismatch | Full-screen "Authentication lost — restart the app" |

**Per-file failures inside a successful job** — not a UI error. `JobProgress` shows counters `(✓ 5 · ✗ 2 · ⏭ 1)` with red on failures. Click-through to log viewer for details.

### 8.2 Cancellation UX

Button disables, label becomes "Cancelling…" until status → `cancelled`.
Cancel 404 (job already terminal) treated as success; invalidate queries.

### 8.3 Loading states

- `useNotes` initial load → `<Skeleton rows={8}/>`.
- `useNote` → skeleton viewer.
- `useJob` → immediate "Queued…" state.

### 8.4 Copy rules

No stack traces to user. Show `ApiError.detail` if present and short
(<200 chars), else the status text. Dev console always gets the full
error via `console.error`.

## 9. Testing strategy

### 9.1 Frontend — Vitest + React Testing Library

```
apps/desktop/src/
├── shell/__tests__/AppShell.test.tsx
├── components/__tests__/
│   ├── NoteList.test.tsx
│   ├── MarkdownViewer.test.tsx
│   ├── JobProgress.test.tsx
│   └── DropZone.test.tsx
├── routes/__tests__/
│   ├── BrowseRoute.test.tsx
│   ├── NoteViewerRoute.test.tsx
│   ├── ImportRoute.test.tsx
│   ├── LogsRoute.test.tsx
│   └── SettingsRoute.test.tsx
└── api/__tests__/
    ├── client.test.ts
    └── queries.test.ts
```

**Infrastructure:**
- `src/test/renderWithProviders.tsx` — wraps `QueryClientProvider` + `MemoryRouter`.
- `src/test/mockClient.ts` — MSW (`msw` + `msw/node`) for `/vault/*` and `/ingest/*`.
- `src/test/mockTauri.ts` — `vi.mock` for `plugin-dialog` and `getCurrentWebviewWindow`.

**Coverage:**

| Component | Key assertions |
|---|---|
| `AppShell` | Renders sidebar entries; outlet shows for active route |
| `NoteList` | Filter narrows list; click triggers `onSelect` |
| `MarkdownViewer` | GFM table renders; code fence preserved; no XSS |
| `JobProgress` | Counters update on polled responses; cancel fires mutation |
| `DropZone` | `onDragDropEvent` handler wired; extracts paths |
| `BrowseRoute` | List from MSW; skeleton; error banner on 500 |
| `NoteViewerRoute` | Shows frontmatter + body; 404 → "Note not found" |
| `ImportRoute` | Picker + drop both POST; 409 banner; polling updates; cancel flow |
| `LogsRoute` | Lists `IngestJobLog`; click navigates |
| `SettingsRoute` | Form prefills; save invalidates |

### 9.2 Backend — pytest

- `tests/test_api_vault_notes.py` — list by type, unknown type → 400, single-note round trip, 404 on missing.
- `tests/test_api_vault_settings.py` — GET on fresh vault returns defaults, PUT persists, validation rejects unknown fields.
- `tests/vault/test_schemas_vault_settings.py` — Pydantic round-trip, id prefix validator, schema_version gate.

### 9.3 Integration

`tests/integration/test_dashboard_smoke.py` — drives FastAPI `TestClient`:
ingest a txt fixture, poll to terminal, `GET /vault/notes?type=SourceRecord`
and assert the new note appears. Proves Browse-after-Import loop without
a browser.

### 9.4 Type generation

- `scripts/gen-types.sh` regenerates `packages/shared-types/generated.ts`.
- CI gate: `git diff --exit-code` on that file after running the script.

### 9.5 CI

Existing matrix (backend + frontend × Ubuntu / macOS / Windows). New
tests run automatically.

### 9.6 Manual acceptance (pre-merge checklist)

1. First-run wizard → vault initialized.
2. `/import` — pick 3 files (pdf, md, xlsx) → all succeed → Browse shows 3 rows.
3. Drag-drop a csv → row appears.
4. `/browse/:id` — Markdown renders with GFM tables.
5. `/logs` — 2 entries; click shows log.
6. `/settings` — toggle privacy, reload, persists.
7. Cancel mid-flight → status `cancelled`, partial success committed.

## 10. Dependencies

Added to `apps/desktop/package.json`:

- `react-router-dom` ^6.26
- `@tanstack/react-query` ^5.51
- `react-markdown` ^9.0
- `remark-gfm` ^4.0
- `@tauri-apps/plugin-dialog` — already present

Dev:

- `msw` ^2.3
- `@testing-library/react` ^16.0
- `@testing-library/user-event` ^14.5
- `jsdom` ^24.1

No backend dependency additions.

## 11. Success criteria

1. Routes render correctly; sidebar highlights active route.
2. Browse lists every ingested SourceRecord; filter narrows; viewer renders Markdown.
3. Import via picker and drag-drop both kick off jobs and show live progress; cancellation works.
4. Logs lists every job; viewer renders the log table.
5. Settings persists `privacy_mode` across app reloads.
6. `ruff format --check`, `ruff check`, `mypy --strict`, `pytest`, `pnpm --filter lifescribe-desktop test`, `typecheck`, `lint`, `format:check` all clean on CI (Linux, macOS, Windows).
7. User doc `docs/user/browse-and-import.md` ships with the sub-project.

## 12. Non-goals (deferred)

- Note editor, search, tags, graph, folders.
- Toast system.
- Concurrent jobs.
- Privacy enforcement.
- Playwright / browser E2E.
- Onboarding beyond FirstRunWizard.
