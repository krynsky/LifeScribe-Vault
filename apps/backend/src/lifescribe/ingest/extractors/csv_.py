from __future__ import annotations

import csv
from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult

_MAX_ROWS = 1000


def _md_escape_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ").replace("\r", "")


class CsvExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/csv",)
    NAME: ClassVar[str] = "csv"
    VERSION: ClassVar[str] = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        with path.open("r", encoding="utf-8", newline="") as f:
            sample = f.read(4096)
            f.seek(0)
            try:
                dialect = csv.Sniffer().sniff(sample) if sample else csv.excel
            except csv.Error:
                dialect = csv.excel
            reader = csv.reader(f, dialect=dialect)
            rows = list(reader)

        if not rows:
            return ExtractionResult(
                body_markdown="",
                extractor=f"{self.NAME}@{self.VERSION}",
                confidence=1.0,
            )

        header = rows[0]
        data = rows[1:]
        total = len(data)
        truncated = total > _MAX_ROWS
        if truncated:
            data = data[:_MAX_ROWS]

        lines = [
            "| " + " | ".join(_md_escape_cell(c) for c in header) + " |",
            "| " + " | ".join("---" for _ in header) + " |",
        ]
        for row in data:
            padded = row + [""] * (len(header) - len(row))
            lines.append(
                "| " + " | ".join(_md_escape_cell(c) for c in padded[: len(header)]) + " |"
            )
        if truncated:
            lines.append("")
            lines.append(f"… truncated at {_MAX_ROWS} rows ({total} total) …")

        body = "\n".join(lines) + "\n"
        return ExtractionResult(
            body_markdown=body,
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=1.0,
        )
