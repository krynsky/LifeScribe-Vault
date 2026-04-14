from __future__ import annotations

from pathlib import Path

import pytest

from lifescribe.retrieval.chunker import Chunk
from lifescribe.retrieval.index import FTSIndex


@pytest.fixture
def idx(tmp_path: Path) -> FTSIndex:
    ix = FTSIndex.open(tmp_path / "fts.db", vault_id="vault_test")
    yield ix
    ix.close()


def _chunk(note_id: str, content: str, chunk_id: str = "c1") -> Chunk:
    return Chunk(
        note_id=note_id,
        chunk_id=chunk_id,
        content=content,
        start_offset=0,
        end_offset=len(content),
    )


def test_upsert_and_search(idx: FTSIndex) -> None:
    idx.upsert_note(
        note_id="doc_a",
        note_type="DocumentRecord",
        tags=["planning"],
        imported_at="2026-04-14T00:00:00Z",
        chunks=[_chunk("doc_a", "quarterly planning for the team")],
    )
    results = idx.search("quarterly", k=5)
    assert len(results) == 1
    assert results[0].note_id == "doc_a"
    assert results[0].score < 0  # FTS5 bm25 is negative


def test_bm25_orders_more_relevant_first(idx: FTSIndex) -> None:
    idx.upsert_note(
        note_id="doc_a",
        note_type="DocumentRecord",
        tags=[],
        imported_at="",
        chunks=[_chunk("doc_a", "planning planning planning", "c1")],
    )
    idx.upsert_note(
        note_id="doc_b",
        note_type="DocumentRecord",
        tags=[],
        imported_at="",
        chunks=[_chunk("doc_b", "planning once only", "c1")],
    )
    results = idx.search("planning", k=5)
    ids = [r.note_id for r in results]
    assert ids.index("doc_a") < ids.index("doc_b")


def test_upsert_replaces_prior_chunks(idx: FTSIndex) -> None:
    idx.upsert_note(
        note_id="doc_a",
        note_type="DocumentRecord",
        tags=[],
        imported_at="",
        chunks=[_chunk("doc_a", "old content about cats", "c1")],
    )
    idx.upsert_note(
        note_id="doc_a",
        note_type="DocumentRecord",
        tags=[],
        imported_at="",
        chunks=[_chunk("doc_a", "new content about dogs", "c1")],
    )
    assert idx.search("cats", k=5) == []
    assert len(idx.search("dogs", k=5)) == 1


def test_delete_note_removes_chunks(idx: FTSIndex) -> None:
    idx.upsert_note(
        note_id="doc_a",
        note_type="DocumentRecord",
        tags=[],
        imported_at="",
        chunks=[_chunk("doc_a", "content about cats", "c1")],
    )
    idx.delete_note("doc_a")
    assert idx.search("cats", k=5) == []


def test_note_mtime_tracking(idx: FTSIndex) -> None:
    idx.upsert_note(
        note_id="doc_a",
        note_type="DocumentRecord",
        tags=[],
        imported_at="",
        mtime=123.45,
        chunks=[_chunk("doc_a", "hello", "c1")],
    )
    assert idx.get_note_mtime("doc_a") == 123.45
    assert idx.get_note_mtime("missing") is None


def test_vault_id_mismatch_raises(tmp_path: Path) -> None:
    db_path = tmp_path / "fts.db"
    ix = FTSIndex.open(db_path, vault_id="vault_one")
    ix.close()
    with pytest.raises(FTSIndex.VaultMismatch):
        FTSIndex.open(db_path, vault_id="vault_two")


def test_status_reports_counts_and_size(idx: FTSIndex) -> None:
    idx.upsert_note(
        note_id="doc_a",
        note_type="DocumentRecord",
        tags=[],
        imported_at="",
        chunks=[_chunk("doc_a", "one two three", "c1")],
    )
    status = idx.status()
    assert status["note_count"] == 1
    assert status["chunk_count"] == 1
    assert status["db_size_bytes"] > 0
