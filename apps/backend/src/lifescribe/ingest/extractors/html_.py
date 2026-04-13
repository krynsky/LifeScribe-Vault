from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import trafilatura
from lxml import html as lhtml

from lifescribe.ingest.extractors.base import ExtractionResult


def _extract_html_title(raw: str) -> str | None:
    """Extract <title> text from HTML using lxml."""
    try:
        tree = lhtml.fromstring(raw)
        titles = tree.xpath("//title/text()")
        return titles[0].strip() if titles else None
    except Exception:
        return None


class HtmlExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/html",)
    NAME = "html"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        raw = path.read_text(encoding="utf-8", errors="replace")
        body = trafilatura.extract(
            raw,
            output_format="markdown",
            include_tables=True,
            include_links=True,
            include_images=False,
            favor_recall=True,
        )
        if not body:
            body = trafilatura.extract(
                raw, output_format="markdown", favor_recall=True, no_fallback=False
            ) or ""

        # trafilatura 2.0.0 extract_metadata() may return the h1 as title
        # instead of the <title> tag — extract it directly via lxml.
        title: str | None = _extract_html_title(raw)
        if not title:
            meta = trafilatura.extract_metadata(raw)
            if meta is not None and meta.title:
                title = meta.title

        if not body.strip():
            body = "\n".join(
                line.strip() for line in raw.splitlines() if line.strip()
            )

        return ExtractionResult(
            body_markdown=body.rstrip() + "\n",
            title=title,
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.8 if body.strip() else 0.3,
        )
