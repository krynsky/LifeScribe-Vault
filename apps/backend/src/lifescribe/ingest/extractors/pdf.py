from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import pdfplumber
import pypdfium2

from lifescribe.ingest.extractors.base import ExtractionResult


def _render_table(table: list[list[str | None]]) -> str:
    if not table:
        return ""
    header = [c if c is not None else "" for c in table[0]]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in table[1:]:
        cells = [c if c is not None else "" for c in row]
        padded = cells + [""] * (len(header) - len(cells))
        lines.append("| " + " | ".join(padded[: len(header)]) + " |")
    return "\n".join(lines)


class PdfExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("application/pdf",)
    NAME: ClassVar[str] = "pdf"
    VERSION: ClassVar[str] = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        pages_md: list[str] = []
        pages_with_text = 0

        doc = pypdfium2.PdfDocument(str(path))
        try:
            for idx, page in enumerate(doc, start=1):
                textpage = page.get_textpage()
                text = textpage.get_text_range() or ""
                textpage.close()
                page.close()
                pages_md.append(f"## Page {idx}\n\n{text.rstrip()}\n")
                if text.strip():
                    pages_with_text += 1
            page_count = len(doc)
        finally:
            doc.close()

        tables_md: list[str] = []
        with pdfplumber.open(str(path)) as plumb:
            for i, page in enumerate(plumb.pages, start=1):
                for t in page.extract_tables() or []:
                    rendered = _render_table([[c for c in row] for row in t])
                    if rendered:
                        tables_md.append(f"### Page {i} table\n\n{rendered}\n")

        body = "\n".join(pages_md)
        if tables_md:
            body += "\n" + "\n".join(tables_md)

        confidence = (
            1.0
            if pages_with_text == page_count
            else (0.5 if pages_with_text >= page_count / 2 else 0.2)
        )

        return ExtractionResult(
            body_markdown=body.rstrip() + "\n",
            extra_frontmatter={"page_count": page_count},
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=confidence,
        )
