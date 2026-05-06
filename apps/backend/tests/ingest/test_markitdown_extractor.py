from __future__ import annotations

from pathlib import Path
from types import ModuleType
from typing import Any, ClassVar, cast

import pytest

from lifescribe.ingest.extractors.markitdown_ import MarkItDownExtractor


class _FakeResult:
    def __init__(self, text_content: str) -> None:
        self.text_content = text_content


class _FakeMarkItDown:
    text_content: ClassVar[str] = "# Converted by MarkItDown\n\nBody text"
    sources: ClassVar[list[Path]] = []

    def convert(self, source: Path) -> _FakeResult:
        self.sources.append(source)
        return _FakeResult(self.text_content)


def _install_fake_markitdown(
    monkeypatch: pytest.MonkeyPatch,
    text_content: str,
) -> None:
    markitdown_module = cast(Any, ModuleType("markitdown"))
    _FakeMarkItDown.text_content = text_content
    _FakeMarkItDown.sources = []
    markitdown_module.MarkItDown = _FakeMarkItDown

    monkeypatch.setitem(__import__("sys").modules, "markitdown", markitdown_module)


def test_markitdown_extractor_converts_markdown(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    src = tmp_path / "slides.pptx"
    src.write_bytes(b"pptx")
    _install_fake_markitdown(monkeypatch, "# Converted by MarkItDown\n\nBody text")

    result = MarkItDownExtractor(
        mimes=("application/vnd.openxmlformats-officedocument.presentationml.presentation",),
    ).extract(src)

    assert _FakeMarkItDown.sources == [src]
    assert result.body_markdown == "# Converted by MarkItDown\n\nBody text\n"
    assert result.extractor == "markitdown@0.1.0"
    assert result.confidence == 0.75
    assert result.extra_frontmatter["markitdown_source"] == str(src)


def test_markitdown_extractor_rejects_empty_markdown(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    src = tmp_path / "slides.pptx"
    src.write_bytes(b"pptx")
    _install_fake_markitdown(monkeypatch, "")

    with pytest.raises(ValueError, match="MarkItDown produced no Markdown"):
        MarkItDownExtractor(
            mimes=("application/vnd.openxmlformats-officedocument.presentationml.presentation",),
        ).extract(src)
