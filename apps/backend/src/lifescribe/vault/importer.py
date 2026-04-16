from __future__ import annotations

import logging
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from lifescribe.connectors.base import ImportedDoc, ImportItemEntry, ImportResult
from lifescribe.vault.ids import compose_id, content_short_hash, sanitize_slug
from lifescribe.vault.schemas import Note, SourceRecord
from lifescribe.vault.store import VaultStore

if TYPE_CHECKING:
    from lifescribe.retrieval.indexer import Indexer

logger = logging.getLogger(__name__)


def _asset_rel_path(full_hash: str, filename: str) -> str:
    safe = filename.replace("/", "_").replace("\\", "_")
    return f"assets/{full_hash[:2]}/{full_hash}/{safe}"


def _copy_asset_if_needed(store: VaultStore, src: Path, full_hash: str) -> str:
    rel = _asset_rel_path(full_hash, src.name)
    dest = store.root / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        dest.write_bytes(src.read_bytes())
    return rel


def _parse_dt(value: object) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=UTC)
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return datetime.now(UTC)


def _coerce_float(value: object, *, default: float) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return default
    return default


def _coerce_int(value: object, *, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return default
    return default


@dataclass
class VaultImporter:
    """Consumes ImportedDoc streams and writes them into a VaultStore.

    Handles dedupe (by ``content_hash``), asset copy, note id computation,
    and a single commit per run. Optional ``extra_notes`` are bundled into
    the same commit — enabling connector-specific log notes (e.g. IngestJobLog)
    without a second commit.
    """

    store: VaultStore
    indexer: Indexer | None = None

    def ingest(
        self,
        connector: str,
        docs: Iterator[ImportedDoc] | Iterable[ImportedDoc],
        *,
        extra_notes: list[tuple[Note, str]] | None = None,
        commit_message_override: str | None = None,
        job_id: str | None = None,
    ) -> ImportResult:
        imported_count = 0
        skipped_count = 0
        errors: list[str] = []
        items: list[ImportItemEntry] = []
        to_write: list[tuple[Note, str]] = []
        asset_rels: list[str] = []
        now = datetime.now(UTC)
        job_stamp = job_id or f"import_{now.strftime('%Y%m%dT%H%M%SZ')}"

        for doc in docs:
            try:
                short = content_short_hash(doc.content_hash.encode("ascii"))
                slug = sanitize_slug(doc.title or "untitled")
                note_id = compose_id(type_prefix="src", slug=slug, short_hash=short)

                if self.store.exists(note_id):
                    skipped_count += 1
                    items.append(
                        ImportItemEntry(
                            status="skipped_identical",
                            identifier=str(doc.source_meta.get("source_path") or doc.title),
                            note_id=note_id,
                        )
                    )
                    continue

                for asset in doc.assets:
                    if not asset.exists():
                        raise FileNotFoundError(f"asset {asset} does not exist")
                    asset_rels.append(_copy_asset_if_needed(self.store, asset, doc.content_hash))

                page_count_raw = doc.source_meta.get("page_count")
                page_count = page_count_raw if isinstance(page_count_raw, int) else None
                record = SourceRecord(
                    id=note_id,
                    type="SourceRecord",
                    source_path=str(doc.source_meta.get("source_path") or ""),
                    source_hash=f"sha256:{doc.content_hash}",
                    source_mtime=_parse_dt(doc.source_meta.get("source_mtime")),
                    imported_at=now,
                    imported_by_job=job_stamp,
                    extractor=str(doc.source_meta.get("extractor") or f"{connector}@unknown"),
                    extractor_confidence=_coerce_float(
                        doc.source_meta.get("extractor_confidence"), default=1.0
                    ),
                    mime_type=str(doc.source_meta.get("mime_type") or "application/octet-stream"),
                    original_filename=str(doc.source_meta.get("original_filename") or doc.title),
                    size_bytes=_coerce_int(doc.source_meta.get("size_bytes"), default=0),
                    page_count=page_count,
                    tags=list(doc.tags),
                )
                to_write.append((record, doc.body_markdown))
                imported_count += 1
                items.append(
                    ImportItemEntry(
                        status="imported",
                        identifier=str(doc.source_meta.get("source_path") or doc.title),
                        note_id=note_id,
                        meta={
                            "extractor": record.extractor,
                            "mime_type": record.mime_type,
                        },
                    )
                )
            except Exception as exc:
                errors.append(f"{doc.title}: {exc}")
                items.append(
                    ImportItemEntry(
                        status="failed",
                        identifier=str(doc.source_meta.get("source_path") or doc.title),
                        error=f"{type(exc).__name__}: {exc}",
                    )
                )

        batch: list[tuple[Note, str]] = list(to_write)
        if extra_notes:
            batch.extend(extra_notes)

        if batch:
            message = commit_message_override or (f"import: {connector} ({imported_count})")
            self.store.write_batch(
                batch,
                commit_message=message,
                extra_paths=asset_rels,
            )
            if self.indexer is not None and imported_count > 0:
                try:
                    self.indexer.reindex_notes([r.id for r, _ in to_write])
                except Exception as exc:
                    logger.warning("post-import reindex failed: %s", exc)

        return ImportResult(
            connector=connector,
            imported_count=imported_count,
            skipped_count=skipped_count,
            errors=errors,
            items=items,
        )
