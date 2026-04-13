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
