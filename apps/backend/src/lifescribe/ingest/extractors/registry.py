from __future__ import annotations

from lifescribe.ingest.extractors.base import Extractor


class ExtractorRegistry:
    def __init__(self) -> None:
        self._by_mime: dict[str, Extractor] = {}

    def register(self, extractor: Extractor) -> None:
        for mime in extractor.mimes:
            self._by_mime[mime] = extractor

    def find(self, mime: str) -> Extractor | None:
        return self._by_mime.get(mime)
