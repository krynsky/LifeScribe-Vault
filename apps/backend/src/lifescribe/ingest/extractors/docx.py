from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from lifescribe.ingest.extractors.base import ExtractionResult


def _para_to_md(p: Paragraph) -> str:
    style = p.style.name if p.style else ""
    text = p.text.rstrip()
    if style.startswith("Heading 1"):
        return f"# {text}"
    if style.startswith("Heading 2"):
        return f"## {text}"
    if style.startswith("Heading 3"):
        return f"### {text}"
    if style.startswith("Heading 4"):
        return f"#### {text}"
    if style.startswith("List"):
        return f"- {text}"
    return text


def _table_to_md(t: Table) -> str:
    rows = [[cell.text.strip().replace("|", "\\|") for cell in row.cells] for row in t.rows]
    if not rows:
        return ""
    header = rows[0]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in rows[1:]:
        padded = row + [""] * (len(header) - len(row))
        lines.append("| " + " | ".join(padded[: len(header)]) + " |")
    return "\n".join(lines)


class DocxExtractor:
    mimes: ClassVar[tuple[str, ...]] = (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    NAME: ClassVar[str] = "docx"
    VERSION: ClassVar[str] = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        doc = Document(str(path))
        chunks: list[str] = []
        # Iterate paragraphs and tables in document order
        body_elm = doc.element.body
        for child in body_elm.iterchildren():
            if child.tag.endswith("}p"):
                md = _para_to_md(Paragraph(child, doc))
                if md:
                    chunks.append(md)
            elif child.tag.endswith("}tbl"):
                md = _table_to_md(Table(child, doc))
                if md:
                    chunks.append(md)

        props = doc.core_properties
        extra: dict[str, object] = {}
        if props.author:
            extra["author"] = props.author
        if props.subject:
            extra["subject"] = props.subject

        return ExtractionResult(
            body_markdown="\n\n".join(chunks) + "\n",
            title=props.title or None,
            extra_frontmatter=extra,
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.95,
        )
