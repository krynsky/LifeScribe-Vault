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
