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
