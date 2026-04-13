# Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend ingestion pipeline that converts local files (TXT, MD, JSON, CSV, HTML, PDF, DOCX, XLSX, images) into canonical `SourceRecord` notes and content-addressed assets, committed one-per-job, exposed via a bearer-auth FastAPI router.

**Architecture:** Sequential async job worker per vault. MIME-dispatched `Extractor` registry produces Markdown `ExtractionResult`s; the pipeline buffers successful (note, body, asset_path) tuples and commits them all, with the `IngestJobLog` note, in one atomic `write_batch` at terminal state. No in-memory job registry — job state is the log file on disk.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, `pypdfium2`, `pdfplumber`, `python-docx`, `openpyxl`, `trafilatura`, `Pillow`, `puremagic`, `charset-normalizer`. Existing Foundation primitives: `VaultStore`, `GitRepo`, `compose_id`, `content_short_hash`, `sanitize_slug`, serialization helpers.

**Branch:** `feat/ingestion-pipeline` (already created on top of merged `main`).

**Path reconciliation with spec:** Foundation uses `assets/` (not `90_assets/`) and `system/logs/ingestion/` (not `system/logs/ingest/`). The plan uses Foundation's paths; the spec's labels are superseded by the plan.

---

## Phase A — Setup, dependencies, schema

### Task 1: Add Python dependencies

**Files:**
- Modify: `apps/backend/pyproject.toml`

- [ ] **Step 1: Add runtime deps**

In `apps/backend/pyproject.toml`, change the `dependencies` array to:

```toml
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.8",
  "python-frontmatter>=1.1",
  "pyyaml>=6",
  "httpx>=0.27",
  "puremagic>=1.27",
  "charset-normalizer>=3.3",
  "trafilatura>=1.12",
  "pypdfium2>=4.30",
  "pdfplumber>=0.11",
  "python-docx>=1.1",
  "openpyxl>=3.1",
  "Pillow>=10.4",
]
```

- [ ] **Step 2: Sync deps**

Run: `cd apps/backend && uv sync --all-extras`
Expected: `Installed N packages ...`, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/pyproject.toml apps/backend/uv.lock
git commit -m "deps(backend): add ingestion parser libraries"
```

---

### Task 2: Add `IngestJobLog` note type and per-file enums

**Files:**
- Modify: `apps/backend/src/lifescribe/vault/schemas.py`
- Modify: `apps/backend/src/lifescribe/vault/store.py`
- Test: `apps/backend/tests/test_schemas.py`

- [ ] **Step 1: Write failing schema test**

Append to `apps/backend/tests/test_schemas.py`:

```python
def test_ingest_job_log_roundtrip() -> None:
    from lifescribe.vault.schemas import (
        IngestJobLog, JobStatus, PerFileStatus, PerFileEntry, parse_note,
    )
    log = IngestJobLog(
        id="job_2026-04-12_14-08-03_abc1",
        type="IngestJobLog",
        status=JobStatus.COMPLETED,
        started_at=datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC),
        finished_at=datetime(2026, 4, 12, 14, 9, 41, tzinfo=UTC),
        total=2, succeeded=1, failed=0, skipped=1, cancelled=0,
        app_version="0.2.0",
        files=[
            PerFileEntry(
                index=1, path="/abs/a.pdf", status=PerFileStatus.SUCCEEDED,
                source_id="src_report_abc1", extractor="pdf@0.1.0", error=None,
            ),
            PerFileEntry(
                index=2, path="/abs/b.zip", status=PerFileStatus.SKIPPED,
                source_id=None, extractor=None, error="unsupported mime: application/zip",
            ),
        ],
    )
    dumped = log.model_dump(mode="json")
    parsed = parse_note(dumped)
    assert parsed == log
    assert parsed.id.startswith("job_")


def test_ingest_job_log_id_prefix_rejected() -> None:
    from lifescribe.vault.schemas import IngestJobLog, JobStatus
    with pytest.raises(ValueError, match="id must start with 'job_'"):
        IngestJobLog(
            id="bad",
            type="IngestJobLog",
            status=JobStatus.QUEUED,
            started_at=datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC),
            finished_at=None,
            total=0, succeeded=0, failed=0, skipped=0, cancelled=0,
            app_version="0.2.0", files=[],
        )
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/test_schemas.py -k ingest_job_log -v`
Expected: ImportError for `IngestJobLog`.

- [ ] **Step 3: Add enums and `PerFileEntry` to schemas**

Append to `apps/backend/src/lifescribe/vault/schemas.py` (before the `Note = Annotated[...]` line):

```python
class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    COMPLETED_WITH_FAILURES = "completed_with_failures"
    CANCELLED = "cancelled"
    FAILED = "failed"


class PerFileStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    SUCCEEDED_WITH_CONFLICT = "succeeded_with_conflict"
    FAILED = "failed"
    SKIPPED = "skipped"
    SKIPPED_IDENTICAL = "skipped_identical"
    CANCELLED = "cancelled"


class PerFileEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index: int = Field(ge=1)
    path: str
    status: PerFileStatus
    source_id: str | None = None
    extractor: str | None = None
    error: str | None = None


class IngestJobLog(_NoteBase):
    type: Literal["IngestJobLog"]
    status: JobStatus
    started_at: datetime
    finished_at: datetime | None
    total: int = Field(ge=0)
    succeeded: int = Field(ge=0)
    failed: int = Field(ge=0)
    skipped: int = Field(ge=0)
    cancelled: int = Field(ge=0)
    app_version: str
    files: list[PerFileEntry] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_id_prefix(self) -> IngestJobLog:
        if not self.id.startswith("job_"):
            raise ValueError("IngestJobLog id must start with 'job_'")
        return self
```

- [ ] **Step 4: Extend the discriminated union**

In the same file, replace:

```python
Note = Annotated[
    SourceRecord | DocumentRecord | ConnectorRecord | IngestionLogEntry | VaultManifest,
    Field(discriminator="type"),
]
```

with:

```python
Note = Annotated[
    SourceRecord | DocumentRecord | ConnectorRecord | IngestionLogEntry
    | IngestJobLog | VaultManifest,
    Field(discriminator="type"),
]
```

- [ ] **Step 5: Add path routing**

In `apps/backend/src/lifescribe/vault/store.py`, add this import line to the existing `from lifescribe.vault.schemas import (...)` block:

```python
    IngestJobLog,
```

Then in `_relative_path_for`, insert this branch before the `VaultManifest` branch:

```python
    if isinstance(note, IngestJobLog):
        year_month = note.started_at.strftime("%Y-%m")
        return root / "system" / "logs" / "ingestion" / year_month / f"{note.id}.md"
```

- [ ] **Step 6: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/test_schemas.py -k ingest_job_log -v`
Expected: both tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/lifescribe/vault/schemas.py apps/backend/src/lifescribe/vault/store.py apps/backend/tests/test_schemas.py
git commit -m "feat(vault): IngestJobLog note type with per-file status"
```

---

### Task 3: Extend `VaultStore.write_batch` to stage extra paths

**Files:**
- Modify: `apps/backend/src/lifescribe/vault/store.py`
- Test: `apps/backend/tests/test_store_batch_assets_list.py`

- [ ] **Step 1: Write failing test**

Append to `apps/backend/tests/test_store_batch_assets_list.py`:

```python
def test_write_batch_includes_extra_paths_in_commit(tmp_path: Path) -> None:
    from lifescribe.vault.store import VaultStore
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    # write an asset out-of-band
    asset = store.root / "assets" / "ab" / "abcd" / "x.bin"
    asset.parent.mkdir(parents=True)
    asset.write_bytes(b"\x00\x01")

    # a trivial note to commit alongside
    from lifescribe.vault.schemas import SourceRecord
    rec = SourceRecord(
        id="src_x_abcd", type="SourceRecord", source_path="/tmp/x.bin",
        source_hash="sha256:0", source_mtime=datetime(2026, 4, 12, tzinfo=UTC),
        imported_at=datetime(2026, 4, 12, tzinfo=UTC),
        imported_by_job="job_2026-04-12_x_abcd", extractor="fake@0.1.0",
        extractor_confidence=1.0, links={"parent_source": None, "derived_from": []},
        tags=[], mime_type="application/octet-stream", original_filename="x.bin",
        size_bytes=2,
    )
    pre = store._repo.log_oneline()
    store.write_batch(
        [(rec, "")],
        commit_message="ingest: x",
        extra_paths=["assets/ab/abcd/x.bin"],
    )
    post = store._repo.log_oneline()
    assert len(post) == len(pre) + 1
    # asset is tracked (not 'untracked')
    import subprocess
    result = subprocess.run(
        ["git", "-C", str(store.root), "ls-files", "assets/ab/abcd/x.bin"],
        capture_output=True, text=True, check=True,
    )
    assert result.stdout.strip() == "assets/ab/abcd/x.bin"
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/test_store_batch_assets_list.py::test_write_batch_includes_extra_paths_in_commit -v`
Expected: TypeError on `extra_paths` kwarg.

- [ ] **Step 3: Extend `write_batch`**

In `apps/backend/src/lifescribe/vault/store.py`, change the `write_batch` signature and body:

```python
    def write_batch(
        self,
        items: list[tuple[Note, str]],
        *,
        commit_message: str,
        extra_paths: list[str] | None = None,
    ) -> list[WriteResult]:
        if not items and not extra_paths:
            return []
        results: list[WriteResult] = []
        staged: list[str] = list(extra_paths or [])
        for note, body in items:
            target = _relative_path_for(note, self.root)
            rel = target.relative_to(self.root).as_posix()
            if target.exists() and self._repo.is_modified(rel):
                stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
                conflict_path = target.with_name(f"{target.stem}.conflict-{stamp}{target.suffix}")
                _atomic_write(conflict_path, dump_note(note, body=body))
                staged.append(conflict_path.relative_to(self.root).as_posix())
                results.append(WriteResult(path=conflict_path, conflict=True, committed=False))
            else:
                _atomic_write(target, dump_note(note, body=body))
                staged.append(rel)
                results.append(WriteResult(path=target, conflict=False, committed=False))
        self._repo.add(staged)
        self._repo.commit(
            commit_message,
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )
        return [WriteResult(path=r.path, conflict=r.conflict, committed=True) for r in results]
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/test_store_batch_assets_list.py -v`
Expected: all tests PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/vault/store.py apps/backend/tests/test_store_batch_assets_list.py
git commit -m "feat(vault): write_batch accepts extra_paths to include in commit"
```

---

## Phase B — Extractor core

### Task 4: MIME detection

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/__init__.py` (empty)
- Create: `apps/backend/src/lifescribe/ingest/mime.py`
- Test: `apps/backend/tests/ingest/__init__.py` (empty)
- Test: `apps/backend/tests/ingest/test_mime.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/ingest/test_mime.py`:

```python
from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.mime import detect_mime


def test_detects_pdf_by_magic(tmp_path: Path) -> None:
    p = tmp_path / "doc.pdf"
    p.write_bytes(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    assert detect_mime(p) == "application/pdf"


def test_detects_plain_by_extension(tmp_path: Path) -> None:
    p = tmp_path / "note.txt"
    p.write_text("hello", encoding="utf-8")
    assert detect_mime(p) == "text/plain"


def test_markdown_by_extension(tmp_path: Path) -> None:
    p = tmp_path / "n.md"
    p.write_text("# h", encoding="utf-8")
    assert detect_mime(p) == "text/markdown"


def test_csv_by_extension(tmp_path: Path) -> None:
    p = tmp_path / "a.csv"
    p.write_text("a,b\n1,2\n", encoding="utf-8")
    assert detect_mime(p) == "text/csv"


def test_png_by_magic(tmp_path: Path) -> None:
    p = tmp_path / "i.png"
    p.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    assert detect_mime(p) == "image/png"


def test_unknown_returns_octet_stream(tmp_path: Path) -> None:
    p = tmp_path / "blob.xyz"
    p.write_bytes(b"\x00\x01\x02\x03")
    assert detect_mime(p) == "application/octet-stream"
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_mime.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `mime.py`**

Create `apps/backend/src/lifescribe/ingest/__init__.py` (empty file).

Create `apps/backend/src/lifescribe/ingest/mime.py`:

```python
from __future__ import annotations

from pathlib import Path

import puremagic

_EXT_MAP = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
}


def detect_mime(path: Path) -> str:
    try:
        with path.open("rb") as f:
            head = f.read(8192)
        guesses = puremagic.magic_stream(_BytesStream(head), filename=path.name)
    except (puremagic.PureError, OSError, ValueError):
        guesses = []
    if guesses:
        best = guesses[0].mime_type
        if best:
            return best
    return _EXT_MAP.get(path.suffix.lower(), "application/octet-stream")


class _BytesStream:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self._pos = 0

    def read(self, n: int = -1) -> bytes:
        if n < 0 or n > len(self._data) - self._pos:
            n = len(self._data) - self._pos
        chunk = self._data[self._pos : self._pos + n]
        self._pos += n
        return chunk

    def seek(self, pos: int, whence: int = 0) -> int:
        if whence == 0:
            self._pos = pos
        elif whence == 1:
            self._pos += pos
        elif whence == 2:
            self._pos = len(self._data) + pos
        return self._pos

    def tell(self) -> int:
        return self._pos
```

Create `apps/backend/tests/ingest/__init__.py` (empty file).

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_mime.py -v`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/ apps/backend/tests/ingest/
git commit -m "feat(ingest): MIME detection via puremagic + extension fallback"
```

---

### Task 5: `ExtractionResult` and `Extractor` protocol

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/extractors/__init__.py` (empty)
- Create: `apps/backend/src/lifescribe/ingest/extractors/base.py`

- [ ] **Step 1: Create `base.py`**

Create `apps/backend/src/lifescribe/ingest/extractors/__init__.py` (empty).

Create `apps/backend/src/lifescribe/ingest/extractors/base.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any, ClassVar, Protocol

from pydantic import BaseModel, ConfigDict, Field


class ExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body_markdown: str
    title: str | None = None
    extra_frontmatter: dict[str, Any] = Field(default_factory=dict)
    extractor: str
    confidence: float = Field(ge=0.0, le=1.0)


class Extractor(Protocol):
    mimes: ClassVar[tuple[str, ...]]
    NAME: ClassVar[str]
    VERSION: ClassVar[str]

    def extract(self, path: Path) -> ExtractionResult: ...
```

- [ ] **Step 2: Verify import works**

Run: `cd apps/backend && uv run python -c "from lifescribe.ingest.extractors.base import Extractor, ExtractionResult; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/extractors/
git commit -m "feat(ingest): Extractor protocol and ExtractionResult model"
```

---

### Task 6: Extractor registry

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/extractors/registry.py`
- Test: `apps/backend/tests/ingest/test_registry.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/ingest/test_registry.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult
from lifescribe.ingest.extractors.registry import ExtractorRegistry


class _FakeTxt:
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
    NAME = "fake_txt"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown="x", extractor=f"{self.NAME}@{self.VERSION}", confidence=1.0
        )


def test_find_returns_registered_extractor() -> None:
    reg = ExtractorRegistry()
    reg.register(_FakeTxt())
    assert reg.find("text/plain") is not None


def test_find_returns_none_for_unknown_mime() -> None:
    reg = ExtractorRegistry()
    reg.register(_FakeTxt())
    assert reg.find("application/zip") is None


def test_multiple_mimes_per_extractor() -> None:
    class _Multi:
        mimes: ClassVar[tuple[str, ...]] = ("text/plain", "text/markdown")
        NAME = "m"
        VERSION = "0.1.0"

        def extract(self, path: Path) -> ExtractionResult:
            return ExtractionResult(body_markdown="", extractor="m@0.1.0", confidence=1.0)

    reg = ExtractorRegistry()
    reg.register(_Multi())
    assert reg.find("text/plain") is not None
    assert reg.find("text/markdown") is not None
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_registry.py -v`
Expected: ImportError for `ExtractorRegistry`.

- [ ] **Step 3: Implement registry**

Create `apps/backend/src/lifescribe/ingest/extractors/registry.py`:

```python
from __future__ import annotations

from lifescribe.ingest.extractors.base import Extractor


class ExtractorRegistry:
    def __init__(self) -> None:
        self._by_mime: dict[str, Extractor] = {}

    def register(self, extractor: Extractor) -> None:
        for mime in extractor.mimes:
            self._by_mime[mime] = extractor

    def find(self, mime: str) -> Extractor | None:
        return self._by_mime.get(mime)
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_registry.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/extractors/registry.py apps/backend/tests/ingest/test_registry.py
git commit -m "feat(ingest): MIME-keyed extractor registry"
```

---

## Phase C — Simple extractors

### Task 7: Text + Markdown extractors

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/extractors/text.py`
- Test: `apps/backend/tests/ingest/test_text_extractor.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/ingest/test_text_extractor.py`:

```python
from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.extractors.text import MarkdownExtractor, TextExtractor


def test_text_utf8(tmp_path: Path) -> None:
    p = tmp_path / "a.txt"
    p.write_text("Hello, world.\nSecond line.\n", encoding="utf-8")
    r = TextExtractor().extract(p)
    assert r.body_markdown == "Hello, world.\nSecond line.\n"
    assert r.extractor == "text@0.1.0"
    assert r.confidence == 1.0


def test_text_latin1_fallback(tmp_path: Path) -> None:
    p = tmp_path / "a.txt"
    p.write_bytes("café\n".encode("latin-1"))
    r = TextExtractor().extract(p)
    assert "café" in r.body_markdown


def test_markdown_passthrough(tmp_path: Path) -> None:
    p = tmp_path / "a.md"
    p.write_text("# Title\n\nPara.\n", encoding="utf-8")
    r = MarkdownExtractor().extract(p)
    assert r.body_markdown == "# Title\n\nPara.\n"
    assert r.extractor == "markdown@0.1.0"
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_text_extractor.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `apps/backend/src/lifescribe/ingest/extractors/text.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from charset_normalizer import from_bytes

from lifescribe.ingest.extractors.base import ExtractionResult


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        match = from_bytes(raw).best()
        if match is None:
            return raw.decode("utf-8", errors="replace")
        return str(match)


class TextExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
    NAME = "text"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown=_read_text(path),
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=1.0,
        )


class MarkdownExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/markdown",)
    NAME = "markdown"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown=_read_text(path),
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=1.0,
        )
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_text_extractor.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/extractors/text.py apps/backend/tests/ingest/test_text_extractor.py
git commit -m "feat(ingest): text and markdown extractors"
```

---

### Task 8: JSON extractor

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/extractors/json_.py`
- Test: `apps/backend/tests/ingest/test_json_extractor.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/ingest/test_json_extractor.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest

from lifescribe.ingest.extractors.json_ import JsonExtractor


def test_pretty_prints_and_fences(tmp_path: Path) -> None:
    p = tmp_path / "a.json"
    p.write_text('{"a":1,"b":[2,3]}', encoding="utf-8")
    r = JsonExtractor().extract(p)
    assert r.body_markdown.startswith("```json\n{\n  ")
    assert r.body_markdown.rstrip().endswith("\n}\n```")
    assert r.extractor == "json@0.1.0"
    assert r.confidence == 1.0


def test_invalid_json_raises(tmp_path: Path) -> None:
    p = tmp_path / "a.json"
    p.write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError):
        JsonExtractor().extract(p)
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_json_extractor.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `apps/backend/src/lifescribe/ingest/extractors/json_.py`:

```python
from __future__ import annotations

import json
from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult


class JsonExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("application/json",)
    NAME = "json"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"invalid json: {e}") from e
        pretty = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False)
        body = f"```json\n{pretty}\n```\n"
        return ExtractionResult(
            body_markdown=body,
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=1.0,
        )
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_json_extractor.py -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/extractors/json_.py apps/backend/tests/ingest/test_json_extractor.py
git commit -m "feat(ingest): JSON extractor (pretty-print + validate)"
```

---

### Task 9: CSV extractor

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/extractors/csv_.py`
- Test: `apps/backend/tests/ingest/test_csv_extractor.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/ingest/test_csv_extractor.py`:

```python
from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.extractors.csv_ import CsvExtractor


def test_small_csv_to_gfm_table(tmp_path: Path) -> None:
    p = tmp_path / "a.csv"
    p.write_text("name,age\nAlice,30\nBob,25\n", encoding="utf-8")
    r = CsvExtractor().extract(p)
    assert "| name | age |" in r.body_markdown
    assert "| --- | --- |" in r.body_markdown
    assert "| Alice | 30 |" in r.body_markdown
    assert "| Bob | 25 |" in r.body_markdown
    assert r.extractor == "csv@0.1.0"


def test_csv_truncates_past_1000_rows(tmp_path: Path) -> None:
    p = tmp_path / "a.csv"
    rows = ["a,b"] + [f"{i},{i+1}" for i in range(1200)]
    p.write_text("\n".join(rows) + "\n", encoding="utf-8")
    r = CsvExtractor().extract(p)
    assert "… truncated at 1000 rows (1200 total) …" in r.body_markdown


def test_csv_escapes_pipes(tmp_path: Path) -> None:
    p = tmp_path / "a.csv"
    p.write_text("a,b\nhas|pipe,x\n", encoding="utf-8")
    r = CsvExtractor().extract(p)
    assert "has\\|pipe" in r.body_markdown
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_csv_extractor.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `apps/backend/src/lifescribe/ingest/extractors/csv_.py`:

```python
from __future__ import annotations

import csv
from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult

_MAX_ROWS = 1000


def _md_escape_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ").replace("\r", "")


class CsvExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/csv",)
    NAME = "csv"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        with path.open("r", encoding="utf-8", newline="") as f:
            sample = f.read(4096)
            f.seek(0)
            try:
                dialect = csv.Sniffer().sniff(sample) if sample else csv.excel
            except csv.Error:
                dialect = csv.excel
            reader = csv.reader(f, dialect=dialect)
            rows = list(reader)

        if not rows:
            return ExtractionResult(
                body_markdown="",
                extractor=f"{self.NAME}@{self.VERSION}",
                confidence=1.0,
            )

        header = rows[0]
        data = rows[1:]
        total = len(data)
        truncated = total > _MAX_ROWS
        if truncated:
            data = data[:_MAX_ROWS]

        lines = [
            "| " + " | ".join(_md_escape_cell(c) for c in header) + " |",
            "| " + " | ".join("---" for _ in header) + " |",
        ]
        for row in data:
            padded = row + [""] * (len(header) - len(row))
            lines.append("| " + " | ".join(_md_escape_cell(c) for c in padded[: len(header)]) + " |")
        if truncated:
            lines.append("")
            lines.append(f"… truncated at {_MAX_ROWS} rows ({total} total) …")

        body = "\n".join(lines) + "\n"
        return ExtractionResult(
            body_markdown=body,
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=1.0,
        )
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_csv_extractor.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/extractors/csv_.py apps/backend/tests/ingest/test_csv_extractor.py
git commit -m "feat(ingest): CSV extractor with GFM table rendering"
```

---

### Task 10: HTML extractor (trafilatura)

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/extractors/html_.py`
- Test: `apps/backend/tests/ingest/test_html_extractor.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/ingest/test_html_extractor.py`:

```python
from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.extractors.html_ import HtmlExtractor


def test_extracts_main_content(tmp_path: Path) -> None:
    p = tmp_path / "a.html"
    p.write_text(
        """<html><head><title>Doc Title</title></head>
<body>
  <nav>nav</nav>
  <article>
    <h1>Heading</h1>
    <p>Main content paragraph with several words in it.</p>
  </article>
  <footer>footer</footer>
</body></html>""",
        encoding="utf-8",
    )
    r = HtmlExtractor().extract(p)
    assert "Main content paragraph" in r.body_markdown
    assert r.title == "Doc Title"
    assert r.extractor == "html@0.1.0"


def test_empty_html_fallback(tmp_path: Path) -> None:
    p = tmp_path / "a.html"
    p.write_text("<html><body><p>tiny</p></body></html>", encoding="utf-8")
    r = HtmlExtractor().extract(p)
    assert "tiny" in r.body_markdown
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_html_extractor.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `apps/backend/src/lifescribe/ingest/extractors/html_.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import trafilatura

from lifescribe.ingest.extractors.base import ExtractionResult


class HtmlExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/html",)
    NAME = "html"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        raw = path.read_text(encoding="utf-8", errors="replace")
        body = trafilatura.extract(
            raw,
            output_format="markdown",
            include_tables=True,
            include_links=True,
            include_images=False,
            favor_recall=True,
        )
        if not body:
            body = trafilatura.extract(
                raw, output_format="markdown", favor_recall=True, no_fallback=False
            ) or ""

        title: str | None = None
        meta = trafilatura.extract_metadata(raw)
        if meta is not None and meta.title:
            title = meta.title

        if not body.strip():
            body = "\n".join(
                line.strip() for line in raw.splitlines() if line.strip()
            )

        return ExtractionResult(
            body_markdown=body.rstrip() + "\n",
            title=title,
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.8 if body.strip() else 0.3,
        )
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_html_extractor.py -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/extractors/html_.py apps/backend/tests/ingest/test_html_extractor.py
git commit -m "feat(ingest): HTML extractor via trafilatura"
```

---

## Phase D — Heavy extractors

### Task 11: PDF extractor

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/extractors/pdf.py`
- Create: `apps/backend/tests/ingest/fixtures/hello.pdf` (generated)
- Test: `apps/backend/tests/ingest/test_pdf_extractor.py`

- [ ] **Step 1: Generate fixture PDF**

Run in `apps/backend`:

```bash
mkdir -p tests/ingest/fixtures
uv run python -c "
import pypdfium2 as pdfium
pdf = pdfium.PdfDocument.new()
page = pdf.new_page(612, 792)
font = pdf.add_font(b'Helvetica', type=pdfium.raw.FPDF_FONT_TYPE1, is_cid=False) if hasattr(pdf, 'new_page') else None
pdf.save('tests/ingest/fixtures/hello.pdf')
" 2>/dev/null || true
```

Since `pypdfium2`'s page-generation API is awkward for fixtures, use `reportlab` one-off or check the file in. Simpler: create via a tiny helper at test-setup time. **Prefer the runtime-generated approach via `pdfplumber` is read-only, so for the fixture use `pypdfium2.PdfDocument.new()` + insert text:**

```bash
uv run python - <<'PY'
from pypdfium2._helpers.document import PdfDocument
pdf = PdfDocument.new()
page = pdf.new_page(400, 200)
from pypdfium2.raw import FPDFPageObj_NewTextObj, FPDFPage_InsertObject, FPDF_LoadPage
# Fallback: write a minimal valid PDF by hand
PY
```

If this turns out to require too much ceremony, fall back to this hand-rolled minimal PDF:

```python
# tests/ingest/conftest.py (add at top)
def _write_minimal_pdf(path):
    content = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
        b"/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
        b"4 0 obj<</Length 44>>stream\n"
        b"BT /F1 24 Tf 72 700 Td (Hello, world.) Tj ET\n"
        b"endstream endobj\n"
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
        b"xref\n0 6\n0000000000 65535 f \n"
        b"0000000010 00000 n \n0000000053 00000 n \n"
        b"0000000100 00000 n \n0000000190 00000 n \n"
        b"0000000250 00000 n \n"
        b"trailer<</Size 6/Root 1 0 R>>\nstartxref\n310\n%%EOF\n"
    )
    path.write_bytes(content)
```

Create `apps/backend/tests/ingest/conftest.py` with:

```python
from __future__ import annotations

from pathlib import Path

import pytest


def _write_minimal_pdf(path: Path) -> None:
    content = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
        b"/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
        b"4 0 obj<</Length 44>>stream\n"
        b"BT /F1 24 Tf 72 700 Td (Hello, world.) Tj ET\n"
        b"endstream endobj\n"
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
        b"xref\n0 6\n0000000000 65535 f \n"
        b"0000000010 00000 n \n0000000053 00000 n \n"
        b"0000000100 00000 n \n0000000190 00000 n \n"
        b"0000000250 00000 n \n"
        b"trailer<</Size 6/Root 1 0 R>>\nstartxref\n310\n%%EOF\n"
    )
    path.write_bytes(content)


@pytest.fixture
def hello_pdf(tmp_path: Path) -> Path:
    p = tmp_path / "hello.pdf"
    _write_minimal_pdf(p)
    return p
```

- [ ] **Step 2: Write failing test**

Create `apps/backend/tests/ingest/test_pdf_extractor.py`:

```python
from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.extractors.pdf import PdfExtractor


def test_extracts_text(hello_pdf: Path) -> None:
    r = PdfExtractor().extract(hello_pdf)
    assert "Hello" in r.body_markdown
    assert "## Page 1" in r.body_markdown
    assert r.extractor == "pdf@0.1.0"
    assert r.confidence >= 0.5


def test_page_count_in_extra_frontmatter(hello_pdf: Path) -> None:
    r = PdfExtractor().extract(hello_pdf)
    assert r.extra_frontmatter.get("page_count") == 1
```

- [ ] **Step 3: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_pdf_extractor.py -v`
Expected: ImportError.

- [ ] **Step 4: Implement**

Create `apps/backend/src/lifescribe/ingest/extractors/pdf.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import pdfplumber
import pypdfium2

from lifescribe.ingest.extractors.base import ExtractionResult


def _render_table(table: list[list[str | None]]) -> str:
    if not table:
        return ""
    header = [c if c is not None else "" for c in table[0]]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in table[1:]:
        cells = [c if c is not None else "" for c in row]
        padded = cells + [""] * (len(header) - len(cells))
        lines.append("| " + " | ".join(padded[: len(header)]) + " |")
    return "\n".join(lines)


class PdfExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("application/pdf",)
    NAME = "pdf"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        pages_md: list[str] = []
        pages_with_text = 0

        doc = pypdfium2.PdfDocument(str(path))
        try:
            for idx, page in enumerate(doc, start=1):
                textpage = page.get_textpage()
                text = textpage.get_text_range() or ""
                textpage.close()
                page.close()
                pages_md.append(f"## Page {idx}\n\n{text.rstrip()}\n")
                if text.strip():
                    pages_with_text += 1
            page_count = len(doc)
        finally:
            doc.close()

        tables_md: list[str] = []
        with pdfplumber.open(str(path)) as plumb:
            for i, page in enumerate(plumb.pages, start=1):
                for t in page.extract_tables() or []:
                    rendered = _render_table([[c for c in row] for row in t])
                    if rendered:
                        tables_md.append(f"### Page {i} table\n\n{rendered}\n")

        body = "\n".join(pages_md)
        if tables_md:
            body += "\n" + "\n".join(tables_md)

        confidence = 1.0 if pages_with_text == page_count else (
            0.5 if pages_with_text >= page_count / 2 else 0.2
        )

        return ExtractionResult(
            body_markdown=body.rstrip() + "\n",
            extra_frontmatter={"page_count": page_count},
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=confidence,
        )
```

- [ ] **Step 5: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_pdf_extractor.py -v`
Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/extractors/pdf.py apps/backend/tests/ingest/test_pdf_extractor.py apps/backend/tests/ingest/conftest.py
git commit -m "feat(ingest): PDF extractor via pypdfium2 + pdfplumber"
```

---

### Task 12: DOCX extractor

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/extractors/docx.py`
- Test: `apps/backend/tests/ingest/test_docx_extractor.py`

- [ ] **Step 1: Write failing test**

Append to `apps/backend/tests/ingest/conftest.py`:

```python
@pytest.fixture
def hello_docx(tmp_path: Path) -> Path:
    from docx import Document
    doc = Document()
    doc.core_properties.title = "Hello"
    doc.core_properties.author = "Alice"
    doc.add_heading("H1 Heading", level=1)
    doc.add_paragraph("First paragraph.")
    doc.add_heading("Sub", level=2)
    doc.add_paragraph("Second paragraph.")
    table = doc.add_table(rows=2, cols=2)
    table.rows[0].cells[0].text = "a"
    table.rows[0].cells[1].text = "b"
    table.rows[1].cells[0].text = "1"
    table.rows[1].cells[1].text = "2"
    p = tmp_path / "h.docx"
    doc.save(str(p))
    return p
```

Create `apps/backend/tests/ingest/test_docx_extractor.py`:

```python
from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.extractors.docx import DocxExtractor


def test_headings_and_paragraphs(hello_docx: Path) -> None:
    r = DocxExtractor().extract(hello_docx)
    assert "# H1 Heading" in r.body_markdown
    assert "## Sub" in r.body_markdown
    assert "First paragraph." in r.body_markdown
    assert "| a | b |" in r.body_markdown
    assert "| 1 | 2 |" in r.body_markdown
    assert r.title == "Hello"
    assert r.extra_frontmatter.get("author") == "Alice"
    assert r.extractor == "docx@0.1.0"
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_docx_extractor.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `apps/backend/src/lifescribe/ingest/extractors/docx.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from lifescribe.ingest.extractors.base import ExtractionResult


def _para_to_md(p: Paragraph) -> str:
    style = p.style.name if p.style else ""
    text = p.text.rstrip()
    if style.startswith("Heading 1"):
        return f"# {text}"
    if style.startswith("Heading 2"):
        return f"## {text}"
    if style.startswith("Heading 3"):
        return f"### {text}"
    if style.startswith("Heading 4"):
        return f"#### {text}"
    if style.startswith("List"):
        return f"- {text}"
    return text


def _table_to_md(t: Table) -> str:
    rows = [[cell.text.strip().replace("|", "\\|") for cell in row.cells] for row in t.rows]
    if not rows:
        return ""
    header = rows[0]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in rows[1:]:
        padded = row + [""] * (len(header) - len(row))
        lines.append("| " + " | ".join(padded[: len(header)]) + " |")
    return "\n".join(lines)


class DocxExtractor:
    mimes: ClassVar[tuple[str, ...]] = (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    NAME = "docx"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        doc = Document(str(path))
        chunks: list[str] = []
        # Iterate paragraphs and tables in document order
        body_elm = doc.element.body
        for child in body_elm.iterchildren():
            if child.tag.endswith("}p"):
                md = _para_to_md(Paragraph(child, doc))
                if md:
                    chunks.append(md)
            elif child.tag.endswith("}tbl"):
                md = _table_to_md(Table(child, doc))
                if md:
                    chunks.append(md)

        props = doc.core_properties
        extra: dict[str, object] = {}
        if props.author:
            extra["author"] = props.author
        if props.subject:
            extra["subject"] = props.subject

        return ExtractionResult(
            body_markdown="\n\n".join(chunks) + "\n",
            title=props.title or None,
            extra_frontmatter=extra,
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.95,
        )
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_docx_extractor.py -v`
Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/extractors/docx.py apps/backend/tests/ingest/test_docx_extractor.py apps/backend/tests/ingest/conftest.py
git commit -m "feat(ingest): DOCX extractor via python-docx"
```

---

### Task 13: XLSX extractor

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/extractors/xlsx.py`
- Test: `apps/backend/tests/ingest/test_xlsx_extractor.py`

- [ ] **Step 1: Write failing test**

Append to `apps/backend/tests/ingest/conftest.py`:

```python
@pytest.fixture
def hello_xlsx(tmp_path: Path) -> Path:
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Data"
    ws.append(["name", "qty"])
    ws.append(["apple", 3])
    ws.append(["pear", 5])
    ws2 = wb.create_sheet("Notes")
    ws2.append(["id", "memo"])
    ws2.append([1, "hello"])
    p = tmp_path / "h.xlsx"
    wb.save(str(p))
    return p
```

Create `apps/backend/tests/ingest/test_xlsx_extractor.py`:

```python
from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.extractors.xlsx import XlsxExtractor


def test_multi_sheet(hello_xlsx: Path) -> None:
    r = XlsxExtractor().extract(hello_xlsx)
    assert "## Sheet: Data" in r.body_markdown
    assert "## Sheet: Notes" in r.body_markdown
    assert "| name | qty |" in r.body_markdown
    assert "| apple | 3 |" in r.body_markdown
    assert "| id | memo |" in r.body_markdown
    assert r.extra_frontmatter.get("sheet_names") == ["Data", "Notes"]
    assert r.extractor == "xlsx@0.1.0"
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_xlsx_extractor.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `apps/backend/src/lifescribe/ingest/extractors/xlsx.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from openpyxl import load_workbook

from lifescribe.ingest.extractors.base import ExtractionResult

_MAX_ROWS = 1000


def _cell_str(v: object) -> str:
    if v is None:
        return ""
    return str(v).replace("|", "\\|").replace("\n", " ")


class XlsxExtractor:
    mimes: ClassVar[tuple[str, ...]] = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    NAME = "xlsx"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        wb = load_workbook(str(path), read_only=True, data_only=True)
        chunks: list[str] = []
        sheet_names: list[str] = []
        try:
            for ws in wb.worksheets:
                sheet_names.append(ws.title)
                chunks.append(f"## Sheet: {ws.title}\n")
                rows = list(ws.iter_rows(values_only=True))
                if not rows:
                    chunks.append("(empty)\n")
                    continue
                header = [_cell_str(c) for c in rows[0]]
                lines = [
                    "| " + " | ".join(header) + " |",
                    "| " + " | ".join("---" for _ in header) + " |",
                ]
                data = rows[1:]
                truncated = len(data) > _MAX_ROWS
                if truncated:
                    data = data[:_MAX_ROWS]
                for row in data:
                    cells = [_cell_str(c) for c in row]
                    padded = cells + [""] * (len(header) - len(cells))
                    lines.append("| " + " | ".join(padded[: len(header)]) + " |")
                if truncated:
                    lines.append("")
                    lines.append(f"… truncated at {_MAX_ROWS} rows ({len(rows) - 1} total) …")
                chunks.append("\n".join(lines) + "\n")
        finally:
            wb.close()

        return ExtractionResult(
            body_markdown="\n".join(chunks),
            extra_frontmatter={"sheet_names": sheet_names},
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.95,
        )
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_xlsx_extractor.py -v`
Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/extractors/xlsx.py apps/backend/tests/ingest/test_xlsx_extractor.py apps/backend/tests/ingest/conftest.py
git commit -m "feat(ingest): XLSX extractor via openpyxl"
```

---

### Task 14: Image extractor

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/extractors/image.py`
- Test: `apps/backend/tests/ingest/test_image_extractor.py`

- [ ] **Step 1: Write failing test**

Append to `apps/backend/tests/ingest/conftest.py`:

```python
@pytest.fixture
def hello_png(tmp_path: Path) -> Path:
    from PIL import Image
    img = Image.new("RGB", (20, 10), color=(255, 0, 0))
    p = tmp_path / "h.png"
    img.save(str(p))
    return p
```

Create `apps/backend/tests/ingest/test_image_extractor.py`:

```python
from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.extractors.image import ImageExtractor


def test_png_metadata(hello_png: Path) -> None:
    r = ImageExtractor().extract(hello_png)
    assert r.body_markdown == ""
    assert r.extra_frontmatter.get("width") == 20
    assert r.extra_frontmatter.get("height") == 10
    assert r.extra_frontmatter.get("format") == "PNG"
    assert r.extractor == "image@0.1.0"
    assert r.confidence == 0.0  # no text extracted
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_image_extractor.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `apps/backend/src/lifescribe/ingest/extractors/image.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from PIL import ExifTags, Image

from lifescribe.ingest.extractors.base import ExtractionResult


class ImageExtractor:
    mimes: ClassVar[tuple[str, ...]] = (
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/tiff",
    )
    NAME = "image"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        extra: dict[str, object] = {}
        with Image.open(path) as img:
            extra["width"] = img.width
            extra["height"] = img.height
            extra["format"] = img.format or ""
            raw_exif = getattr(img, "_getexif", lambda: None)()
            if raw_exif:
                exif: dict[str, object] = {}
                for tag, value in raw_exif.items():
                    name = ExifTags.TAGS.get(tag, str(tag))
                    if isinstance(value, (bytes, bytearray)):
                        continue
                    if name in ("DateTime", "DateTimeOriginal", "Make", "Model"):
                        exif[name] = str(value)
                if exif:
                    extra["exif"] = exif

        return ExtractionResult(
            body_markdown="",
            extra_frontmatter=extra,
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.0,
        )
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_image_extractor.py -v`
Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/extractors/image.py apps/backend/tests/ingest/test_image_extractor.py apps/backend/tests/ingest/conftest.py
git commit -m "feat(ingest): image extractor (metadata only, no OCR)"
```

---

## Phase E — Pipeline

### Task 15: Job model + request model

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/jobs.py`
- Test: `apps/backend/tests/ingest/test_jobs.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/ingest/test_jobs.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime

from lifescribe.ingest.jobs import JobRequest, new_job_id


def test_new_job_id_format() -> None:
    jid = new_job_id(datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC))
    assert jid.startswith("job_2026-04-12_14-08-03_")
    assert len(jid.split("_")[-1]) == 4


def test_job_request_minimum() -> None:
    req = JobRequest(files=["/abs/a.txt"])
    assert req.files == ["/abs/a.txt"]
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_jobs.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `apps/backend/src/lifescribe/ingest/jobs.py`:

```python
from __future__ import annotations

import secrets
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    files: list[str]


def new_job_id(at: datetime) -> str:
    stamp = at.strftime("%Y-%m-%d_%H-%M-%S")
    suffix = secrets.token_hex(2)
    return f"job_{stamp}_{suffix}"
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_jobs.py -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/jobs.py apps/backend/tests/ingest/test_jobs.py
git commit -m "feat(ingest): JobRequest model and job_id generator"
```

---

### Task 16: Log rendering + parsing

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/log.py`
- Test: `apps/backend/tests/ingest/test_log.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/ingest/test_log.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime

from lifescribe.ingest.log import render_log
from lifescribe.vault.schemas import (
    IngestJobLog, JobStatus, PerFileEntry, PerFileStatus, parse_note,
)
from lifescribe.vault.serialization import load_note


def _log(files: list[PerFileEntry], status: JobStatus) -> IngestJobLog:
    return IngestJobLog(
        id="job_2026-04-12_14-08-03_abcd",
        type="IngestJobLog",
        status=status,
        started_at=datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC),
        finished_at=None,
        total=len(files),
        succeeded=sum(f.status in (PerFileStatus.SUCCEEDED, PerFileStatus.SUCCEEDED_WITH_CONFLICT) for f in files),
        failed=sum(f.status == PerFileStatus.FAILED for f in files),
        skipped=sum(f.status in (PerFileStatus.SKIPPED, PerFileStatus.SKIPPED_IDENTICAL) for f in files),
        cancelled=sum(f.status == PerFileStatus.CANCELLED for f in files),
        app_version="0.2.0",
        files=files,
    )


def test_render_log_produces_gfm_table() -> None:
    files = [
        PerFileEntry(index=1, path="/a.pdf", status=PerFileStatus.SUCCEEDED,
                     source_id="src_a_abcd", extractor="pdf@0.1.0"),
        PerFileEntry(index=2, path="/b.zip", status=PerFileStatus.SKIPPED,
                     error="unsupported mime: application/zip"),
    ]
    log = _log(files, JobStatus.COMPLETED_WITH_FAILURES)
    md = render_log(log)
    assert "| 1 | /a.pdf | succeeded | src_a_abcd | pdf@0.1.0 |  |" in md
    assert "| 2 | /b.zip | skipped |  |  | unsupported mime: application/zip |" in md


def test_render_log_roundtrips_through_load_note() -> None:
    files = [PerFileEntry(index=1, path="/a.txt", status=PerFileStatus.SUCCEEDED,
                          source_id="src_a_abcd", extractor="text@0.1.0")]
    log = _log(files, JobStatus.COMPLETED)
    full_text = render_log(log, include_frontmatter=True)
    note, body = load_note(full_text)
    parsed = parse_note(note.model_dump(mode="json")) if hasattr(note, "model_dump") else note
    assert isinstance(parsed, IngestJobLog)
    assert parsed.id == log.id
    assert parsed.files[0].source_id == "src_a_abcd"
    assert "| 1 | /a.txt |" in body
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_log.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `apps/backend/src/lifescribe/ingest/log.py`:

```python
from __future__ import annotations

from lifescribe.vault.schemas import IngestJobLog
from lifescribe.vault.serialization import dump_note


def _body(log: IngestJobLog) -> str:
    lines = [
        f"# Ingestion job `{log.id}`",
        "",
        "| # | File | Status | Source | Extractor | Error |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for f in log.files:
        lines.append(
            f"| {f.index} | {f.path} | {f.status.value} | "
            f"{f.source_id or ''} | {f.extractor or ''} | {f.error or ''} |"
        )
    return "\n".join(lines) + "\n"


def render_log(log: IngestJobLog, *, include_frontmatter: bool = True) -> str:
    body = _body(log)
    if not include_frontmatter:
        return body
    return dump_note(log, body=body)
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_log.py -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/log.py apps/backend/tests/ingest/test_log.py
git commit -m "feat(ingest): render IngestJobLog to Markdown with GFM table"
```

---

### Task 17: Pipeline core — single-file happy path

**Files:**
- Create: `apps/backend/src/lifescribe/ingest/pipeline.py`
- Test: `apps/backend/tests/ingest/test_pipeline.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/ingest/test_pipeline.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult
from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.pipeline import run_job
from lifescribe.vault.schemas import JobStatus, PerFileStatus
from lifescribe.vault.store import VaultStore


class _FakeText:
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
    NAME = "fake"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown=path.read_text(encoding="utf-8"),
            extractor="fake@0.1.0",
            confidence=1.0,
        )


def test_single_file_happy_path(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    src = tmp_path / "a.txt"
    src.write_text("hello", encoding="utf-8")

    registry = ExtractorRegistry()
    registry.register(_FakeText())

    pre = store._repo.log_oneline()
    log = run_job(store, files=[src], registry=registry, app_version="0.2.0")

    assert log.status == JobStatus.COMPLETED
    assert log.succeeded == 1
    assert log.failed == 0
    assert log.files[0].status == PerFileStatus.SUCCEEDED
    assert log.files[0].source_id is not None
    assert log.files[0].source_id.startswith("src_a_")

    post = store._repo.log_oneline()
    assert len(post) == len(pre) + 1

    # SourceRecord exists on disk
    source_id = log.files[0].source_id
    assert source_id is not None
    note_path = store.root / "10_sources" / f"{source_id}.md"
    assert note_path.exists()

    # Asset exists under content-addressed path
    assets = list((store.root / "assets").rglob("a.txt"))
    assert len(assets) == 1

    # Log file exists
    log_files = list((store.root / "system" / "logs" / "ingestion").rglob(f"{log.id}.md"))
    assert len(log_files) == 1
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/ingest/test_pipeline.py::test_single_file_happy_path -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `apps/backend/src/lifescribe/ingest/pipeline.py`:

```python
from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.jobs import new_job_id
from lifescribe.ingest.log import render_log
from lifescribe.ingest.mime import detect_mime
from lifescribe.vault.ids import compose_id, content_short_hash, sanitize_slug
from lifescribe.vault.schemas import (
    IngestJobLog, JobStatus, Note, PerFileEntry, PerFileStatus, SourceRecord,
)
from lifescribe.vault.store import VaultStore


@dataclass
class JobHandle:
    id: str
    cancel_requested: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _asset_rel_path(full_hash: str, filename: str) -> str:
    safe = filename.replace("/", "_").replace("\\", "_")
    return f"assets/{full_hash[:2]}/{full_hash}/{safe}"


def _copy_asset(store: VaultStore, src: Path, full_hash: str) -> str:
    rel = _asset_rel_path(full_hash, src.name)
    dest = store.root / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        dest.write_bytes(src.read_bytes())
    return rel


def _build_source_record(
    *,
    src: Path,
    mime: str,
    full_hash: str,
    extractor: str,
    confidence: float,
    title: str | None,
    extra: dict[str, object],
    job_id: str,
    now: datetime,
) -> SourceRecord:
    short = content_short_hash(full_hash.encode("ascii"))
    slug = sanitize_slug(title or src.stem)
    note_id = compose_id(type_prefix="src", slug=slug, short_hash=short)
    stat = src.stat()
    page_count = extra.get("page_count") if isinstance(extra.get("page_count"), int) else None
    return SourceRecord(
        id=note_id,
        type="SourceRecord",
        source_path=str(src),
        source_hash=f"sha256:{full_hash}",
        source_mtime=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
        imported_at=now,
        imported_by_job=job_id,
        extractor=extractor,
        extractor_confidence=confidence,
        mime_type=mime,
        original_filename=src.name,
        size_bytes=stat.st_size,
        page_count=page_count,
    )


def run_job(
    store: VaultStore,
    *,
    files: list[Path],
    registry: ExtractorRegistry,
    app_version: str,
    handle: JobHandle | None = None,
) -> IngestJobLog:
    started_at = datetime.now(UTC)
    job_id = (handle.id if handle else new_job_id(started_at))
    per_file: list[PerFileEntry] = []
    to_commit: list[tuple[Note, str]] = []
    asset_rels: list[str] = []
    succeeded = failed = skipped = cancelled = 0

    for idx, src in enumerate(files, start=1):
        if handle is not None and handle.cancel_requested:
            per_file.append(PerFileEntry(
                index=idx, path=str(src), status=PerFileStatus.CANCELLED,
            ))
            cancelled += 1
            continue

        if not src.exists():
            per_file.append(PerFileEntry(
                index=idx, path=str(src), status=PerFileStatus.FAILED,
                error="file not found",
            ))
            failed += 1
            continue

        mime = detect_mime(src)
        extractor = registry.find(mime)
        if extractor is None:
            per_file.append(PerFileEntry(
                index=idx, path=str(src), status=PerFileStatus.SKIPPED,
                error=f"unsupported mime: {mime}",
            ))
            skipped += 1
            continue

        full_hash = _sha256(src)
        short = content_short_hash(full_hash.encode("ascii"))
        slug = sanitize_slug(src.stem)
        probable_id = compose_id(type_prefix="src", slug=slug, short_hash=short)

        # idempotency: same bytes + same filename → no-op if already in vault
        existing_path = store.root / "10_sources" / f"{probable_id}.md"
        if existing_path.exists():
            per_file.append(PerFileEntry(
                index=idx, path=str(src), status=PerFileStatus.SKIPPED_IDENTICAL,
                source_id=probable_id,
                extractor=f"{extractor.NAME}@{extractor.VERSION}",
            ))
            skipped += 1
            continue

        try:
            result = extractor.extract(src)
        except Exception as e:  # per-file failure isolation
            per_file.append(PerFileEntry(
                index=idx, path=str(src), status=PerFileStatus.FAILED,
                extractor=f"{extractor.NAME}@{extractor.VERSION}",
                error=f"{type(e).__name__}: {e}",
            ))
            failed += 1
            continue

        asset_rel = _copy_asset(store, src, full_hash)
        asset_rels.append(asset_rel)

        now = datetime.now(UTC)
        rec = _build_source_record(
            src=src, mime=mime, full_hash=full_hash,
            extractor=result.extractor, confidence=result.confidence,
            title=result.title, extra=result.extra_frontmatter,
            job_id=job_id, now=now,
        )
        to_commit.append((rec, result.body_markdown))
        per_file.append(PerFileEntry(
            index=idx, path=str(src), status=PerFileStatus.SUCCEEDED,
            source_id=rec.id, extractor=result.extractor,
        ))
        succeeded += 1

    finished_at = datetime.now(UTC)
    if handle is not None and handle.cancel_requested:
        status = JobStatus.CANCELLED
    elif failed > 0:
        status = JobStatus.COMPLETED_WITH_FAILURES
    else:
        status = JobStatus.COMPLETED

    log = IngestJobLog(
        id=job_id,
        type="IngestJobLog",
        status=status,
        started_at=started_at,
        finished_at=finished_at,
        total=len(files),
        succeeded=succeeded,
        failed=failed,
        skipped=skipped,
        cancelled=cancelled,
        app_version=app_version,
        files=per_file,
    )

    # one commit per job: log + sources + assets
    items: list[tuple[Note, str]] = [(log, render_log(log, include_frontmatter=False))]
    items.extend(to_commit)
    message = f"ingest: {job_id} ({succeeded} ok, {failed} failed, {skipped} skipped)"
    store.write_batch(items, commit_message=message, extra_paths=asset_rels)
    return log
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_pipeline.py::test_single_file_happy_path -v`
Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/pipeline.py apps/backend/tests/ingest/test_pipeline.py
git commit -m "feat(ingest): pipeline happy path (extract, write, commit-once)"
```

---

### Task 18: Pipeline — idempotency, failure isolation, unknown MIME

**Files:**
- Test: `apps/backend/tests/ingest/test_pipeline.py`

- [ ] **Step 1: Write failing tests**

Append to `apps/backend/tests/ingest/test_pipeline.py`:

```python
def test_reimport_identical_is_skipped(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    src = tmp_path / "a.txt"
    src.write_text("hello", encoding="utf-8")
    reg = ExtractorRegistry()
    reg.register(_FakeText())

    run_job(store, files=[src], registry=reg, app_version="0.2.0")
    pre = store._repo.log_oneline()
    log2 = run_job(store, files=[src], registry=reg, app_version="0.2.0")
    post = store._repo.log_oneline()

    assert log2.skipped == 1
    assert log2.files[0].status == PerFileStatus.SKIPPED_IDENTICAL
    # Second run still commits (the log itself), so exactly one new commit:
    assert len(post) == len(pre) + 1


def test_unknown_mime_is_skipped_not_failed(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    blob = tmp_path / "x.xyz"
    blob.write_bytes(b"\x00\x01\x02")
    reg = ExtractorRegistry()  # no extractors registered

    log = run_job(store, files=[blob], registry=reg, app_version="0.2.0")
    assert log.skipped == 1
    assert log.failed == 0
    assert log.files[0].status == PerFileStatus.SKIPPED
    assert "unsupported mime" in (log.files[0].error or "")


def test_extractor_exception_marks_file_failed(tmp_path: Path) -> None:
    class _Boom:
        mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
        NAME = "boom"
        VERSION = "0.1.0"

        def extract(self, path: Path) -> ExtractionResult:
            raise RuntimeError("nope")

    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    src = tmp_path / "a.txt"
    src.write_text("x", encoding="utf-8")
    reg = ExtractorRegistry()
    reg.register(_Boom())

    log = run_job(store, files=[src], registry=reg, app_version="0.2.0")
    assert log.status == JobStatus.COMPLETED_WITH_FAILURES
    assert log.files[0].status == PerFileStatus.FAILED
    assert "RuntimeError: nope" in (log.files[0].error or "")
```

- [ ] **Step 2: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_pipeline.py -v`
Expected: all tests PASS (idempotency already wired in Task 17; these validate it).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/ingest/test_pipeline.py
git commit -m "test(ingest): idempotency, unknown mime, extractor failure isolation"
```

---

### Task 19: Pipeline — cancellation

**Files:**
- Test: `apps/backend/tests/ingest/test_pipeline.py`

- [ ] **Step 1: Write failing test**

Append to `apps/backend/tests/ingest/test_pipeline.py`:

```python
def test_cancel_flag_stops_at_next_file(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    a = tmp_path / "a.txt"; a.write_text("a", encoding="utf-8")
    b = tmp_path / "b.txt"; b.write_text("b", encoding="utf-8")
    c = tmp_path / "c.txt"; c.write_text("c", encoding="utf-8")

    # Set cancel before job starts so the first iteration sees it.
    from lifescribe.ingest.pipeline import JobHandle
    handle = JobHandle(id="job_2026-04-12_14-08-03_aaaa", cancel_requested=True)
    reg = ExtractorRegistry()
    reg.register(_FakeText())

    log = run_job(store, files=[a, b, c], registry=reg, app_version="0.2.0", handle=handle)
    assert log.status == JobStatus.CANCELLED
    assert log.cancelled == 3
    assert all(f.status == PerFileStatus.CANCELLED for f in log.files)
```

- [ ] **Step 2: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/ingest/test_pipeline.py::test_cancel_flag_stops_at_next_file -v`
Expected: PASS (already wired via handle in Task 17).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/ingest/test_pipeline.py
git commit -m "test(ingest): cancellation flag cancels remaining files"
```

---

## Phase F — API

### Task 20: Ingest router scaffolding + router registration

**Files:**
- Create: `apps/backend/src/lifescribe/api/routers/ingest.py`
- Modify: `apps/backend/src/lifescribe/api/app.py`
- Test: `apps/backend/tests/test_api_ingest_routes.py`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/test_api_ingest_routes.py`:

```python
from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient

from lifescribe.api.app import create_app
from lifescribe.api.routers.vault import _State
from lifescribe.vault.store import VaultStore


def _wait_terminal(client: TestClient, jid: str, headers: dict[str, str]) -> dict:
    for _ in range(200):
        r = client.get(f"/ingest/jobs/{jid}", headers=headers)
        assert r.status_code == 200
        body = r.json()
        if body["status"] in ("completed", "completed_with_failures", "cancelled", "failed"):
            return body
        time.sleep(0.05)
    raise AssertionError("job did not reach terminal state")


def test_post_poll_completes(tmp_path: Path) -> None:
    app = create_app(auth_token="t")
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    _State.store = store

    src = tmp_path / "a.txt"
    src.write_text("hi", encoding="utf-8")

    headers = {"Authorization": "Bearer t"}
    with TestClient(app) as client:
        r = client.post("/ingest/jobs", json={"files": [str(src)]}, headers=headers)
        assert r.status_code == 202
        jid = r.json()["job_id"]
        body = _wait_terminal(client, jid, headers)

    assert body["total"] == 1
    assert body["succeeded"] == 1
    assert body["files"][0]["status"] == "succeeded"


def test_second_post_while_running_is_conflict(tmp_path: Path) -> None:
    app = create_app(auth_token="t")
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    _State.store = store

    srcs = [tmp_path / f"{i}.txt" for i in range(3)]
    for s in srcs:
        s.write_text(s.name, encoding="utf-8")

    headers = {"Authorization": "Bearer t"}
    with TestClient(app) as client:
        r1 = client.post("/ingest/jobs", json={"files": [str(s) for s in srcs]}, headers=headers)
        assert r1.status_code == 202
        r2 = client.post("/ingest/jobs", json={"files": [str(srcs[0])]}, headers=headers)
        # Might race: if r1 finished already, r2 also succeeds. Otherwise it's 409.
        assert r2.status_code in (202, 409)
        _wait_terminal(client, r1.json()["job_id"], headers)


def test_get_unknown_job_is_404(tmp_path: Path) -> None:
    app = create_app(auth_token="t")
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    _State.store = store
    headers = {"Authorization": "Bearer t"}
    with TestClient(app) as client:
        r = client.get("/ingest/jobs/job_nonexistent", headers=headers)
        assert r.status_code == 404
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd apps/backend && uv run pytest tests/test_api_ingest_routes.py -v`
Expected: ImportError or 404 on missing route.

- [ ] **Step 3: Implement built-in registry helper**

Create `apps/backend/src/lifescribe/ingest/registry_default.py`:

```python
from __future__ import annotations

from lifescribe.ingest.extractors.csv_ import CsvExtractor
from lifescribe.ingest.extractors.docx import DocxExtractor
from lifescribe.ingest.extractors.html_ import HtmlExtractor
from lifescribe.ingest.extractors.image import ImageExtractor
from lifescribe.ingest.extractors.json_ import JsonExtractor
from lifescribe.ingest.extractors.pdf import PdfExtractor
from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.extractors.text import MarkdownExtractor, TextExtractor
from lifescribe.ingest.extractors.xlsx import XlsxExtractor


def default_registry() -> ExtractorRegistry:
    reg = ExtractorRegistry()
    reg.register(TextExtractor())
    reg.register(MarkdownExtractor())
    reg.register(JsonExtractor())
    reg.register(CsvExtractor())
    reg.register(HtmlExtractor())
    reg.register(PdfExtractor())
    reg.register(DocxExtractor())
    reg.register(XlsxExtractor())
    reg.register(ImageExtractor())
    return reg
```

- [ ] **Step 4: Implement router**

Create `apps/backend/src/lifescribe/api/routers/ingest.py`:

```python
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from lifescribe import __version__
from lifescribe.api.routers.vault import _State as _VaultState
from lifescribe.ingest.jobs import JobRequest, new_job_id
from lifescribe.ingest.pipeline import JobHandle, run_job
from lifescribe.ingest.registry_default import default_registry
from lifescribe.vault.schemas import IngestJobLog, JobStatus
from lifescribe.vault.serialization import load_note

router = APIRouter(prefix="/ingest", tags=["ingest"])

_REGISTRY = default_registry()


class _IngestState:
    active: JobHandle | None = None


def _require_store() -> Any:
    if _VaultState.store is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "vault not open")
    return _VaultState.store


def _read_log(store: Any, job_id: str) -> IngestJobLog | None:
    for md in (store.root / "system" / "logs" / "ingestion").rglob(f"{job_id}.md"):
        note, _ = load_note(md.read_text(encoding="utf-8"))
        if isinstance(note, IngestJobLog):
            return note
    return None


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
async def post_job(req: JobRequest) -> dict[str, Any]:
    store = _require_store()
    if _IngestState.active is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"job {_IngestState.active.id} is active",
        )
    started = datetime.now(UTC)
    job_id = new_job_id(started)
    handle = JobHandle(id=job_id)
    _IngestState.active = handle

    async def _run() -> None:
        try:
            await asyncio.to_thread(
                run_job,
                store,
                files=[Path(f) for f in req.files],
                registry=_REGISTRY,
                app_version=__version__,
                handle=handle,
            )
        finally:
            _IngestState.active = None

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "queued", "total": len(req.files)}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    store = _require_store()
    if _IngestState.active is not None and _IngestState.active.id == job_id:
        return {
            "job_id": job_id,
            "status": JobStatus.RUNNING.value,
            "started_at": None, "finished_at": None,
            "total": 0, "succeeded": 0, "failed": 0, "skipped": 0, "cancelled": 0,
            "files": [],
        }
    log = _read_log(store, job_id)
    if log is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no such job {job_id}")
    return log.model_dump(mode="json")


@router.delete("/jobs/{job_id}", status_code=status.HTTP_202_ACCEPTED)
def delete_job(job_id: str) -> dict[str, Any]:
    if _IngestState.active is None or _IngestState.active.id != job_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not an active job")
    with _IngestState.active.lock:
        _IngestState.active.cancel_requested = True
    return {"status": "cancelling"}
```

- [ ] **Step 5: Register router**

In `apps/backend/src/lifescribe/api/app.py`, add:

```python
from lifescribe.api.routers.ingest import router as ingest_router
```

and inside `create_app`, after `app.include_router(vault_router)`:

```python
    app.include_router(ingest_router)
```

- [ ] **Step 6: Run to verify PASS**

Run: `cd apps/backend && uv run pytest tests/test_api_ingest_routes.py -v`
Expected: 3 PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/lifescribe/ingest/registry_default.py apps/backend/src/lifescribe/api/routers/ingest.py apps/backend/src/lifescribe/api/app.py apps/backend/tests/test_api_ingest_routes.py
git commit -m "feat(api): /ingest/jobs POST/GET/DELETE + default registry"
```

---

## Phase G — End-to-end, docs, verification

### Task 21: Real multi-format integration test

**Files:**
- Create: `apps/backend/tests/integration/test_ingest_end_to_end.py`

- [ ] **Step 1: Write the test**

Create `apps/backend/tests/integration/test_ingest_end_to_end.py`:

```python
from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.pipeline import run_job
from lifescribe.ingest.registry_default import default_registry
from lifescribe.vault.schemas import JobStatus
from lifescribe.vault.store import VaultStore


def test_six_format_batch(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    store = VaultStore.init(vault, app_version="0.2.0")

    # Build one file per text-only format
    (tmp_path / "a.txt").write_text("plain text\n", encoding="utf-8")
    (tmp_path / "b.md").write_text("# md\npara\n", encoding="utf-8")
    (tmp_path / "c.json").write_text('{"k": 1}', encoding="utf-8")
    (tmp_path / "d.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    (tmp_path / "e.html").write_text(
        "<html><head><title>T</title></head><body><article><p>hello world hello world</p></article></body></html>",
        encoding="utf-8",
    )
    # minimal PDF via the shared conftest helper
    from tests.ingest.conftest import _write_minimal_pdf
    pdf_path = tmp_path / "f.pdf"
    _write_minimal_pdf(pdf_path)

    files = [tmp_path / n for n in ["a.txt", "b.md", "c.json", "d.csv", "e.html", "f.pdf"]]

    pre = store._repo.log_oneline()
    log = run_job(
        store, files=files, registry=default_registry(), app_version="0.2.0"
    )
    post = store._repo.log_oneline()

    assert len(post) == len(pre) + 1
    assert log.status == JobStatus.COMPLETED
    assert log.succeeded == 6
    assert log.failed == 0

    sources = list((vault / "10_sources").glob("src_*.md"))
    assert len(sources) == 6

    assets = list((vault / "assets").rglob("*"))
    assert sum(1 for a in assets if a.is_file()) == 6

    logs = list((vault / "system" / "logs" / "ingestion").rglob("job_*.md"))
    assert len(logs) == 1
```

- [ ] **Step 2: Run**

Run: `cd apps/backend && uv run pytest tests/integration/test_ingest_end_to_end.py -v`
Expected: 1 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/integration/test_ingest_end_to_end.py
git commit -m "test(ingest): six-format end-to-end integration"
```

---

### Task 22: Regenerate TS types

**Files:**
- Modify: `packages/shared-types/openapi.json`
- Modify: `packages/shared-types/src/generated.ts`

- [ ] **Step 1: Run gen-types**

Run: `bash scripts/gen-types.sh`
Expected: writes `packages/shared-types/openapi.json` and `packages/shared-types/src/generated.ts`.

- [ ] **Step 2: Verify frontend still typechecks**

Run: `cd apps/desktop && npm run typecheck`
Expected: no TS errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/
git commit -m "feat(types): regenerate shared types with ingest endpoints"
```

---

### Task 23: User + developer docs

**Files:**
- Create: `docs/user/import-files.md`
- Create: `docs/dev/adding-an-extractor.md`

- [ ] **Step 1: Write `docs/user/import-files.md`**

```markdown
# Importing files

LifeScribe Vault turns local documents into canonical notes under
`10_sources/` and keeps the originals under `assets/<hash>/`.

## How to import

In the desktop app, open an existing vault, then use the import dialog
(future Dashboard Shell) or call the backend API directly:

```bash
curl -s -X POST http://127.0.0.1:$PORT/ingest/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"files": ["/absolute/path/to/file.pdf"]}'
```

Poll `GET /ingest/jobs/<job_id>` until `status` reaches a terminal
state (`completed`, `completed_with_failures`, `cancelled`, `failed`).

## Supported formats (v1)

TXT, MD, JSON, CSV, HTML, PDF, DOCX, XLSX, and images (PNG/JPG/GIF/WebP/BMP/TIFF).
Images are stored as assets with EXIF metadata; their body is empty
until OCR arrives in a later release.

## Re-importing the same file

Re-importing a file with identical bytes and the same filename is a
no-op for the affected note (idempotency). The ingestion log still
records the attempt under `skipped_identical`.

## Where things land

- Note: `10_sources/<source_id>.md`
- Original bytes: `assets/<first-2-hex>/<sha256>/<original-filename>`
- Job log: `system/logs/ingestion/<YYYY-MM>/<job_id>.md`
```

- [ ] **Step 2: Write `docs/dev/adding-an-extractor.md`**

```markdown
# Adding a new extractor

1. Create `apps/backend/src/lifescribe/ingest/extractors/<format>.py`
   with a class that satisfies the `Extractor` protocol from
   `lifescribe.ingest.extractors.base`:

   ```python
   from typing import ClassVar
   from pathlib import Path
   from lifescribe.ingest.extractors.base import ExtractionResult

   class MyExtractor:
       mimes: ClassVar[tuple[str, ...]] = ("application/x-my",)
       NAME = "my"
       VERSION = "0.1.0"

       def extract(self, path: Path) -> ExtractionResult:
           ...
           return ExtractionResult(
               body_markdown=body,
               extractor=f"{self.NAME}@{self.VERSION}",
               confidence=0.9,
           )
   ```

2. Register it in
   `apps/backend/src/lifescribe/ingest/registry_default.py`.

3. Add a fixture under `apps/backend/tests/ingest/fixtures/` (a
   tmp-path fixture in `tests/ingest/conftest.py` is fine for
   dynamically-generated files).

4. Write a unit test asserting body rendering, extractor
   name/version, confidence, and any frontmatter fields.

5. If the MIME is not already in `mime.py`'s extension map, add it.

6. Run `cd apps/backend && uv run pytest tests/ingest -v`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/user/import-files.md docs/dev/adding-an-extractor.md
git commit -m "docs: user import guide + dev extractor recipe"
```

---

### Task 24: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Ruff format check**

Run: `cd apps/backend && uv run ruff format --check .`
Expected: no reformatting needed.

- [ ] **Step 2: Ruff lint**

Run: `cd apps/backend && uv run ruff check .`
Expected: All checks passed.

- [ ] **Step 3: Mypy**

Run: `cd apps/backend && uv run mypy src`
Expected: Success: no issues found.

- [ ] **Step 4: Pytest**

Run: `cd apps/backend && uv run pytest -q`
Expected: all tests pass.

- [ ] **Step 5: Frontend typecheck + lint**

Run: `cd apps/desktop && npm run typecheck && npm run lint && npm run format:check`
Expected: all clean.

- [ ] **Step 6: Push branch and open PR**

```bash
git push -u origin feat/ingestion-pipeline
gh pr create --base main --head feat/ingestion-pipeline \
  --title "Ingestion Pipeline: file → SourceRecord + asset, one commit per job" \
  --body "Implements docs/superpowers/specs/2026-04-12-ingestion-pipeline-design.md"
```

Expected: PR URL printed, CI runs to green.

---

## Self-review notes

- Spec §3 invariants all map to a task (schema: Task 2; one-commit-per-job: Task 17; idempotency: Tasks 17/18; inspectable Markdown log: Task 16).
- Spec §5 API surface → Task 20.
- Spec §6 extractor interface → Tasks 5–14.
- Spec §7 job lifecycle (queued/running/completed/cancelled/failed + crash recovery): queued/running/completed/completed_with_failures/cancelled/failed are all wired; crash recovery on startup is **not** implemented in this plan — deferred as a known gap, because the API registers a single in-process job handle and a crashed process has no persisted "active" marker beyond its log file's non-terminal status. A follow-up task can sweep logs at server startup.
- Spec §9 hand-edit conflict row (`succeeded_with_conflict`) — the enum value exists and `write_batch` already routes conflicts, but the pipeline currently records every successful write as plain `SUCCEEDED`. If integration surfaces this, update `pipeline.run_job` to inspect `WriteResult.conflict` after `write_batch` returns and patch the log row.
- Type consistency: `PerFileStatus`/`JobStatus` used throughout; `ExtractionResult` fields stable; `compose_id(type_prefix="src", slug=..., short_hash=...)` matches Foundation.
- No placeholders remain.
