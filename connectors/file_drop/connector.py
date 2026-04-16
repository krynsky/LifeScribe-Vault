"""Reference connector — wraps the existing extractor registry."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Iterator

from lifescribe.connectors.base import (
    Connector,
    ConnectorConfig,
    ImportedDoc,
    ImportItemEntry,
    ImportRequest,
)
from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.mime import detect_mime
from lifescribe.ingest.registry_default import default_registry  # CORRECTED


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


class FileDropConnector(Connector):
    """Default file-drop connector. Accepts any file the extractor registry handles."""

    def __init__(self, registry: ExtractorRegistry | None = None) -> None:
        self._registry = registry or default_registry()
        self._config: ConnectorConfig | None = None
        self.last_item_entries: list[ImportItemEntry] = []

    def configure(self, cfg: ConnectorConfig) -> None:
        self._config = cfg
        self.last_item_entries = []

    def collect(self, req: ImportRequest) -> Iterator[ImportedDoc]:
        for src in req.inputs:
            if not src.exists():
                self.last_item_entries.append(
                    ImportItemEntry(
                        status="failed",
                        identifier=str(src),
                        error="file not found",
                    )
                )
                continue

            mime = detect_mime(src)
            extractor = self._registry.find(mime)
            if extractor is None:
                self.last_item_entries.append(
                    ImportItemEntry(
                        status="skipped_unsupported",
                        identifier=str(src),
                        error=f"unsupported mime: {mime}",
                        meta={"mime_type": mime},
                    )
                )
                continue

            try:
                result = extractor.extract(src)
            except Exception as exc:
                self.last_item_entries.append(
                    ImportItemEntry(
                        status="failed",
                        identifier=str(src),
                        error=f"{type(exc).__name__}: {exc}",
                        meta={"extractor": f"{extractor.NAME}@{extractor.VERSION}"},
                    )
                )
                continue

            stat = src.stat()
            yield ImportedDoc(
                title=result.title or src.stem,
                body_markdown=result.body_markdown,
                tags=[],
                source_meta={
                    "mime_type": mime,
                    "original_filename": src.name,
                    "size_bytes": stat.st_size,
                    "source_path": str(src),
                    "source_mtime": stat.st_mtime,
                    "extractor": result.extractor,
                    "extractor_confidence": result.confidence,
                    "page_count": result.extra_frontmatter.get("page_count"),
                },
                assets=[src],
                content_hash=_sha256(src),
            )
            self.last_item_entries.append(
                ImportItemEntry(
                    status="imported",
                    identifier=str(src),
                    meta={
                        "extractor": result.extractor,
                        "mime_type": mime,
                    },
                )
            )

    def teardown(self) -> None:
        self._config = None
