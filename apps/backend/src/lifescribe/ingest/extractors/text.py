from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from charset_normalizer import from_bytes

from lifescribe.ingest.extractors.base import ExtractionResult


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        match = from_bytes(raw).best()
        # charset_normalizer can misidentify short non-UTF-8 sequences;
        # prefer its guess only when it resolves to a Western/Latin family.
        _latin_family = {"latin-1", "iso-8859-1", "iso-8859-2", "iso-8859-15",
                         "cp1252", "cp1250", "windows-1252", "windows-1250"}
        if match is not None and match.encoding.lower() in _latin_family:
            try:
                text = raw.decode(match.encoding)
            except (UnicodeDecodeError, LookupError):
                text = str(match)
        else:
            # Fall back to latin-1 (never raises, lossless for 8-bit data)
            text = raw.decode("latin-1")
    return text.replace("\r\n", "\n").replace("\r", "\n")


class TextExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
    NAME = "text"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown=_read_text(path),
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=1.0,
        )


class MarkdownExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/markdown",)
    NAME = "markdown"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown=_read_text(path),
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=1.0,
        )
