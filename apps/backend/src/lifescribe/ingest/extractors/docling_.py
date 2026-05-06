from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult


class DoclingExtractor:
    NAME: ClassVar[str] = "docling"
    VERSION: ClassVar[str] = "0.1.0"

    def __init__(self, *, mimes: tuple[str, ...]) -> None:
        self.mimes = mimes

    def extract(self, path: Path) -> ExtractionResult:
        from docling.document_converter import DocumentConverter

        result = DocumentConverter().convert(path)
        markdown = result.document.export_to_markdown().strip()
        if not markdown:
            raise ValueError("Docling produced no Markdown")

        return ExtractionResult(
            body_markdown=markdown + "\n",
            extra_frontmatter={"docling_source": str(path)},
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.85,
        )
