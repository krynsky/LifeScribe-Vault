from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from lifescribe import connectors_dir
from lifescribe.connectors import load_catalog
from lifescribe.connectors.base import ConnectorConfig, ImportRequest
from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.jobs import new_job_id
from lifescribe.ingest.log import render_log
from lifescribe.vault.ids import compose_id, content_short_hash, sanitize_slug
from lifescribe.vault.importer import VaultImporter
from lifescribe.vault.schemas import (
    IngestJobLog,
    JobStatus,
    PerFileEntry,
    PerFileStatus,
)
from lifescribe.vault.store import VaultStore

if TYPE_CHECKING:
    from lifescribe.retrieval.indexer import Indexer

logger = logging.getLogger(__name__)

# NOTE: This pipeline talks to FileDropConnector directly rather than via
# `run_connector`. Reason: we bundle the IngestJobLog into the same git commit
# as the imported SourceRecords (via VaultImporter's `extra_notes`), which
# requires knowing succeeded/failed/skipped counts BEFORE ingest() is called.
# Going through `run_connector` would force a second commit for the log.
#
# `file_drop` is `privacy_posture="local_only"`, so the privacy gate that
# `run_connector` enforces is moot here. Teardown is preserved via the local
# try/finally around collect(). Any future connector wired into this pipeline
# must be local_only or re-architect the log-bundling.


@dataclass
class JobHandle:
    id: str
    cancel_requested: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)


_ITEM_STATUS_TO_PER_FILE = {
    "imported": PerFileStatus.SUCCEEDED,
    "skipped_identical": PerFileStatus.SKIPPED_IDENTICAL,
    "skipped_unsupported": PerFileStatus.SKIPPED,
    "failed": PerFileStatus.FAILED,
    "cancelled": PerFileStatus.CANCELLED,
}


def run_job(
    store: VaultStore,
    *,
    files: list[Path],
    registry: ExtractorRegistry,
    app_version: str,
    handle: JobHandle | None = None,
    indexer: Indexer | None = None,
) -> IngestJobLog:
    started_at = datetime.now(UTC)
    job_id = handle.id if handle else new_job_id(started_at)

    # load_catalog(connectors_dir()) adds the connectors root to sys.path as a
    # side-effect, which makes `from connectors.file_drop.connector import ...`
    # work on the next line.
    catalog = load_catalog(connectors_dir())
    entry = catalog.find("file_drop")
    if entry is None:
        raise RuntimeError(
            "file_drop connector manifest missing — "
            "the reference connector must ship with the app"
        )

    from connectors.file_drop.connector import FileDropConnector  # type: ignore[import-not-found]

    class _Configured(FileDropConnector):  # type: ignore[misc]
        def __init__(self) -> None:
            super().__init__(registry=registry)

    connector = _Configured()
    connector.configure(ConnectorConfig(vault_path=store.root, privacy_mode=False))

    # Build the inputs list, honouring early cancellation.
    inputs: list[Path] = []
    for src in files:
        if handle is not None and handle.cancel_requested:
            break
        inputs.append(src)

    # Materialise the generator so connector.last_item_entries is fully
    # populated (it captures skipped / failed items that are never yielded).
    try:
        yielded_docs = list(connector.collect(ImportRequest(inputs=inputs)))
    finally:
        try:
            connector.teardown()
        except Exception as exc:
            logger.warning("file_drop connector teardown raised: %s", exc)

    # ------------------------------------------------------------------ #
    # Build per_file entries in original file order.
    #
    # Three item sources:
    #   A. connector.last_item_entries — skipped/failed items (not yielded)
    #   B. yielded_docs — will be processed by VaultImporter
    #   C. cancelled_paths — files we never passed to the connector
    #
    # We pre-classify B items by checking vault existence (mirrors what
    # VaultImporter.ingest() will do) so we can build the log and pass it
    # as extra_notes, ensuring sources + log land in ONE git commit.
    # ------------------------------------------------------------------ #

    # Map path → connector-side entry for NON-YIELDED items only (skipped / failed).
    # "imported" entries from last_item_entries are also in yielded_docs — those
    # are handled via yielded_entries below (which has the source_id).
    connector_entries: dict[str, PerFileEntry] = {}
    for item in connector.last_item_entries:
        if item.status == "imported":
            continue  # handled via yielded_entries
        connector_entries[item.identifier] = PerFileEntry(
            index=1,  # will be rewritten below
            path=item.identifier,
            status=_ITEM_STATUS_TO_PER_FILE.get(item.status, PerFileStatus.FAILED),
            extractor=(
                str(item.meta.get("extractor"))
                if item.meta and isinstance(item.meta.get("extractor"), str)
                else None
            ),
            error=item.error,
        )

    # Pre-classify B items (yielded docs) by checking vault existence.
    yielded_entries: dict[str, PerFileEntry] = {}
    for doc in yielded_docs:
        src_path = str(doc.source_meta.get("source_path") or doc.title)
        short = content_short_hash(doc.content_hash.encode("ascii"))
        slug = sanitize_slug(doc.title or "untitled")
        note_id = compose_id(type_prefix="src", slug=slug, short_hash=short)
        if store.exists(note_id):
            extractor_str = str(doc.source_meta.get("extractor") or "")
            yielded_entries[src_path] = PerFileEntry(
                index=1,  # will be rewritten below
                path=src_path,
                status=PerFileStatus.SKIPPED_IDENTICAL,
                source_id=note_id,
                extractor=extractor_str or None,
            )
        else:
            extractor_str = str(doc.source_meta.get("extractor") or "")
            yielded_entries[src_path] = PerFileEntry(
                index=1,  # will be rewritten below
                path=src_path,
                status=PerFileStatus.SUCCEEDED,
                source_id=note_id,
                extractor=extractor_str or None,
            )

    # Stitch everything together in original file order, assigning indices.
    per_file: list[PerFileEntry] = []
    _seen: dict[str, int] = {}
    for idx, src in enumerate(files, start=1):
        key = str(src)
        occurrence = _seen.get(key, 0)
        _seen[key] = occurrence + 1

        if idx > len(inputs):
            # File was never handed to the connector — cancelled.
            per_file.append(PerFileEntry(index=idx, path=key, status=PerFileStatus.CANCELLED))
            continue

        if key in connector_entries:
            e = connector_entries[key]
            per_file.append(
                PerFileEntry(
                    index=idx,
                    path=e.path,
                    status=e.status,
                    source_id=e.source_id,
                    extractor=e.extractor,
                    error=e.error,
                )
            )
        elif key in yielded_entries:
            e = yielded_entries[key]
            per_file.append(
                PerFileEntry(
                    index=idx,
                    path=e.path,
                    status=e.status,
                    source_id=e.source_id,
                    extractor=e.extractor,
                    error=e.error,
                )
            )
        else:
            # Shouldn't happen if the connector accounts for every input.
            per_file.append(
                PerFileEntry(
                    index=idx,
                    path=key,
                    status=PerFileStatus.FAILED,
                    error="internal: connector produced no entry for this file",
                )
            )

    failed = sum(1 for e in per_file if e.status == PerFileStatus.FAILED)
    succeeded = sum(1 for e in per_file if e.status == PerFileStatus.SUCCEEDED)
    skipped = sum(
        1 for e in per_file
        if e.status in (PerFileStatus.SKIPPED, PerFileStatus.SKIPPED_IDENTICAL)
    )
    cancelled = sum(1 for e in per_file if e.status == PerFileStatus.CANCELLED)

    finished_at = datetime.now(UTC)
    if cancelled > 0:
        job_status = JobStatus.CANCELLED
    elif failed > 0:
        job_status = JobStatus.COMPLETED_WITH_FAILURES
    else:
        job_status = JobStatus.COMPLETED

    log = IngestJobLog(
        id=job_id,
        type="IngestJobLog",
        status=job_status,
        started_at=started_at,
        finished_at=finished_at,
        total=len(files),
        succeeded=succeeded,
        failed=failed,
        skipped=skipped,
        cancelled=cancelled,
        app_version=app_version,
        files=per_file,
    )

    # Pass log as extra_notes so sources + log land in ONE git commit.
    importer = VaultImporter(store=store, indexer=indexer)
    importer.ingest(
        entry.service,
        iter(yielded_docs),
        extra_notes=[(log, render_log(log, include_frontmatter=False))],
        commit_message_override=(
            f"ingest: {job_id} ({succeeded} ok, {failed} failed, {skipped} skipped)"
        ),
        job_id=job_id,
    )

    return log
