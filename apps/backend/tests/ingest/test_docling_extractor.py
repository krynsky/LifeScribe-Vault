from __future__ import annotations

from pathlib import Path
from types import ModuleType
from typing import Any, ClassVar, cast

import pytest

from lifescribe.ingest.extractors.docling_ import DoclingExtractor
from tests.ingest.conftest import _write_minimal_pdf


class _FakeDocument:
    def __init__(self, markdown: str) -> None:
        self._markdown = markdown

    def export_to_markdown(self) -> str:
        return self._markdown


class _FakeResult:
    def __init__(self, markdown: str) -> None:
        self.document = _FakeDocument(markdown)


class _FakeDocumentConverter:
    markdown: ClassVar[str] = "# Converted by Docling\n\nBody text"
    sources: ClassVar[list[Path]] = []

    def convert(self, source: Path) -> _FakeResult:
        self.sources.append(source)
        return _FakeResult(self.markdown)


def _install_fake_docling(monkeypatch: pytest.MonkeyPatch, markdown: str) -> None:
    docling_module = ModuleType("docling")
    converter_module = cast(Any, ModuleType("docling.document_converter"))
    _FakeDocumentConverter.markdown = markdown
    _FakeDocumentConverter.sources = []
    converter_module.DocumentConverter = _FakeDocumentConverter

    monkeypatch.setitem(__import__("sys").modules, "docling", docling_module)
    monkeypatch.setitem(
        __import__("sys").modules,
        "docling.document_converter",
        converter_module,
    )


def test_docling_extractor_converts_markdown(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    src = tmp_path / "input.pdf"
    _write_minimal_pdf(src)
    _install_fake_docling(monkeypatch, "# Converted by Docling\n\nBody text")

    result = DoclingExtractor(mimes=("application/pdf",)).extract(src)

    assert _FakeDocumentConverter.sources == [src]
    assert result.body_markdown == "# Converted by Docling\n\nBody text\n"
    assert result.extractor == "docling@0.1.0"
    assert result.confidence == 0.85
    assert result.extra_frontmatter["docling_source"] == str(src)


def test_docling_extractor_preserves_pdf_page_count(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    src = tmp_path / "input.pdf"
    _write_minimal_pdf(src)
    _install_fake_docling(monkeypatch, "# Converted by Docling\n\nBody text")

    result = DoclingExtractor(mimes=("application/pdf",)).extract(src)

    assert result.extra_frontmatter["page_count"] == 1


def test_docling_extractor_rejects_empty_markdown(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    src = tmp_path / "input.pdf"
    src.write_bytes(b"%PDF-1.7")
    _install_fake_docling(monkeypatch, " \n\t")

    with pytest.raises(ValueError, match="Docling produced no Markdown"):
        DoclingExtractor(mimes=("application/pdf",)).extract(src)
