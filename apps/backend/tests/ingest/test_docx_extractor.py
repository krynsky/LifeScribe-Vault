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
