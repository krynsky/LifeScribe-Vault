from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from lifescribe.vault.schemas import SourceRecord
from lifescribe.vault.store import VaultStore


def _ts() -> datetime:
    return datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC)


def _src(i: int) -> SourceRecord:
    return SourceRecord(
        id=f"src_file-{i}_abcd",
        type="SourceRecord",
        schema_version=1,
        source_path=f"/tmp/file-{i}.txt",
        source_hash=f"sha256:{i:04d}",
        source_mtime=_ts(),
        imported_at=_ts(),
        imported_by_job="job_2026-04-12_001",
        extractor="test@0.0.1",
        extractor_confidence=1.0,
        privacy="private",
        links={"parent_source": None, "derived_from": []},
        tags=[],
        mime_type="text/plain",
        original_filename=f"file-{i}.txt",
        size_bytes=5,
    )


def test_write_batch_single_commit(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    notes = [_src(i) for i in range(3)]
    results = store.write_batch(
        [(n, f"body-{n.id}") for n in notes],
        commit_message="ingest: batch",
    )
    assert len(results) == 3
    assert all(r.conflict is False for r in results)
    log = store._repo.log_oneline()
    assert len(log) == 2


def test_write_asset(tmp_vault: Path, tmp_path: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    src_file = tmp_path / "image.png"
    src_file.write_bytes(b"\x89PNG fake")
    ref = store.write_asset(src_file, canonical_name="image-abcd.png")
    assert ref.path == tmp_vault / "assets" / "image-abcd.png"
    assert ref.path.read_bytes() == b"\x89PNG fake"


def test_list_notes_filters_by_type(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    store.write_note(_src(0), body="", commit_message="x")
    store.write_note(_src(1), body="", commit_message="y")
    source_ids = sorted(n.id for n in store.list_notes(type_="SourceRecord"))
    assert source_ids == ["src_file-0_abcd", "src_file-1_abcd"]


def test_is_hand_edited(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    rec = _src(0)
    result = store.write_note(rec, body="v1", commit_message="x")
    assert store.is_hand_edited(rec.id) is False
    result.path.write_text("tampered\n", encoding="utf-8")
    assert store.is_hand_edited(rec.id) is True
