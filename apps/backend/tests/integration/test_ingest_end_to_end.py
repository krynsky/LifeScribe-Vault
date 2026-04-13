from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.pipeline import run_job
from lifescribe.ingest.registry_default import default_registry
from lifescribe.vault.schemas import JobStatus
from lifescribe.vault.store import VaultStore


def test_six_format_batch(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    store = VaultStore.init(vault, app_version="0.2.0")

    # Build one file per text-only format
    (tmp_path / "a.txt").write_text("plain text\n", encoding="utf-8")
    (tmp_path / "b.md").write_text("# md\npara\n", encoding="utf-8")
    (tmp_path / "c.json").write_text('{"k": 1}', encoding="utf-8")
    (tmp_path / "d.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    (tmp_path / "e.html").write_text(
        "<html><head><title>T</title></head><body><article><p>hello world hello world</p></article></body></html>",
        encoding="utf-8",
    )
    # minimal PDF via the shared conftest helper
    from tests.ingest.conftest import _write_minimal_pdf
    pdf_path = tmp_path / "f.pdf"
    _write_minimal_pdf(pdf_path)

    files = [tmp_path / n for n in ["a.txt", "b.md", "c.json", "d.csv", "e.html", "f.pdf"]]

    pre = store._repo.log_oneline()
    log = run_job(
        store, files=files, registry=default_registry(), app_version="0.2.0"
    )
    post = store._repo.log_oneline()

    assert len(post) == len(pre) + 1
    assert log.status == JobStatus.COMPLETED
    assert log.succeeded == 6
    assert log.failed == 0

    sources = list((vault / "10_sources").glob("src_*.md"))
    assert len(sources) == 6

    assets = list((vault / "assets").rglob("*"))
    assert sum(1 for a in assets if a.is_file()) == 6

    logs = list((vault / "system" / "logs" / "ingestion").rglob("job_*.md"))
    assert len(logs) == 1
