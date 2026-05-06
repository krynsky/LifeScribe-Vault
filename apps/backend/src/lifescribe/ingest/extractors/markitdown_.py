from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult


class MarkItDownExtractor:
    NAME: ClassVar[str] = "markitdown"
    VERSION: ClassVar[str] = "0.1.0"

    def __init__(self, *, mimes: tuple[str, ...]) -> None:
        self.mimes = mimes

    def extract(self, path: Path) -> ExtractionResult:
        from markitdown import MarkItDown  # type: ignore[import-not-found]

        result = MarkItDown().convert(path)
        markdown = str(result.text_content).strip()
        if not markdown:
            raise ValueError("MarkItDown produced no Markdown")

        return ExtractionResult(
            body_markdown=markdown + "\n",
            extra_frontmatter={"markitdown_source": str(path)},
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.75,
        )
