# Ingestion Pipeline — Design

**Status:** Draft — 2026-04-12
**Parent umbrella:** `docs/superpowers/specs/2026-04-12-lifescribe-vault-overview.md` §3.2
**Depends on:** `docs/superpowers/specs/2026-04-12-vault-foundation-design.md` (merged)

## 1. Purpose

Convert arbitrary local files into canonical `SourceRecord` notes and
content-addressed assets in the vault. Deliver the first real "files →
vault → browse" loop (M1) on top of the Vault Foundation primitives,
without requiring any UI beyond what the Dashboard Shell (3.3) will
later provide.

## 2. Scope

**In scope (v1):** PDF, DOCX, XLS/XLSX, TXT, MD, HTML, JSON, CSV, images
(metadata + asset copy, no text extraction).

**Explicitly deferred to a follow-up sub-spec:** OCR; ZIP/export-bundle
unpacking; chunking / derived notes; folder watchers; drag-and-drop UI;
multipart file upload over HTTP; concurrent jobs.

## 3. Invariants honored

Every decision below traces to the umbrella invariants:

| # | Invariant | How this sub-project honors it |
|---|---|---|
| 1 | Vault is system of record | Job state lives in an on-disk Markdown log; no sidecar DB. |
| 2 | Every derived fact carries provenance | Each `SourceRecord` records `extractor` (name@version), `extractor_confidence`, `imported_at`, `imported_by_job`. |
| 3 | Deterministic canonical IDs | IDs are composed via Foundation's `compose_id(type="src", slug, short_hash)`; re-importing identical bytes with the same filename is a full no-op. |
| 4 | Schema-versioned frontmatter | A new `IngestJobLog` note type (`schema_version: 1`) is added to the Foundation schema module. |
| 5 | Hand-edit safety | All writes go through `VaultStore.write_note`, which already routes hand-edits to conflict files. |
| 12 | Git-backed vault | Exactly one commit per job, made at terminal state, containing all new notes, assets, and the finalized log. |
| 13 | Inspectable in plain Obsidian | Job logs are Markdown with a GFM table; source bodies are Markdown. |
| 14 | Structured logs | Job logs live at `system/logs/ingest/ingest_<ts>_<jobid>.md`. |

## 4. Architecture

```
apps/backend/src/lifescribe/ingest/
  pipeline.py            # run_job(job): sequential extract → write → commit-at-end
  jobs.py                # Job, JobFile, JobStatus (Pydantic)
  log.py                 # IngestLog read/write + IngestJobLog schema
  mime.py                # detect_mime(path): puremagic + extension fallback
  extractors/
    base.py              # Extractor protocol + ExtractionResult
    registry.py          # ExtractorRegistry keyed on MIME
    text.py              # text/plain, text/markdown
    json_.py             # application/json
    csv_.py              # text/csv
    html_.py             # text/html (trafilatura)
    pdf.py               # application/pdf (pypdfium2 + pdfplumber)
    docx.py              # DOCX (python-docx)
    xlsx.py              # XLSX (openpyxl)
    image.py             # image/* (Pillow, no OCR)

apps/backend/src/lifescribe/api/routers/ingest.py
  POST   /ingest/jobs
  GET    /ingest/jobs/{id}
  DELETE /ingest/jobs/{id}
```

**Boundaries**

- `pipeline.py` is the only module that talks to `VaultStore`.
- Extractors are pure functions of file → `ExtractionResult`. They do
  not read or write the vault.
- Extractor dispatch is registry-based. Adding a format = one extractor
  module + one registry line. No switch statements elsewhere.
- Job persistence is the Markdown log on disk. There is no in-memory
  job store and no SQLite — the API reads and parses the log.

## 5. API surface

All routes are under the existing Bearer-token middleware.

```http
POST /ingest/jobs
  body: { "files": ["/abs/path/a.pdf", "/abs/path/b.docx"] }
  → 202 Accepted
    { "job_id": "job_2026-04-12_14-08-03_abc123",
      "status": "queued", "total": 2 }

  Constraint: at most one active job per vault. A second POST while a
  job is running returns 409 Conflict with the active job_id.

GET /ingest/jobs/{id}
  → 200 OK
    { "job_id": "...",
      "status": "queued" | "running" | "completed"
                | "completed_with_failures" | "cancelled" | "failed",
      "started_at": "...", "finished_at": null | "...",
      "total": 2, "succeeded": 1, "failed": 0,
      "skipped": 0, "cancelled": 0,
      "files": [
        { "path": "/abs/path/a.pdf", "status": "succeeded",
          "source_id": "src_report-abc12345",
          "extractor": "pdf@0.1.0", "error": null },
        ...
      ] }

DELETE /ingest/jobs/{id}
  → 202 Accepted  { "status": "cancelling" }
  Cooperative cancel flag; the current file finishes before commit.
```

**Backgrounding:** `POST` schedules the work as a single
`asyncio.create_task` owned by the FastAPI app lifespan.

**File paths:** absolute local paths only (sidecar is localhost-bound).
Multipart upload is deferred.

**TS types:** Pydantic models regenerated via the existing
`scripts/gen-types.sh`.

## 6. Extractor interface

```python
# extractors/base.py
class ExtractionResult(BaseModel):
    body_markdown: str
    title: str | None = None
    extra_frontmatter: dict[str, Any] = {}
    extractor: str           # "<name>@<version>"
    confidence: float        # 0.0 – 1.0

class Extractor(Protocol):
    mimes: ClassVar[tuple[str, ...]]
    def extract(self, path: Path) -> ExtractionResult: ...
```

All extractors produce GFM Markdown.

| MIME | Lib | Rendering | Notes |
|---|---|---|---|
| `text/plain` | stdlib | raw text, no fence | UTF-8 with BOM strip; `charset-normalizer` fallback for other encodings. |
| `text/markdown` | stdlib | pass-through | Preserve any existing frontmatter as a `` ```yaml `` block inside body. |
| `application/json` | stdlib | pretty-print in `` ```json `` fence | Parse to validate; malformed → per-file failure. |
| `text/csv` | stdlib `csv` | GFM table | `Sniffer` for dialect; truncate at 1000 rows with `…` footer. |
| `text/html` | `trafilatura` | main-content → Markdown | Fall back to full `<body>` when trafilatura finds nothing. |
| `application/pdf` | `pypdfium2` + `pdfplumber` | `## Page N` per page, tables as GFM | Confidence drops below 0.5 if more than half the pages yield no text (signals a scanned PDF that future OCR will handle). |
| DOCX | `python-docx` | headings, lists, tables → Markdown | `core_properties.title/author/subject` → `extra_frontmatter`. |
| XLSX | `openpyxl` | `## Sheet: <name>` per sheet, each as GFM table | Truncate each sheet at 1000 rows. |
| `image/*` | `Pillow` | `![](../90_assets/<hash>/<file>)` in body | EXIF (date taken, camera, GPS), dimensions → `extra_frontmatter`. |

**MIME detection (`mime.py`):** `puremagic` on the first 8KB, fall back
to extension map. Unknown MIME → `status: skipped` in the log with
`error: "unsupported mime: <mime>"` (not a failure — user may install
an extractor later and re-import).

**Versioning:** each extractor declares `NAME` and `VERSION` module
constants. Bumping a version makes re-extraction produce different
bytes, which creates a new commit via the normal idempotency rule.

## 7. Job lifecycle

**State machine**

```
queued → running → completed
                 → completed_with_failures
                 → cancelled
                 → failed               (fatal: disk full, git error, crash)
```

`pipeline.run_job` owns every transition and rewrites the log file
after each one.

**Per-file status** (distinct from job status, recorded in the log
table `Status` column): `running`, `succeeded`, `succeeded_with_conflict`,
`failed`, `skipped`, `skipped_identical`, `cancelled`. Counters in
frontmatter aggregate: `succeeded` and `succeeded_with_conflict` both
increment `succeeded`; `skipped` and `skipped_identical` both
increment `skipped`.

**Log file schema (`IngestJobLog`, schema_version 1)**

`system/logs/ingest/ingest_<started_at>_<job_id>.md`:

```markdown
---
id: job_2026-04-12_14-08-03_abc123
type: IngestJobLog
schema_version: 1
status: completed_with_failures
started_at: 2026-04-12T14:08:03Z
finished_at: 2026-04-12T14:09:41Z
total: 3
succeeded: 1
failed: 1
skipped: 1
cancelled: 0
app_version: 0.2.0
---

# Ingestion job `job_2026-04-12_14-08-03_abc123`

| # | File | Status | Source | Extractor | Error |
|---|------|--------|--------|-----------|-------|
| 1 | /abs/path/a.pdf  | succeeded | src_report-abc12345 | pdf@0.1.0  |   |
| 2 | /abs/path/b.docx | failed    |                     | docx@0.1.0 | DocxNotAZipError |
| 3 | /abs/path/c.zip  | skipped   |                     |            | unsupported mime: application/zip |
```

The `IngestJobLog` note type is added to `vault/schemas.py` (new
discriminated-union branch) and routed to
`system/logs/ingest/<id>.md` by `_relative_path_for` per the
`docs/dev/adding-a-note-type.md` recipe.

**Commit boundary (invariant #12).** Exactly one commit per job, made
at terminal state, containing:

- all new `SourceRecord` notes under `10_sources/`,
- all new assets under `90_assets/<hash[0:2]>/<hash>/`,
- the finalized `IngestJobLog` file.

Commit message: `ingest: <job_id> (<succeeded> ok, <failed> failed, <skipped> skipped)`.

**Crash recovery.** On sidecar startup, any `IngestJobLog` with
`status in ("queued", "running")` is rewritten to `status: failed`
with `error: "interrupted"`. Any staged-but-uncommitted files are
cleared with `git reset --hard HEAD`; because nothing is committed
until job end, an interrupted job never leaves partial notes.

**Cancellation.** `DELETE` flips a cooperative cancel flag in the
in-memory job handle. The worker checks the flag between files; the
currently-running file finishes. The final commit carries the
already-completed files plus the log, with `status: cancelled`.

## 8. On-disk layout (additions to Foundation)

```
vault/
├── 10_sources/                         # existing
│   └── src_<slug>-<short_hash>.md      # one SourceRecord per ingested file
├── 90_assets/                          # existing
│   └── <hash[0:2]>/<hash>/             # e.g. "ab/abc123…/"
│       └── <sanitized-filename>        # byte-identical copy of source
└── system/
    └── logs/
        └── ingest/                     # NEW
            └── ingest_<ts>_<jobid>.md  # IngestJobLog notes
```

**Asset path scheme:** `90_assets/<hash[0:2]>/<hash>/<filename>` where
`hash` is the full sha256 of file bytes and `filename` is the
original name stripped of path separators (extension preserved). The
two-char shard keeps directory listings responsive past a few
thousand assets.

**Deduplication.** Two sources with identical bytes but different
filenames share the asset directory — the second import finds
`<hash>/` already exists, skips the copy, and still records its own
`SourceRecord` under a distinct slug. Identical bytes *and* identical
filename → no-op per Q5-A.

**SourceRecord frontmatter.** No new fields; all fields consumed by
this sub-project (`extractor`, `extractor_confidence`, `imported_at`,
`imported_by_job`, optional `title`) already exist in Foundation.
Ingestion is the first meaningful writer.

## 9. Error handling

| Situation | Behavior |
|---|---|
| Extractor raises on a single file | Log row `status: failed` with `error: <type>: <message>`, continue the batch. |
| Unknown MIME | Log row `status: skipped`, continue. Not counted as a failure. |
| Duplicate filename + identical bytes (re-import) | Log row `status: skipped_identical`, no commit contribution for that file. |
| `VaultStore.write_note` returns a conflict (hand edit detected) | Foundation already writes a sibling `.conflict-*` file; log row `status: succeeded_with_conflict`, `source_id` points at the conflict file. |
| Fatal error before commit (disk full, git broken) | Job `status: failed`, `git reset --hard HEAD`, no commit. |
| Sidecar shutdown mid-job | Same as fatal on next startup. |

## 10. Testing strategy

**Unit — extractors.** One fixture file per format under
`tests/ingest/fixtures/` (happy + edge). Each extractor has a snapshot
test against a golden Markdown file plus assertions on extractor
name/version, confidence, and `extra_frontmatter`.

**Unit — pipeline (fake extractor).**
- Idempotent re-import: zero commits, log shows `skipped_identical`.
- Same filename, changed bytes: new `SourceRecord`, old preserved.
- Mid-batch cancellation: `cancelled`, partial commit with completed files + log.
- Per-file extractor failure: `completed_with_failures`, one commit.
- Fatal `VaultStore.write_note` error: `failed`, no commit, vault clean.
- Unknown MIME: `skipped`, not `failed`.

**Integration — `tests/integration/test_ingest_end_to_end.py`.**
Spin up `VaultStore` in `tmp_path`, ingest a batch of six real files
(one per text format: txt/md/json/csv/html/pdf), assert:
- exactly one new commit in the vault,
- six `SourceRecord` notes at the expected paths with deterministic IDs,
- asset directories present,
- the job log parses as `IngestJobLog` with correct counts.

**API — `tests/test_api_ingest_routes.py`.**
- `POST` then poll `GET` until terminal; assert shape matches the
  TS-generated type.
- `DELETE` mid-run → terminal state is `cancelled`.
- Second `POST` while a job runs → `409 Conflict`.

**Golden-file refresh:** `uv run pytest --update-golden` regenerates
snapshots; reviewed in PRs.

## 11. Dependencies

Added to `apps/backend/pyproject.toml` under `[project.dependencies]`:

- `pypdfium2` — Apache 2.0 — PDF text
- `pdfplumber` — MIT — PDF tables
- `python-docx` — MIT — DOCX
- `openpyxl` — MIT — XLSX
- `trafilatura` — Apache 2.0 — HTML → Markdown
- `Pillow` — HPND — image metadata
- `puremagic` — MIT — MIME sniffing
- `charset-normalizer` — MIT — non-UTF-8 text fallback

Expected PyInstaller sidecar size: well under 150MB. No frontend
dependency changes.

## 12. Success criteria

1. All eight extractors (covering nine MIME types) produce correct Markdown on their fixtures.
2. `POST /ingest/jobs` with a mixed batch reaches a terminal state and
   leaves the vault in the expected shape.
3. Re-running the same batch produces zero new commits.
4. Cancel mid-batch leaves a consistent, inspectable vault with the
   completed files committed.
5. `ruff format --check`, `ruff check`, `mypy --strict`, and `pytest`
   are clean on CI for Linux, macOS, Windows.
6. User doc `docs/user/import-files.md` and dev doc
   `docs/dev/adding-an-extractor.md` ship with the sub-project.

## 13. Non-goals (deferred)

- OCR (scanned PDFs, image text).
- ZIP / export-bundle unpacking.
- Chunking and derived notes (belongs to 3.5 Chat with Vault).
- Drag-and-drop UI, Import Center, ingestion log viewer (belongs to
  3.3 Dashboard Shell).
- Folder watching and automatic imports.
- Multipart file upload over HTTP (relevant only to a remote-sidecar
  scenario not supported in v1).
- More than one concurrent job per vault.
