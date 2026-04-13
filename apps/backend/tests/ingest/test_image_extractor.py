from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.extractors.image import ImageExtractor


def test_png_metadata(hello_png: Path) -> None:
    r = ImageExtractor().extract(hello_png)
    assert r.body_markdown == ""
    assert r.extra_frontmatter.get("width") == 20
    assert r.extra_frontmatter.get("height") == 10
    assert r.extra_frontmatter.get("format") == "PNG"
    assert r.extractor == "image@0.1.0"
    assert r.confidence == 0.0  # no text extracted
