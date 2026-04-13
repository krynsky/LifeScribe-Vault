from __future__ import annotations

import json
from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult


class JsonExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("application/json",)
    NAME = "json"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"invalid json: {e}") from e
        pretty = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False)
        body = f"```json\n{pretty}\n```\n"
        return ExtractionResult(
            body_markdown=body,
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=1.0,
        )
