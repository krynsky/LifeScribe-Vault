from __future__ import annotations

from pathlib import Path

import puremagic

_EXT_MAP = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
}


def detect_mime(path: Path) -> str:
    # Try magic-byte detection first (reliable for binary formats)
    try:
        with path.open("rb") as f:
            head = f.read(8192)
        guesses = puremagic.magic_stream(_BytesStream(head), filename=path.name)
    except (puremagic.PureError, OSError, ValueError):
        guesses = []

    # Filter to guesses with a real mime type and confidence >= 0.5
    # (low-confidence guesses driven purely by extension are less reliable
    # than our curated _EXT_MAP for text-based formats)
    strong_guesses = [g for g in guesses if g.mime_type and g.confidence >= 0.5]
    if strong_guesses:
        return strong_guesses[0].mime_type

    # Extension map covers text-based formats precisely
    ext_mime = _EXT_MAP.get(path.suffix.lower())
    if ext_mime:
        return ext_mime

    # Low-confidence magic guess as last resort before octet-stream
    if guesses and guesses[0].mime_type:
        return guesses[0].mime_type

    return "application/octet-stream"


class _BytesStream:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self._pos = 0

    def read(self, n: int = -1) -> bytes:
        if n < 0 or n > len(self._data) - self._pos:
            n = len(self._data) - self._pos
        chunk = self._data[self._pos : self._pos + n]
        self._pos += n
        return chunk

    def seek(self, pos: int, whence: int = 0) -> int:
        if whence == 0:
            self._pos = pos
        elif whence == 1:
            self._pos += pos
        elif whence == 2:
            self._pos = len(self._data) + pos
        return self._pos

    def tell(self) -> int:
        return self._pos
