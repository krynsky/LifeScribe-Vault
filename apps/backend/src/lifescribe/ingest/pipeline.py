from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.jobs import new_job_id
from lifescribe.ingest.log import render_log
from lifescribe.ingest.mime import detect_mime
from lifescribe.vault.ids import compose_id, content_short_hash, sanitize_slug
from lifescribe.vault.schemas import (
    IngestJobLog,
    JobStatus,
    Note,
    PerFileEntry,
    PerFileStatus,
    SourceRecord,
)
from lifescribe.vault.store import VaultStore


@dataclass
class JobHandle:
    id: str
    cancel_requested: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _asset_rel_path(full_hash: str, filename: str) -> str:
    safe = filename.replace("/", "_").replace("\\", "_")
    return f"assets/{full_hash[:2]}/{full_hash}/{safe}"


def _copy_asset(store: VaultStore, src: Path, full_hash: str) -> str:
    rel = _asset_rel_path(full_hash, src.name)
    dest = store.root / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        dest.write_bytes(src.read_bytes())
    return rel


def _build_source_record(
    *,
    src: Path,
    mime: str,
    full_hash: str,
    extractor: str,
    confidence: float,
    title: str | None,
    extra: dict[str, object],
    job_id: str,
    now: datetime,
) -> SourceRecord:
    short = content_short_hash(full_hash.encode("ascii"))
    slug = sanitize_slug(title or src.stem)
    note_id = compose_id(type_prefix="src", slug=slug, short_hash=short)
    stat = src.stat()
    page_count = extra.get("page_count") if isinstance(extra.get("page_count"), int) else None
    return SourceRecord(
        id=note_id,
        type="SourceRecord",
        source_path=str(src),
        source_hash=f"sha256:{full_hash}",
        source_mtime=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
        imported_at=now,
        imported_by_job=job_id,
        extractor=extractor,
        extractor_confidence=confidence,
        mime_type=mime,
        original_filename=src.name,
        size_bytes=stat.st_size,
        page_count=page_count,
    )


def run_job(
    store: VaultStore,
    *,
    files: list[Path],
    registry: ExtractorRegistry,
    app_version: str,
    handle: JobHandle | None = None,
) -> IngestJobLog:
    started_at = datetime.now(UTC)
    job_id = handle.id if handle else new_job_id(started_at)
    per_file: list[PerFileEntry] = []
    to_commit: list[tuple[Note, str]] = []
    asset_rels: list[str] = []
    succeeded = failed = skipped = cancelled = 0

    for idx, src in enumerate(files, start=1):
        if handle is not None and handle.cancel_requested:
            per_file.append(
                PerFileEntry(
                    index=idx,
                    path=str(src),
                    status=PerFileStatus.CANCELLED,
                )
            )
            cancelled += 1
            continue

        if not src.exists():
            per_file.append(
                PerFileEntry(
                    index=idx,
                    path=str(src),
                    status=PerFileStatus.FAILED,
                    error="file not found",
                )
            )
            failed += 1
            continue

        mime = detect_mime(src)
        extractor = registry.find(mime)
        if extractor is None:
            per_file.append(
                PerFileEntry(
                    index=idx,
                    path=str(src),
                    status=PerFileStatus.SKIPPED,
                    error=f"unsupported mime: {mime}",
                )
            )
            skipped += 1
            continue

        full_hash = _sha256(src)
        short = content_short_hash(full_hash.encode("ascii"))
        slug = sanitize_slug(src.stem)
        probable_id = compose_id(type_prefix="src", slug=slug, short_hash=short)

        # idempotency: same bytes + same filename → no-op if already in vault
        existing_path = store.root / "10_sources" / f"{probable_id}.md"
        if existing_path.exists():
            per_file.append(
                PerFileEntry(
                    index=idx,
                    path=str(src),
                    status=PerFileStatus.SKIPPED_IDENTICAL,
                    source_id=probable_id,
                    extractor=f"{extractor.NAME}@{extractor.VERSION}",
                )
            )
            skipped += 1
            continue

        try:
            result = extractor.extract(src)
        except Exception as e:  # per-file failure isolation
            per_file.append(
                PerFileEntry(
                    index=idx,
                    path=str(src),
                    status=PerFileStatus.FAILED,
                    extractor=f"{extractor.NAME}@{extractor.VERSION}",
                    error=f"{type(e).__name__}: {e}",
                )
            )
            failed += 1
            continue

        asset_rel = _copy_asset(store, src, full_hash)
        asset_rels.append(asset_rel)

        now = datetime.now(UTC)
        rec = _build_source_record(
            src=src,
            mime=mime,
            full_hash=full_hash,
            extractor=result.extractor,
            confidence=result.confidence,
            title=result.title,
            extra=result.extra_frontmatter,
            job_id=job_id,
            now=now,
        )
        to_commit.append((rec, result.body_markdown))
        per_file.append(
            PerFileEntry(
                index=idx,
                path=str(src),
                status=PerFileStatus.SUCCEEDED,
                source_id=rec.id,
                extractor=result.extractor,
            )
        )
        succeeded += 1

    finished_at = datetime.now(UTC)
    if handle is not None and handle.cancel_requested:
        status = JobStatus.CANCELLED
    elif failed > 0:
        status = JobStatus.COMPLETED_WITH_FAILURES
    else:
        status = JobStatus.COMPLETED

    log = IngestJobLog(
        id=job_id,
        type="IngestJobLog",
        status=status,
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

    # one commit per job: log + sources + assets
    items: list[tuple[Note, str]] = [(log, render_log(log, include_frontmatter=False))]
    items.extend(to_commit)
    message = f"ingest: {job_id} ({succeeded} ok, {failed} failed, {skipped} skipped)"
    store.write_batch(items, commit_message=message, extra_paths=asset_rels)
    return log
