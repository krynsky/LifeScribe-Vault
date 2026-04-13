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
