from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from connectors.file_drop.connector import FileDropConnector  # type: ignore[import-not-found]

from lifescribe.connectors.base import (
    ConnectorConfig,
    ImportedDoc,
    ImportRequest,
)
from lifescribe.ingest.extractors.base import ExtractionResult
from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.registry_default import default_registry  # CORRECTED


def _config(tmp_path: Path) -> ConnectorConfig:
    return ConnectorConfig(vault_path=tmp_path / "vault", privacy_mode=False)


def test_collect_yields_imported_doc_for_text(tmp_path: Path) -> None:
    src = tmp_path / "hello.txt"
    src.write_text("hello there")
    c = FileDropConnector(registry=default_registry())
    c.configure(_config(tmp_path))
    try:
        docs = list(c.collect(ImportRequest(inputs=[src])))
    finally:
        c.teardown()
    assert len(docs) == 1
    assert isinstance(docs[0], ImportedDoc)
    assert docs[0].source_meta["mime_type"] == "text/plain"
    assert docs[0].assets == [src]
    assert len(docs[0].content_hash) == 64


def test_collect_skips_missing_file(tmp_path: Path) -> None:
    ghost = tmp_path / "ghost.txt"
    c = FileDropConnector(registry=default_registry())
    c.configure(_config(tmp_path))
    try:
        docs = list(c.collect(ImportRequest(inputs=[ghost])))
    finally:
        c.teardown()
    assert docs == []
    items = c.last_item_entries
    assert len(items) == 1
    assert items[0].status == "failed"
    assert "not found" in (items[0].error or "").lower()


def test_collect_skips_unsupported_mime(tmp_path: Path) -> None:
    src = tmp_path / "weird.xyz"
    src.write_bytes(b"\x00\x01\x02")
    c = FileDropConnector(registry=default_registry())
    c.configure(_config(tmp_path))
    try:
        docs = list(c.collect(ImportRequest(inputs=[src])))
    finally:
        c.teardown()
    assert docs == []
    items = c.last_item_entries
    assert len(items) == 1
    assert items[0].status == "skipped_unsupported"


def test_collect_yields_extractor_metadata(tmp_path: Path) -> None:
    src = tmp_path / "note.md"
    src.write_text("# hi")
    c = FileDropConnector(registry=default_registry())
    c.configure(_config(tmp_path))
    try:
        docs = list(c.collect(ImportRequest(inputs=[src])))
    finally:
        c.teardown()
    assert docs
    assert docs[0].source_meta["extractor"].startswith("markdown@")


class _BoomExtractor:
    """Stub extractor that raises an exception on extract()."""

    NAME: ClassVar[str] = "boom"
    VERSION: ClassVar[str] = "0.0.1"
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)

    def extract(self, path: Path) -> ExtractionResult:
        raise RuntimeError("boom")


class _EngineMetadataExtractor:
    NAME: ClassVar[str] = "engine-meta"
    VERSION: ClassVar[str] = "1.0.0"
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown=path.read_text(),
            title="engine metadata",
            extra_frontmatter={
                "engine_router": "router@1",
                "engine_selected": "docling",
                "engine_attempts": ["docling", "markitdown"],
                "engine_warnings": ["fallback used"],
            },
            extractor="engine-meta@1.0.0",
            confidence=0.9,
        )


class _CollidingEngineMetadataExtractor:
    NAME: ClassVar[str] = "collision-meta"
    VERSION: ClassVar[str] = "1.0.0"
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown=path.read_text(),
            title="collision metadata",
            extra_frontmatter={
                "engine_router": "router@1",
                "engine_selected": "docling",
                "engine_attempts": ["docling", "markitdown"],
                "engine_warnings": ["fallback used"],
                "mime_type": "fake/type",
                "source_path": "wrong",
                "size_bytes": "not an int",
                "extractor": "wrong@0",
                "extractor_confidence": "bad",
                "page_count": "bad",
            },
            extractor="collision-meta@1.0.0",
            confidence=0.8,
        )


class _PageCountExtractor:
    NAME: ClassVar[str] = "page-count"
    VERSION: ClassVar[str] = "1.0.0"
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown=path.read_text(),
            title="page count metadata",
            extra_frontmatter={"page_count": 3},
            extractor="page-count@1.0.0",
            confidence=0.95,
        )


def test_collect_preserves_engine_metadata(tmp_path: Path) -> None:
    src = tmp_path / "engine.txt"
    src.write_text("engine metadata")

    registry = ExtractorRegistry()
    registry.register(_EngineMetadataExtractor())

    c = FileDropConnector(registry=registry)
    c.configure(_config(tmp_path))
    try:
        docs = list(c.collect(ImportRequest(inputs=[src])))
    finally:
        c.teardown()

    assert len(docs) == 1
    assert docs[0].source_meta["engine_router"] == "router@1"
    assert docs[0].source_meta["engine_selected"] == "docling"
    assert docs[0].source_meta["engine_attempts"] == ["docling", "markitdown"]
    assert docs[0].source_meta["engine_warnings"] == ["fallback used"]


def test_collect_preserves_page_count_metadata(tmp_path: Path) -> None:
    src = tmp_path / "page-count.txt"
    src.write_text("page count metadata")

    registry = ExtractorRegistry()
    registry.register(_PageCountExtractor())

    c = FileDropConnector(registry=registry)
    c.configure(_config(tmp_path))
    try:
        docs = list(c.collect(ImportRequest(inputs=[src])))
    finally:
        c.teardown()

    assert len(docs) == 1
    assert docs[0].source_meta["page_count"] == 3


def test_collect_ignores_extra_frontmatter_collisions(tmp_path: Path) -> None:
    src = tmp_path / "collision.txt"
    src.write_text("collision metadata")

    registry = ExtractorRegistry()
    registry.register(_CollidingEngineMetadataExtractor())

    c = FileDropConnector(registry=registry)
    c.configure(_config(tmp_path))
    try:
        docs = list(c.collect(ImportRequest(inputs=[src])))
    finally:
        c.teardown()

    assert len(docs) == 1
    source_meta = docs[0].source_meta
    assert source_meta["mime_type"] == "text/plain"
    assert source_meta["source_path"] == str(src)
    assert source_meta["size_bytes"] == src.stat().st_size
    assert source_meta["extractor"] == "collision-meta@1.0.0"
    assert source_meta["extractor_confidence"] == 0.8
    assert "page_count" not in source_meta
    assert source_meta["engine_router"] == "router@1"
    assert source_meta["engine_selected"] == "docling"
    assert source_meta["engine_attempts"] == ["docling", "markitdown"]
    assert source_meta["engine_warnings"] == ["fallback used"]


def test_collect_handles_extractor_exception(tmp_path: Path) -> None:
    """Test that extractor exceptions are caught and logged as failed items."""
    src = tmp_path / "boom.txt"
    src.write_text("will cause extractor to fail")

    # Build a minimal registry with only the boom extractor
    registry = ExtractorRegistry()
    registry.register(_BoomExtractor())

    c = FileDropConnector(registry=registry)
    c.configure(_config(tmp_path))
    try:
        docs = list(c.collect(ImportRequest(inputs=[src])))
    finally:
        c.teardown()

    # Verify no docs were yielded
    assert docs == []

    # Verify item entry records the failure
    items = c.last_item_entries
    assert len(items) == 1
    assert items[0].status == "failed"
    assert "RuntimeError" in items[0].error
    assert "boom" in items[0].error
    assert items[0].meta.get("extractor") == "boom@0.0.1"
