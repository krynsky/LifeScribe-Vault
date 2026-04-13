from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult
from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.pipeline import run_job
from lifescribe.vault.schemas import JobStatus, PerFileStatus
from lifescribe.vault.store import VaultStore


class _FakeText:
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
    NAME = "fake"
    VERSION = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown=path.read_text(encoding="utf-8"),
            extractor="fake@0.1.0",
            confidence=1.0,
        )


def test_single_file_happy_path(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    src = tmp_path / "a.txt"
    src.write_text("hello", encoding="utf-8")

    registry = ExtractorRegistry()
    registry.register(_FakeText())

    pre = store._repo.log_oneline()
    log = run_job(store, files=[src], registry=registry, app_version="0.2.0")

    assert log.status == JobStatus.COMPLETED
    assert log.succeeded == 1
    assert log.failed == 0
    assert log.files[0].status == PerFileStatus.SUCCEEDED
    assert log.files[0].source_id is not None
    assert log.files[0].source_id.startswith("src_a_")

    post = store._repo.log_oneline()
    assert len(post) == len(pre) + 1

    # SourceRecord exists on disk
    source_id = log.files[0].source_id
    assert source_id is not None
    note_path = store.root / "10_sources" / f"{source_id}.md"
    assert note_path.exists()

    # Asset exists under content-addressed path
    assets = list((store.root / "assets").rglob("a.txt"))
    assert len(assets) == 1

    # Log file exists
    log_files = list((store.root / "system" / "logs" / "ingestion").rglob(f"{log.id}.md"))
    assert len(log_files) == 1


def test_reimport_identical_is_skipped(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    src = tmp_path / "a.txt"
    src.write_text("hello", encoding="utf-8")
    reg = ExtractorRegistry()
    reg.register(_FakeText())

    run_job(store, files=[src], registry=reg, app_version="0.2.0")
    pre = store._repo.log_oneline()
    log2 = run_job(store, files=[src], registry=reg, app_version="0.2.0")
    post = store._repo.log_oneline()

    assert log2.skipped == 1
    assert log2.files[0].status == PerFileStatus.SKIPPED_IDENTICAL
    # Second run still commits (the log itself), so exactly one new commit:
    assert len(post) == len(pre) + 1


def test_unknown_mime_is_skipped_not_failed(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    blob = tmp_path / "x.xyz"
    blob.write_bytes(b"\x00\x01\x02")
    reg = ExtractorRegistry()  # no extractors registered

    log = run_job(store, files=[blob], registry=reg, app_version="0.2.0")
    assert log.skipped == 1
    assert log.failed == 0
    assert log.files[0].status == PerFileStatus.SKIPPED
    assert "unsupported mime" in (log.files[0].error or "")


def test_extractor_exception_marks_file_failed(tmp_path: Path) -> None:
    class _Boom:
        mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
        NAME = "boom"
        VERSION = "0.1.0"

        def extract(self, path: Path) -> ExtractionResult:
            raise RuntimeError("nope")

    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    src = tmp_path / "a.txt"
    src.write_text("x", encoding="utf-8")
    reg = ExtractorRegistry()
    reg.register(_Boom())

    log = run_job(store, files=[src], registry=reg, app_version="0.2.0")
    assert log.status == JobStatus.COMPLETED_WITH_FAILURES
    assert log.files[0].status == PerFileStatus.FAILED
    assert "RuntimeError: nope" in (log.files[0].error or "")


def test_cancel_flag_stops_at_next_file(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    a = tmp_path / "a.txt"; a.write_text("a", encoding="utf-8")
    b = tmp_path / "b.txt"; b.write_text("b", encoding="utf-8")
    c = tmp_path / "c.txt"; c.write_text("c", encoding="utf-8")

    # Set cancel before job starts so the first iteration sees it.
    from lifescribe.ingest.pipeline import JobHandle
    handle = JobHandle(id="job_2026-04-12_14-08-03_aaaa", cancel_requested=True)
    reg = ExtractorRegistry()
    reg.register(_FakeText())

    log = run_job(store, files=[a, b, c], registry=reg, app_version="0.2.0", handle=handle)
    assert log.status == JobStatus.CANCELLED
    assert log.cancelled == 3
    assert all(f.status == PerFileStatus.CANCELLED for f in log.files)
