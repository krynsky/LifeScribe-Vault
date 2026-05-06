# Ingestion Engine Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Docling-first ingestion engine router while preserving the current extractors as fallbacks and reserving MarkItDown as an optional secondary engine for future format coverage.

**Architecture:** Keep the existing `FileDropConnector -> ExtractorRegistry -> VaultImporter` flow. Add focused extractor wrappers for Docling and MarkItDown plus a `RoutedExtractor` that tries engines in order, records attempts, and returns the first successful `ExtractionResult`. Wire the default registry so current imports keep working, with Docling primary for rich document formats and native extractors as fallbacks.

**Tech Stack:** Python 3.12, FastAPI backend, existing `ExtractionResult` protocol, Docling `DocumentConverter`, optional MarkItDown lazy import, pytest, existing Git-backed vault tests.

---

## Scope

This plan implements only the first v2 slice from `docs/superpowers/specs/2026-05-06-lifescribe-v2-architecture-design.md`: Docling-first ingestion routing.

In scope:

- Add Docling as the primary engine for PDF, DOCX, XLSX, PPTX, HTML, and common image inputs.
- Add a lazy MarkItDown extractor wrapper, but do not make it mandatory for the packaged app until package impact is measured.
- Keep native extractors as stable fallbacks for current supported formats.
- Record selected engine, attempted engines, and warnings in source metadata/frontmatter.
- Add tests proving fallback behavior and no regression for current ingestion.

Out of scope:

- Manual export connectors.
- Life wiki compiler.
- Canonical entity/event extraction.
- Review queue.
- Vector search.
- Publishing.

## File Structure

Create:

- `apps/backend/src/lifescribe/ingest/extractors/router.py`
  - Owns `RoutedExtractor` and `ExtractionChainError`.
  - It is compatible with the existing `Extractor` protocol, so `FileDropConnector` does not need a new interface.

- `apps/backend/src/lifescribe/ingest/extractors/docling_.py`
  - Lazy Docling wrapper using `from docling.document_converter import DocumentConverter`.
  - Converts local files with `DocumentConverter().convert(path).document.export_to_markdown()`.
  - Uses lazy import so tests can monkeypatch and packaging failures produce clear import errors.

- `apps/backend/src/lifescribe/ingest/extractors/markitdown_.py`
  - Lazy MarkItDown wrapper using `from markitdown import MarkItDown`.
  - Not required for v2 startup; safe to omit from default registry if dependency is unavailable.

- `apps/backend/tests/ingest/test_router_extractor.py`
  - Unit tests for fallback order, attempt metadata, and failure aggregation.

- `apps/backend/tests/ingest/test_docling_extractor.py`
  - Unit tests using monkeypatched fake Docling modules/classes.

- `apps/backend/tests/ingest/test_markitdown_extractor.py`
  - Unit tests using monkeypatched fake MarkItDown modules/classes.

Modify:

- `apps/backend/pyproject.toml`
  - Add `docling` as a runtime dependency if a local install/build check succeeds.
  - Add `markitdown` under an optional extra named `conversion` if package impact should stay isolated.

- `apps/backend/src/lifescribe/ingest/mime.py`
  - Add PowerPoint and EPUB MIME mappings for formats routed to MarkItDown or Docling.

- `apps/backend/src/lifescribe/ingest/registry_default.py`
  - Build Docling-first routed extractors for rich document formats.
  - Keep native-only extractors for simple formats where current output is deterministic and cheap.

- `connectors/file_drop/connector.py`
  - Copy richer `ExtractionResult.extra_frontmatter` metadata into `ImportedDoc.source_meta`.

- `apps/backend/src/lifescribe/vault/schemas.py`
  - Add optional source metadata fields for engine routing.

- `apps/backend/src/lifescribe/vault/importer.py`
  - Persist engine metadata onto `SourceRecord`.

- `connectors/file_drop/manifest.toml`
  - Add newly supported extensions that the router can handle.

- Existing tests under `apps/backend/tests/ingest/`, `apps/backend/tests/connectors/`, and `apps/backend/tests/integration/`.

## Task 1: Add Routed Extractor

**Files:**

- Create: `apps/backend/src/lifescribe/ingest/extractors/router.py`
- Test: `apps/backend/tests/ingest/test_router_extractor.py`

- [ ] **Step 1: Write failing router tests**

Create `apps/backend/tests/ingest/test_router_extractor.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import pytest

from lifescribe.ingest.extractors.base import ExtractionResult
from lifescribe.ingest.extractors.router import ExtractionChainError, RoutedExtractor


class _GoodExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("application/pdf",)
    NAME = "good"
    VERSION = "1.0.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown="good output",
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.9,
        )


class _FallbackExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("application/pdf",)
    NAME = "fallback"
    VERSION = "1.0.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown="fallback output",
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.8,
        )


class _BoomExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("application/pdf",)
    NAME = "boom"
    VERSION = "1.0.0"

    def extract(self, path: Path) -> ExtractionResult:
        raise RuntimeError("conversion failed")


def test_routed_extractor_uses_first_success(tmp_path: Path) -> None:
    src = tmp_path / "doc.pdf"
    src.write_bytes(b"%PDF-1.4")

    router = RoutedExtractor(
        mimes=("application/pdf",),
        extractors=[_GoodExtractor(), _FallbackExtractor()],
    )

    result = router.extract(src)

    assert result.body_markdown == "good output"
    assert result.extractor == "good@1.0.0"
    assert result.extra_frontmatter["engine_router"] == "routed@0.1.0"
    assert result.extra_frontmatter["engine_selected"] == "good@1.0.0"
    assert result.extra_frontmatter["engine_attempts"] == ["good@1.0.0"]
    assert result.extra_frontmatter["engine_warnings"] == []


def test_routed_extractor_falls_back_after_failure(tmp_path: Path) -> None:
    src = tmp_path / "doc.pdf"
    src.write_bytes(b"%PDF-1.4")

    router = RoutedExtractor(
        mimes=("application/pdf",),
        extractors=[_BoomExtractor(), _FallbackExtractor()],
    )

    result = router.extract(src)

    assert result.body_markdown == "fallback output"
    assert result.extractor == "fallback@1.0.0"
    assert result.extra_frontmatter["engine_selected"] == "fallback@1.0.0"
    assert result.extra_frontmatter["engine_attempts"] == [
        "boom@1.0.0",
        "fallback@1.0.0",
    ]
    assert result.extra_frontmatter["engine_warnings"] == [
        "boom@1.0.0 failed: RuntimeError: conversion failed"
    ]


def test_routed_extractor_raises_aggregate_error_when_all_fail(tmp_path: Path) -> None:
    src = tmp_path / "doc.pdf"
    src.write_bytes(b"%PDF-1.4")

    router = RoutedExtractor(
        mimes=("application/pdf",),
        extractors=[_BoomExtractor()],
    )

    with pytest.raises(ExtractionChainError) as excinfo:
        router.extract(src)

    assert "all extraction engines failed" in str(excinfo.value)
    assert "boom@1.0.0 failed: RuntimeError: conversion failed" in str(excinfo.value)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest/test_router_extractor.py -q
```

Expected: fails with `ModuleNotFoundError: No module named 'lifescribe.ingest.extractors.router'`.

- [ ] **Step 3: Add router implementation**

Create `apps/backend/src/lifescribe/ingest/extractors/router.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult, Extractor


class ExtractionChainError(RuntimeError):
    """Raised when every extractor in a routed chain fails."""


class RoutedExtractor:
    """Try multiple extractors in order while preserving the existing Extractor protocol."""

    NAME: ClassVar[str] = "routed"
    VERSION: ClassVar[str] = "0.1.0"

    def __init__(self, *, mimes: tuple[str, ...], extractors: list[Extractor]) -> None:
        if not mimes:
            raise ValueError("RoutedExtractor requires at least one MIME type")
        if not extractors:
            raise ValueError("RoutedExtractor requires at least one child extractor")
        self.mimes = mimes
        self._extractors = extractors

    def extract(self, path: Path) -> ExtractionResult:
        attempts: list[str] = []
        warnings: list[str] = []

        for extractor in self._extractors:
            engine_id = f"{extractor.NAME}@{extractor.VERSION}"
            attempts.append(engine_id)
            try:
                result = extractor.extract(path)
            except Exception as exc:
                warnings.append(f"{engine_id} failed: {type(exc).__name__}: {exc}")
                continue

            metadata = dict(result.extra_frontmatter)
            metadata["engine_router"] = f"{self.NAME}@{self.VERSION}"
            metadata["engine_selected"] = result.extractor
            metadata["engine_attempts"] = attempts
            metadata["engine_warnings"] = warnings

            return result.model_copy(update={"extra_frontmatter": metadata})

        raise ExtractionChainError(
            "all extraction engines failed: " + "; ".join(warnings)
        )
```

- [ ] **Step 4: Run router tests**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest/test_router_extractor.py -q
```

Expected: `3 passed`.

- [ ] **Step 5: Commit**

```powershell
git add apps/backend/src/lifescribe/ingest/extractors/router.py apps/backend/tests/ingest/test_router_extractor.py
git commit -m "feat: add routed ingestion extractor"
```

## Task 2: Add Docling Extractor Wrapper

**Files:**

- Create: `apps/backend/src/lifescribe/ingest/extractors/docling_.py`
- Test: `apps/backend/tests/ingest/test_docling_extractor.py`

- [ ] **Step 1: Write failing Docling wrapper tests**

Create `apps/backend/tests/ingest/test_docling_extractor.py`:

```python
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

from lifescribe.ingest.extractors.docling_ import DoclingExtractor


class _FakeDocument:
    def export_to_markdown(self) -> str:
        return "# Converted by Docling\n\nBody text"


class _FakeResult:
    document = _FakeDocument()


class _FakeConverter:
    last_source: Path | None = None

    def convert(self, source: Path) -> _FakeResult:
        self.__class__.last_source = source
        return _FakeResult()


def _install_fake_docling(monkeypatch: pytest.MonkeyPatch) -> None:
    docling_module = types.ModuleType("docling")
    converter_module = types.ModuleType("docling.document_converter")
    converter_module.DocumentConverter = _FakeConverter
    monkeypatch.setitem(sys.modules, "docling", docling_module)
    monkeypatch.setitem(sys.modules, "docling.document_converter", converter_module)


def test_docling_extractor_exports_markdown(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _install_fake_docling(monkeypatch)
    src = tmp_path / "input.pdf"
    src.write_bytes(b"%PDF-1.4")

    result = DoclingExtractor(mimes=("application/pdf",)).extract(src)

    assert _FakeConverter.last_source == src
    assert result.body_markdown == "# Converted by Docling\n\nBody text\n"
    assert result.extractor == "docling@0.1.0"
    assert result.confidence == 0.85
    assert result.extra_frontmatter["docling_source"] == str(src)


def test_docling_extractor_rejects_empty_output(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class _EmptyDocument:
        def export_to_markdown(self) -> str:
            return "   "

    class _EmptyResult:
        document = _EmptyDocument()

    class _EmptyConverter:
        def convert(self, source: Path) -> _EmptyResult:
            return _EmptyResult()

    docling_module = types.ModuleType("docling")
    converter_module = types.ModuleType("docling.document_converter")
    converter_module.DocumentConverter = _EmptyConverter
    monkeypatch.setitem(sys.modules, "docling", docling_module)
    monkeypatch.setitem(sys.modules, "docling.document_converter", converter_module)

    src = tmp_path / "blank.pdf"
    src.write_bytes(b"%PDF-1.4")

    with pytest.raises(ValueError, match="Docling produced no Markdown"):
        DoclingExtractor(mimes=("application/pdf",)).extract(src)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest/test_docling_extractor.py -q
```

Expected: fails with `ModuleNotFoundError: No module named 'lifescribe.ingest.extractors.docling_'`.

- [ ] **Step 3: Add Docling wrapper**

Create `apps/backend/src/lifescribe/ingest/extractors/docling_.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult


class DoclingExtractor:
    """Docling-backed extractor.

    Imports Docling lazily so test doubles can replace the module and so startup
    stays useful when optional conversion dependencies are not installed.
    """

    NAME: ClassVar[str] = "docling"
    VERSION: ClassVar[str] = "0.1.0"

    def __init__(self, *, mimes: tuple[str, ...]) -> None:
        self.mimes = mimes

    def extract(self, path: Path) -> ExtractionResult:
        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()
        result = converter.convert(path)
        markdown = result.document.export_to_markdown().strip()
        if not markdown:
            raise ValueError("Docling produced no Markdown")

        return ExtractionResult(
            body_markdown=markdown + "\n",
            extra_frontmatter={"docling_source": str(path)},
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.85,
        )
```

- [ ] **Step 4: Run Docling wrapper tests**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest/test_docling_extractor.py -q
```

Expected: `2 passed`.

- [ ] **Step 5: Commit**

```powershell
git add apps/backend/src/lifescribe/ingest/extractors/docling_.py apps/backend/tests/ingest/test_docling_extractor.py
git commit -m "feat: add Docling ingestion extractor"
```

## Task 3: Add MarkItDown Extractor Wrapper

**Files:**

- Create: `apps/backend/src/lifescribe/ingest/extractors/markitdown_.py`
- Test: `apps/backend/tests/ingest/test_markitdown_extractor.py`

- [ ] **Step 1: Write failing MarkItDown wrapper tests**

Create `apps/backend/tests/ingest/test_markitdown_extractor.py`:

```python
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

from lifescribe.ingest.extractors.markitdown_ import MarkItDownExtractor


class _FakeConversion:
    text_content = "# Converted by MarkItDown\n\nBody text"


class _FakeMarkItDown:
    last_source: Path | None = None

    def convert(self, source: Path) -> _FakeConversion:
        self.__class__.last_source = source
        return _FakeConversion()


def test_markitdown_extractor_exports_markdown(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    module = types.ModuleType("markitdown")
    module.MarkItDown = _FakeMarkItDown
    monkeypatch.setitem(sys.modules, "markitdown", module)

    src = tmp_path / "deck.pptx"
    src.write_bytes(b"pptx")

    result = MarkItDownExtractor(
        mimes=("application/vnd.openxmlformats-officedocument.presentationml.presentation",)
    ).extract(src)

    assert _FakeMarkItDown.last_source == src
    assert result.body_markdown == "# Converted by MarkItDown\n\nBody text\n"
    assert result.extractor == "markitdown@0.1.0"
    assert result.confidence == 0.75
    assert result.extra_frontmatter["markitdown_source"] == str(src)


def test_markitdown_extractor_rejects_empty_output(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class _EmptyConversion:
        text_content = ""

    class _EmptyMarkItDown:
        def convert(self, source: Path) -> _EmptyConversion:
            return _EmptyConversion()

    module = types.ModuleType("markitdown")
    module.MarkItDown = _EmptyMarkItDown
    monkeypatch.setitem(sys.modules, "markitdown", module)

    src = tmp_path / "empty.pptx"
    src.write_bytes(b"pptx")

    with pytest.raises(ValueError, match="MarkItDown produced no Markdown"):
        MarkItDownExtractor(
            mimes=("application/vnd.openxmlformats-officedocument.presentationml.presentation",)
        ).extract(src)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest/test_markitdown_extractor.py -q
```

Expected: fails with `ModuleNotFoundError: No module named 'lifescribe.ingest.extractors.markitdown_'`.

- [ ] **Step 3: Add MarkItDown wrapper**

Create `apps/backend/src/lifescribe/ingest/extractors/markitdown_.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult


class MarkItDownExtractor:
    """MarkItDown-backed fallback extractor for broad Markdown conversion."""

    NAME: ClassVar[str] = "markitdown"
    VERSION: ClassVar[str] = "0.1.0"

    def __init__(self, *, mimes: tuple[str, ...]) -> None:
        self.mimes = mimes

    def extract(self, path: Path) -> ExtractionResult:
        from markitdown import MarkItDown

        converter = MarkItDown()
        result = converter.convert(path)
        markdown = str(result.text_content).strip()
        if not markdown:
            raise ValueError("MarkItDown produced no Markdown")

        return ExtractionResult(
            body_markdown=markdown + "\n",
            extra_frontmatter={"markitdown_source": str(path)},
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.75,
        )
```

- [ ] **Step 4: Run MarkItDown wrapper tests**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest/test_markitdown_extractor.py -q
```

Expected: `2 passed`.

- [ ] **Step 5: Commit**

```powershell
git add apps/backend/src/lifescribe/ingest/extractors/markitdown_.py apps/backend/tests/ingest/test_markitdown_extractor.py
git commit -m "feat: add MarkItDown fallback extractor"
```

## Task 4: Persist Engine Metadata

**Files:**

- Modify: `connectors/file_drop/connector.py`
- Modify: `apps/backend/src/lifescribe/vault/schemas.py`
- Modify: `apps/backend/src/lifescribe/vault/importer.py`
- Test: `apps/backend/tests/connectors/test_file_drop.py`
- Test: `apps/backend/tests/vault/test_importer.py`

- [ ] **Step 1: Add connector metadata test**

Append this test to `apps/backend/tests/connectors/test_file_drop.py`:

```python
class _MetadataExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
    NAME = "metadata"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown="metadata body",
            extractor="metadata@0.1.0",
            confidence=0.7,
            extra_frontmatter={
                "engine_router": "routed@0.1.0",
                "engine_selected": "metadata@0.1.0",
                "engine_attempts": ["metadata@0.1.0"],
                "engine_warnings": [],
            },
        )


def test_collect_preserves_engine_metadata(tmp_path: Path) -> None:
    src = tmp_path / "meta.txt"
    src.write_text("metadata", encoding="utf-8")
    registry = ExtractorRegistry()
    registry.register(_MetadataExtractor())  # type: ignore[arg-type]

    c = FileDropConnector(registry=registry)
    c.configure(_config(tmp_path))
    try:
        docs = list(c.collect(ImportRequest(inputs=[src])))
    finally:
        c.teardown()

    assert docs
    assert docs[0].source_meta["engine_router"] == "routed@0.1.0"
    assert docs[0].source_meta["engine_selected"] == "metadata@0.1.0"
    assert docs[0].source_meta["engine_attempts"] == ["metadata@0.1.0"]
    assert docs[0].source_meta["engine_warnings"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd apps/backend
uv run pytest tests/connectors/test_file_drop.py::test_collect_preserves_engine_metadata -q
```

Expected: fails with `KeyError: 'engine_router'`.

- [ ] **Step 3: Copy extractor metadata into `source_meta`**

In `connectors/file_drop/connector.py`, replace the `source_meta={...}` dict inside the yielded `ImportedDoc` with:

```python
source_meta={
    "mime_type": mime,
    "original_filename": src.name,
    "size_bytes": stat.st_size,
    "source_path": str(src),
    "source_mtime": stat.st_mtime,
    "extractor": result.extractor,
    "extractor_confidence": result.confidence,
    "page_count": result.extra_frontmatter.get("page_count"),
    **result.extra_frontmatter,
},
```

- [ ] **Step 4: Run connector metadata test**

Run:

```powershell
cd apps/backend
uv run pytest tests/connectors/test_file_drop.py::test_collect_preserves_engine_metadata -q
```

Expected: `1 passed`.

- [ ] **Step 5: Add schema/importer persistence test**

Append this test to `apps/backend/tests/vault/test_importer.py`:

```python
def test_importer_persists_engine_metadata(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "vault", app_version="0.2.0")
    src = tmp_path / "source.txt"
    src.write_text("body", encoding="utf-8")
    doc = ImportedDoc(
        title="source",
        body_markdown="body\n",
        tags=[],
        source_meta={
            "source_path": str(src),
            "source_mtime": src.stat().st_mtime,
            "extractor": "docling@0.1.0",
            "extractor_confidence": 0.85,
            "mime_type": "text/plain",
            "original_filename": "source.txt",
            "size_bytes": src.stat().st_size,
            "engine_router": "routed@0.1.0",
            "engine_selected": "docling@0.1.0",
            "engine_attempts": ["docling@0.1.0"],
            "engine_warnings": [],
        },
        assets=[src],
        content_hash="a" * 64,
    )

    result = VaultImporter(store=store).ingest("file_drop", iter([doc]), job_id="job_test")

    assert result.imported_count == 1
    note_id = result.items[0].note_id
    assert note_id is not None
    note = store.read_note(note_id)
    assert isinstance(note, SourceRecord)
    assert note.engine_router == "routed@0.1.0"
    assert note.engine_selected == "docling@0.1.0"
    assert note.engine_attempts == ["docling@0.1.0"]
    assert note.engine_warnings == []
```

If `apps/backend/tests/vault/test_importer.py` does not already import these names, add:

```python
from lifescribe.connectors.base import ImportedDoc
from lifescribe.vault.importer import VaultImporter
from lifescribe.vault.schemas import SourceRecord
from lifescribe.vault.store import VaultStore
```

- [ ] **Step 6: Run persistence test to verify it fails**

Run:

```powershell
cd apps/backend
uv run pytest tests/vault/test_importer.py::test_importer_persists_engine_metadata -q
```

Expected: fails because `SourceRecord` has no `engine_router` field.

- [ ] **Step 7: Add optional engine fields to `SourceRecord`**

In `apps/backend/src/lifescribe/vault/schemas.py`, add these fields to `SourceRecord` after `page_count`:

```python
    engine_router: str | None = None
    engine_selected: str | None = None
    engine_attempts: list[str] = Field(default_factory=list)
    engine_warnings: list[str] = Field(default_factory=list)
```

- [ ] **Step 8: Persist engine fields in importer**

In `apps/backend/src/lifescribe/vault/importer.py`, add helper functions near `_coerce_int`:

```python
def _coerce_str_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, tuple):
        return [str(item) for item in value]
    return []
```

Then add these keyword arguments to the `SourceRecord(...)` call:

```python
                    engine_router=(
                        str(doc.source_meta.get("engine_router"))
                        if doc.source_meta.get("engine_router") is not None
                        else None
                    ),
                    engine_selected=(
                        str(doc.source_meta.get("engine_selected"))
                        if doc.source_meta.get("engine_selected") is not None
                        else None
                    ),
                    engine_attempts=_coerce_str_list(doc.source_meta.get("engine_attempts")),
                    engine_warnings=_coerce_str_list(doc.source_meta.get("engine_warnings")),
```

- [ ] **Step 9: Run metadata tests**

Run:

```powershell
cd apps/backend
uv run pytest tests/connectors/test_file_drop.py::test_collect_preserves_engine_metadata tests/vault/test_importer.py::test_importer_persists_engine_metadata -q
```

Expected: `2 passed`.

- [ ] **Step 10: Commit**

```powershell
git add connectors/file_drop/connector.py apps/backend/src/lifescribe/vault/schemas.py apps/backend/src/lifescribe/vault/importer.py apps/backend/tests/connectors/test_file_drop.py apps/backend/tests/vault/test_importer.py
git commit -m "feat: persist ingestion engine metadata"
```

## Task 5: Wire Docling-First Default Registry

**Files:**

- Modify: `apps/backend/src/lifescribe/ingest/registry_default.py`
- Modify: `apps/backend/src/lifescribe/ingest/mime.py`
- Modify: `connectors/file_drop/manifest.toml`
- Test: `apps/backend/tests/ingest/test_registry.py`
- Test: `apps/backend/tests/integration/test_ingest_end_to_end.py`

- [ ] **Step 1: Add registry routing test**

Append this test to `apps/backend/tests/ingest/test_registry.py`:

```python
def test_default_registry_routes_pdf_through_docling_first() -> None:
    from lifescribe.ingest.extractors.router import RoutedExtractor
    from lifescribe.ingest.registry_default import default_registry

    reg = default_registry()
    extractor = reg.find("application/pdf")

    assert isinstance(extractor, RoutedExtractor)
    child_ids = [f"{child.NAME}@{child.VERSION}" for child in extractor.extractors_for_tests()]
    assert child_ids[0].startswith("docling@")
    assert any(child_id.startswith("pdf@") for child_id in child_ids)
```

- [ ] **Step 2: Add test-only child accessor**

The test in Step 1 will need a small accessor. In `apps/backend/src/lifescribe/ingest/extractors/router.py`, add this method to `RoutedExtractor`:

```python
    def extractors_for_tests(self) -> tuple[Extractor, ...]:
        return tuple(self._extractors)
```

- [ ] **Step 3: Run registry test to verify it fails**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest/test_registry.py::test_default_registry_routes_pdf_through_docling_first -q
```

Expected: fails because `default_registry()` still returns `PdfExtractor` directly.

- [ ] **Step 4: Add MIME mappings for new routed formats**

In `apps/backend/src/lifescribe/ingest/mime.py`, add these entries to `_EXT_MAP`:

```python
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".epub": "application/epub+zip",
```

- [ ] **Step 5: Wire routed extractors**

Replace `apps/backend/src/lifescribe/ingest/registry_default.py` with:

```python
from __future__ import annotations

from lifescribe.ingest.extractors.csv_ import CsvExtractor
from lifescribe.ingest.extractors.docling_ import DoclingExtractor
from lifescribe.ingest.extractors.docx import DocxExtractor
from lifescribe.ingest.extractors.html_ import HtmlExtractor
from lifescribe.ingest.extractors.image import ImageExtractor
from lifescribe.ingest.extractors.json_ import JsonExtractor
from lifescribe.ingest.extractors.markitdown_ import MarkItDownExtractor
from lifescribe.ingest.extractors.pdf import PdfExtractor
from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.extractors.router import RoutedExtractor
from lifescribe.ingest.extractors.text import MarkdownExtractor, TextExtractor
from lifescribe.ingest.extractors.xlsx import XlsxExtractor

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
EPUB_MIME = "application/epub+zip"
HTML_MIME = "text/html"
PNG_MIME = "image/png"
JPEG_MIME = "image/jpeg"
GIF_MIME = "image/gif"
WEBP_MIME = "image/webp"
BMP_MIME = "image/bmp"
TIFF_MIME = "image/tiff"


def default_registry() -> ExtractorRegistry:
    reg = ExtractorRegistry()

    # Keep simple text/data formats on native extractors for deterministic output.
    reg.register(TextExtractor())
    reg.register(MarkdownExtractor())
    reg.register(JsonExtractor())
    reg.register(CsvExtractor())

    # Rich document formats use Docling first, then MarkItDown where useful,
    # then the current native extractor if one exists.
    reg.register(
        RoutedExtractor(
            mimes=(PDF_MIME,),
            extractors=[
                DoclingExtractor(mimes=(PDF_MIME,)),
                MarkItDownExtractor(mimes=(PDF_MIME,)),
                PdfExtractor(),
            ],
        )
    )
    reg.register(
        RoutedExtractor(
            mimes=(DOCX_MIME,),
            extractors=[
                DoclingExtractor(mimes=(DOCX_MIME,)),
                MarkItDownExtractor(mimes=(DOCX_MIME,)),
                DocxExtractor(),
            ],
        )
    )
    reg.register(
        RoutedExtractor(
            mimes=(XLSX_MIME,),
            extractors=[
                DoclingExtractor(mimes=(XLSX_MIME,)),
                MarkItDownExtractor(mimes=(XLSX_MIME,)),
                XlsxExtractor(),
            ],
        )
    )
    reg.register(
        RoutedExtractor(
            mimes=(HTML_MIME,),
            extractors=[
                DoclingExtractor(mimes=(HTML_MIME,)),
                MarkItDownExtractor(mimes=(HTML_MIME,)),
                HtmlExtractor(),
            ],
        )
    )
    reg.register(
        RoutedExtractor(
            mimes=(PPTX_MIME, EPUB_MIME),
            extractors=[
                DoclingExtractor(mimes=(PPTX_MIME, EPUB_MIME)),
                MarkItDownExtractor(mimes=(PPTX_MIME, EPUB_MIME)),
            ],
        )
    )
    reg.register(
        RoutedExtractor(
            mimes=(PNG_MIME, JPEG_MIME, GIF_MIME, WEBP_MIME, BMP_MIME, TIFF_MIME),
            extractors=[
                DoclingExtractor(
                    mimes=(PNG_MIME, JPEG_MIME, GIF_MIME, WEBP_MIME, BMP_MIME, TIFF_MIME)
                ),
                MarkItDownExtractor(
                    mimes=(PNG_MIME, JPEG_MIME, GIF_MIME, WEBP_MIME, BMP_MIME, TIFF_MIME)
                ),
                ImageExtractor(),
            ],
        )
    )

    return reg
```

- [ ] **Step 6: Update connector manifest formats**

In `connectors/file_drop/manifest.toml`, replace:

```toml
supported_formats = ["pdf", "txt", "md", "png", "jpg", "jpeg"]
```

with:

```toml
supported_formats = ["pdf", "docx", "xlsx", "pptx", "html", "epub", "txt", "md", "json", "csv", "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"]
```

- [ ] **Step 7: Run registry routing tests**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest/test_registry.py -q
```

Expected: all registry tests pass.

- [ ] **Step 8: Run existing ingest end-to-end test**

Run:

```powershell
cd apps/backend
uv run pytest tests/integration/test_ingest_end_to_end.py::test_six_format_batch -q
```

Expected: passes. If it fails because Docling or MarkItDown is not installed, complete Task 6 before retesting.

- [ ] **Step 9: Commit**

```powershell
git add apps/backend/src/lifescribe/ingest/registry_default.py apps/backend/src/lifescribe/ingest/mime.py connectors/file_drop/manifest.toml apps/backend/tests/ingest/test_registry.py
git commit -m "feat: route imports through Docling-first registry"
```

## Task 6: Add Dependencies And Package Guardrails

**Files:**

- Modify: `apps/backend/pyproject.toml`
- Modify: `scripts/build-backend.ps1`
- Modify: `scripts/build-backend.sh`
- Test: `apps/backend/tests/ingest/test_docling_extractor.py`
- Test: `apps/backend/tests/ingest/test_markitdown_extractor.py`

- [ ] **Step 1: Add dependencies**

In `apps/backend/pyproject.toml`, add Docling to runtime dependencies:

```toml
  "docling>=2.0",
```

Add a conversion extra below `[project.optional-dependencies]`:

```toml
conversion = [
  "markitdown>=0.1",
]
```

Keep MarkItDown optional until package size and PyInstaller behavior are measured.

- [ ] **Step 2: Sync backend environment**

Run:

```powershell
cd apps/backend
uv sync --extra dev
```

Expected: dependencies install successfully and `uv.lock` changes.

- [ ] **Step 3: Verify Docling import and API from official docs**

Run:

```powershell
cd apps/backend
uv run python -c "from docling.document_converter import DocumentConverter; print(DocumentConverter)"
```

Expected: prints a `DocumentConverter` class. This matches Docling's official `DocumentConverter().convert(source).document.export_to_markdown()` API.

- [ ] **Step 4: Run extractor tests**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest/test_docling_extractor.py tests/ingest/test_markitdown_extractor.py -q
```

Expected: `4 passed`.

- [ ] **Step 5: Check PyInstaller hidden import risk**

Run:

```powershell
powershell -File scripts/build-backend.ps1
```

Expected: backend sidecar build succeeds. If PyInstaller fails on Docling dynamic imports, add specific `--hidden-import` entries to `scripts/build-backend.ps1` and `scripts/build-backend.sh` based on the actual error text, then rerun the build.

- [ ] **Step 6: Commit**

```powershell
git add apps/backend/pyproject.toml apps/backend/uv.lock scripts/build-backend.ps1 scripts/build-backend.sh
git commit -m "build: include Docling ingestion dependency"
```

## Task 7: Verify Fallback Behavior In The Real Pipeline

**Files:**

- Test: `apps/backend/tests/ingest/test_pipeline.py`
- Test: `apps/backend/tests/integration/test_ingest_end_to_end.py`

- [ ] **Step 1: Add pipeline fallback test**

Append this test to `apps/backend/tests/ingest/test_pipeline.py`:

```python
def test_pipeline_records_routed_fallback_metadata(tmp_path: Path) -> None:
    class _PrimaryBoom:
        mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
        NAME = "primary"
        VERSION = "0.1.0"

        def extract(self, path: Path) -> ExtractionResult:
            raise RuntimeError("primary failed")

    class _FallbackOk:
        mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
        NAME = "fallback"
        VERSION = "0.1.0"

        def extract(self, path: Path) -> ExtractionResult:
            return ExtractionResult(
                body_markdown="fallback body\n",
                extractor="fallback@0.1.0",
                confidence=0.8,
            )

    from lifescribe.ingest.extractors.router import RoutedExtractor

    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    src = tmp_path / "a.txt"
    src.write_text("hello", encoding="utf-8")
    reg = ExtractorRegistry()
    reg.register(
        RoutedExtractor(
            mimes=("text/plain",),
            extractors=[_PrimaryBoom(), _FallbackOk()],  # type: ignore[list-item]
        )
    )

    log = run_job(store, files=[src], registry=reg, app_version="0.2.0")

    assert log.status == JobStatus.COMPLETED
    assert log.files[0].extractor == "fallback@0.1.0"
    source_id = log.files[0].source_id
    assert source_id is not None
    note = store.read_note(source_id)
    assert isinstance(note, SourceRecord)
    assert note.engine_selected == "fallback@0.1.0"
    assert note.engine_attempts == ["primary@0.1.0", "fallback@0.1.0"]
    assert note.engine_warnings == [
        "primary@0.1.0 failed: RuntimeError: primary failed"
    ]
```

If `apps/backend/tests/ingest/test_pipeline.py` does not already import `SourceRecord`, add:

```python
from lifescribe.vault.schemas import JobStatus, PerFileStatus, SourceRecord
```

and remove the previous `JobStatus, PerFileStatus` import line so the imports are not duplicated.

- [ ] **Step 2: Run fallback pipeline test**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest/test_pipeline.py::test_pipeline_records_routed_fallback_metadata -q
```

Expected: `1 passed`.

- [ ] **Step 3: Run ingestion test group**

Run:

```powershell
cd apps/backend
uv run pytest tests/ingest tests/connectors/test_file_drop.py tests/vault/test_importer.py tests/integration/test_ingest_end_to_end.py -q
```

Expected: all selected tests pass.

- [ ] **Step 4: Commit**

```powershell
git add apps/backend/tests/ingest/test_pipeline.py
git commit -m "test: cover routed ingestion fallback metadata"
```

## Task 8: Final Verification And Docs

**Files:**

- Modify: `README.md`
- Modify: `docs/user/import-files.md`
- Modify: `docs/dev/adding-an-extractor.md`

- [ ] **Step 1: Update README feature wording**

In `README.md`, update the ingestion bullet to:

```markdown
- **Ingest** local documents (PDF, DOCX, XLS/XLSX, PPTX, TXT, MD, HTML, JSON, CSV, images, ZIP exports, and EPUB where supported) using a Docling-first conversion router with native fallback extractors, then write canonical Markdown notes with full provenance.
```

- [ ] **Step 2: Update user import docs**

In `docs/user/import-files.md`, add a short section named `Conversion Engines`:

```markdown
## Conversion Engines

LifeScribe uses a Docling-first conversion router for rich document formats such as PDF, DOCX, XLSX, PPTX, HTML, and images. If Docling cannot convert a file, LifeScribe falls back to the next configured engine for that format, including the current native extractors for formats that already worked in v1.

Each imported source note records the selected engine, attempted engines, and conversion warnings in its frontmatter so import behavior is inspectable later.
```

- [ ] **Step 3: Update developer extractor docs**

In `docs/dev/adding-an-extractor.md`, add:

```markdown
## Routed Extractors

Rich document formats are registered through `RoutedExtractor` in `lifescribe.ingest.registry_default`. A routed extractor is still compatible with the existing `Extractor` protocol: it exposes `mimes`, `NAME`, `VERSION`, and `extract(path)`.

When adding a new conversion engine, prefer wrapping it as a normal extractor and adding it to a route rather than changing `FileDropConnector`. This keeps connector collection, dedupe, vault writes, and ingestion logs unchanged.
```

- [ ] **Step 4: Run lint and backend tests**

Run:

```powershell
cd apps/backend
uv run ruff format --check .
uv run ruff check .
uv run mypy src/
uv run pytest -q
```

Expected: all commands pass.

- [ ] **Step 5: Run frontend smoke tests if API schema did not change**

Run:

```powershell
cd apps/desktop
npm run typecheck
npx vitest run
```

Expected: all commands pass. If `SourceRecord` type changes require regenerated frontend types, run `powershell -File scripts/gen-types.ps1`, commit the generated type changes, and rerun these commands.

- [ ] **Step 6: Build backend sidecar**

Run:

```powershell
powershell -File scripts/build-backend.ps1
```

Expected: sidecar build succeeds and the script copies the connector catalog beside the sidecar.

- [ ] **Step 7: Commit docs and generated types**

```powershell
git add README.md docs/user/import-files.md docs/dev/adding-an-extractor.md packages/shared-types apps/desktop/src
git commit -m "docs: document Docling ingestion routing"
```

Only stage generated type files if `scripts/gen-types.ps1` changed them.

## Self-Review Notes

- Spec coverage: this plan covers the first v2 slice only: Docling primary routing, MarkItDown fallback wrapper, current native fallbacks, metadata persistence, tests, packaging checks, and docs. Later v2 slices remain separate plans.
- Placeholder scan: no steps rely on unspecified validation or unnamed tests. Each test command includes expected output.
- Type consistency: all extractors continue to return `ExtractionResult`; `RoutedExtractor` implements the existing `Extractor` protocol; `FileDropConnector` continues to consume `ExtractorRegistry.find(mime)`.
- Risk: Docling package size and PyInstaller behavior are the main unknowns. Task 6 makes that risk explicit before broad implementation continues.

