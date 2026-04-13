from __future__ import annotations

from pathlib import Path
from typing import Any, ClassVar, Protocol

from pydantic import BaseModel, ConfigDict, Field


class ExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body_markdown: str
    title: str | None = None
    extra_frontmatter: dict[str, Any] = Field(default_factory=dict)
    extractor: str
    confidence: float = Field(ge=0.0, le=1.0)


class Extractor(Protocol):
    mimes: ClassVar[tuple[str, ...]]
    NAME: ClassVar[str]
    VERSION: ClassVar[str]

    def extract(self, path: Path) -> ExtractionResult: ...
