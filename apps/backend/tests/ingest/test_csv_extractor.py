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
    rows = ["a,b"] + [f"{i},{i + 1}" for i in range(1200)]
    p.write_text("\n".join(rows) + "\n", encoding="utf-8")
    r = CsvExtractor().extract(p)
    assert "… truncated at 1000 rows (1200 total) …" in r.body_markdown


def test_csv_escapes_pipes(tmp_path: Path) -> None:
    p = tmp_path / "a.csv"
    p.write_text("a,b\nhas|pipe,x\n", encoding="utf-8")
    r = CsvExtractor().extract(p)
    assert "has\\|pipe" in r.body_markdown
