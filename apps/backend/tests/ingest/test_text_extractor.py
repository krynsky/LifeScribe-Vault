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
