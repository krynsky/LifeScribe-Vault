from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from PIL import ExifTags, Image

from lifescribe.ingest.extractors.base import ExtractionResult


class ImageExtractor:
    mimes: ClassVar[tuple[str, ...]] = (
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/tiff",
    )
    NAME = "image"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        extra: dict[str, object] = {}
        with Image.open(path) as img:
            extra["width"] = img.width
            extra["height"] = img.height
            extra["format"] = img.format or ""
            raw_exif = getattr(img, "_getexif", lambda: None)()
            if raw_exif:
                exif: dict[str, object] = {}
                for tag, value in raw_exif.items():
                    name = ExifTags.TAGS.get(tag, str(tag))
                    if isinstance(value, (bytes, bytearray)):
                        continue
                    if name in ("DateTime", "DateTimeOriginal", "Make", "Model"):
                        exif[name] = str(value)
                if exif:
                    extra["exif"] = exif

        return ExtractionResult(
            body_markdown="",
            extra_frontmatter=extra,
            extractor=f"{self.NAME}@{self.VERSION}",
            confidence=0.0,
        )
