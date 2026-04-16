from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from lifescribe.connectors.base import ImportedDoc
from lifescribe.vault.importer import VaultImporter
from lifescribe.vault.store import VaultStore


@pytest.fixture
def store(tmp_path: Path) -> VaultStore:
    return VaultStore.init(tmp_path / "vault", app_version="test/0.0.1")


def _doc(
    name: str,
    content_hash: str,
    *,
    body: str = "hello",
    mime: str = "text/plain",
) -> ImportedDoc:
    return ImportedDoc(
        title=name,
        body_markdown=body,
        tags=[],
        source_meta={
            "mime_type": mime,
            "original_filename": f"{name}.txt",
            "size_bytes": len(body),
            "source_path": f"/tmp/{name}.txt",
            "source_mtime": datetime.now(UTC).isoformat(),
            "extractor": "text@0.1.0",
            "extractor_confidence": 1.0,
        },
        assets=[],
        content_hash=content_hash,
    )


def test_ingest_writes_source_record_and_commits(store: VaultStore) -> None:
    importer = VaultImporter(store=store)
    docs = [_doc("alpha", "a" * 64)]
    result = importer.ingest("file_drop", iter(docs))
    assert result.imported_count == 1
    assert result.skipped_count == 0
    found = list(store.list_notes(type_="SourceRecord"))
    assert len(found) == 1
    assert found[0].original_filename == "alpha.txt"


def test_ingest_dedupes_by_content_hash(store: VaultStore) -> None:
    importer = VaultImporter(store=store)
    h = "b" * 64
    first = importer.ingest("file_drop", iter([_doc("alpha", h)]))
    assert first.imported_count == 1
    second = importer.ingest("file_drop", iter([_doc("alpha", h)]))
    assert second.imported_count == 0
    assert second.skipped_count == 1
    assert len(list(store.list_notes(type_="SourceRecord"))) == 1


def test_ingest_copies_assets(store: VaultStore, tmp_path: Path) -> None:
    src = tmp_path / "payload.bin"
    src.write_bytes(b"x" * 100)
    doc = ImportedDoc(
        title="alpha",
        body_markdown="hi",
        tags=[],
        source_meta={
            "mime_type": "application/octet-stream",
            "original_filename": "payload.bin",
            "size_bytes": 100,
            "source_path": str(src),
            "source_mtime": datetime.now(UTC).isoformat(),
            "extractor": "raw@0",
            "extractor_confidence": 1.0,
        },
        assets=[src],
        content_hash="c" * 64,
    )
    importer = VaultImporter(store=store)
    importer.ingest("file_drop", iter([doc]))
    copied = list((store.root / "assets").rglob("payload.bin"))
    assert len(copied) == 1


def test_ingest_empty_iter_is_noop(store: VaultStore) -> None:
    importer = VaultImporter(store=store)
    result = importer.ingest("file_drop", iter([]))
    assert result.imported_count == 0
    assert result.skipped_count == 0
    assert list(store.list_notes(type_="SourceRecord")) == []


def test_ingest_extra_notes_batched_in_same_commit(store: VaultStore) -> None:
    from lifescribe.vault.schemas import IngestJobLog, JobStatus
    importer = VaultImporter(store=store)
    doc = _doc("alpha", "d" * 64)
    log = IngestJobLog(
        id="job_2026-04-16_00-00-00_abcd",
        type="IngestJobLog",
        status=JobStatus.COMPLETED,
        started_at=datetime.now(UTC),
        finished_at=datetime.now(UTC),
        total=1,
        succeeded=1,
        failed=0,
        skipped=0,
        cancelled=0,
        app_version="test/0.0.1",
        files=[],
    )
    result = importer.ingest(
        "file_drop",
        iter([doc]),
        extra_notes=[(log, "# log body\n")],
    )
    assert result.imported_count == 1
    assert store.exists(log.id)


def test_ingest_records_failed_doc_and_continues(store: VaultStore, tmp_path: Path) -> None:
    """A bad doc (missing asset) is captured in errors and does not block others."""
    good = _doc("alpha", "a" * 64)
    missing_asset = tmp_path / "does_not_exist.bin"
    bad = ImportedDoc(
        title="bravo",
        body_markdown="hi",
        tags=[],
        source_meta={
            "mime_type": "application/octet-stream",
            "original_filename": "does_not_exist.bin",
            "size_bytes": 0,
            "source_path": str(missing_asset),
            "source_mtime": datetime.now(UTC).isoformat(),
            "extractor": "raw@0",
            "extractor_confidence": 1.0,
        },
        assets=[missing_asset],
        content_hash="e" * 64,
    )
    importer = VaultImporter(store=store)
    result = importer.ingest("file_drop", iter([bad, good]))
    assert result.imported_count == 1  # the good one
    assert len(result.errors) == 1
    assert any("does_not_exist" in e for e in result.errors)
    failed_items = [i for i in result.items if i.status == "failed"]
    assert len(failed_items) == 1
    assert failed_items[0].identifier.endswith("does_not_exist.bin")
