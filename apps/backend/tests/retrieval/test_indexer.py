from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from lifescribe.retrieval.index import FTSIndex
from lifescribe.retrieval.indexer import Indexer
from lifescribe.vault.store import VaultStore


def _ts() -> datetime:
    return datetime(2026, 4, 14, 0, 0, 0, tzinfo=UTC)


def _make_src(id_: str = "src_a") -> dict:
    return dict(
        id=id_,
        type="SourceRecord",
        source_path="x.txt",
        source_hash="h" * 8,
        source_mtime=_ts(),
        imported_at=_ts(),
        imported_by_job="job_1",
        extractor="plain",
        extractor_confidence=1.0,
        mime_type="text/plain",
        original_filename="x.txt",
        size_bytes=100,
    )


def _make_doc(id_: str = "doc_a", parent: str = "src_a") -> dict:
    return dict(
        id=id_,
        type="DocumentRecord",
        parent_source=parent,
        position_in_parent="0",
        source_path="x.txt",
        source_hash="h" * 8,
        source_mtime=_ts(),
        imported_at=_ts(),
        imported_by_job="job_1",
        extractor="plain",
        extractor_confidence=1.0,
    )


@pytest.fixture
def setup(tmp_path: Path):
    vault = VaultStore.init(tmp_path, app_version="0.1.0-test")
    idx = FTSIndex.open(tmp_path / ".lifescribe" / "fts.db", vault_id=vault.manifest.id)
    indexer = Indexer(vault=vault, index=idx)
    yield vault, idx, indexer
    idx.close()


def test_reindex_document_record(setup):
    from lifescribe.vault.schemas import DocumentRecord, SourceRecord

    vault, idx, indexer = setup
    src = SourceRecord(**_make_src())
    vault.write_note(src, body="", commit_message="t: src")
    doc = DocumentRecord(**_make_doc())
    vault.write_note(
        doc,
        body="quarterly planning is in scope",
        commit_message="t: doc",
    )
    indexer.reindex_notes(["doc_a", "src_a"])

    results = idx.search("quarterly", k=5)
    assert any(r.note_id == "doc_a" for r in results)


def test_reindex_stale_picks_up_mtime_drift(setup, tmp_path):
    from lifescribe.vault.schemas import DocumentRecord, SourceRecord

    vault, idx, indexer = setup
    src = SourceRecord(**_make_src())
    vault.write_note(src, body="", commit_message="t: src")
    doc = DocumentRecord(**_make_doc())
    vault.write_note(doc, body="first version about cats", commit_message="t: doc")
    indexer.reindex_notes(["doc_a"])
    assert idx.search("cats", k=5)

    # hand-edit body and bump mtime
    path = tmp_path / "10_sources" / "src_a" / "doc_a.md"
    text = path.read_text(encoding="utf-8")
    path.write_text(text.replace("cats", "dogs"), encoding="utf-8")
    import os
    future = path.stat().st_mtime + 10
    os.utime(path, (future, future))

    indexer.reindex_stale()
    assert not idx.search("cats", k=5)
    assert idx.search("dogs", k=5)


def test_reindex_all_removes_notes_that_disappeared(setup, tmp_path):
    from lifescribe.vault.schemas import DocumentRecord, SourceRecord

    vault, idx, indexer = setup
    vault.write_note(
        SourceRecord(**_make_src()),
        body="",
        commit_message="t: src",
    )
    vault.write_note(
        DocumentRecord(**_make_doc()),
        body="content about cats",
        commit_message="t: doc",
    )
    indexer.reindex_all()
    assert idx.search("cats", k=5)

    # remove the doc file (simulates manual delete)
    (tmp_path / "10_sources" / "src_a" / "doc_a.md").unlink()
    indexer.reindex_all()
    assert not idx.search("cats", k=5)
