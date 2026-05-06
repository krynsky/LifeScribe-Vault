from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult, Extractor


class ExtractionChainError(RuntimeError):
    pass


class RoutedExtractor:
    NAME: ClassVar[str] = "routed"
    VERSION: ClassVar[str] = "0.1.0"

    def __init__(self, *, mimes: tuple[str, ...], extractors: list[Extractor]) -> None:
        if not mimes:
            raise ValueError("mimes must not be empty")
        if not extractors:
            raise ValueError("extractors must not be empty")
        self.mimes = mimes
        self._extractors = extractors

    def extractors_for_tests(self) -> tuple[Extractor, ...]:
        return tuple(self._extractors)

    def extract(self, path: Path) -> ExtractionResult:
        attempts: list[str] = []
        warnings: list[str] = []

        for extractor in self._extractors:
            engine = f"{extractor.NAME}@{extractor.VERSION}"
            attempts.append(engine)
            try:
                result = extractor.extract(path)
            except Exception as exc:
                warnings.append(f"{engine} failed: {type(exc).__name__}: {exc}")
                continue

            metadata = dict(result.extra_frontmatter)
            metadata.update(
                {
                    "engine_router": f"{self.NAME}@{self.VERSION}",
                    "engine_selected": engine,
                    "engine_attempts": attempts,
                    "engine_warnings": warnings,
                }
            )
            return result.model_copy(update={"extra_frontmatter": metadata})

        raise ExtractionChainError("all extraction engines failed: " + "; ".join(warnings))
