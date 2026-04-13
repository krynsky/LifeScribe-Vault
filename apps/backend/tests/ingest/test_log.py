from __future__ import annotations

from datetime import UTC, datetime

from lifescribe.ingest.log import render_log
from lifescribe.vault.schemas import (
    IngestJobLog, JobStatus, PerFileEntry, PerFileStatus, parse_note,
)
from lifescribe.vault.serialization import load_note


def _log(files: list[PerFileEntry], status: JobStatus) -> IngestJobLog:
    return IngestJobLog(
        id="job_2026-04-12_14-08-03_abcd",
        type="IngestJobLog",
        status=status,
        started_at=datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC),
        finished_at=None,
        total=len(files),
        succeeded=sum(f.status in (PerFileStatus.SUCCEEDED, PerFileStatus.SUCCEEDED_WITH_CONFLICT) for f in files),
        failed=sum(f.status == PerFileStatus.FAILED for f in files),
        skipped=sum(f.status in (PerFileStatus.SKIPPED, PerFileStatus.SKIPPED_IDENTICAL) for f in files),
        cancelled=sum(f.status == PerFileStatus.CANCELLED for f in files),
        app_version="0.2.0",
        files=files,
    )


def test_render_log_produces_gfm_table() -> None:
    files = [
        PerFileEntry(index=1, path="/a.pdf", status=PerFileStatus.SUCCEEDED,
                     source_id="src_a_abcd", extractor="pdf@0.1.0"),
        PerFileEntry(index=2, path="/b.zip", status=PerFileStatus.SKIPPED,
                     error="unsupported mime: application/zip"),
    ]
    log = _log(files, JobStatus.COMPLETED_WITH_FAILURES)
    md = render_log(log)
    assert "| 1 | /a.pdf | succeeded | src_a_abcd | pdf@0.1.0 |  |" in md
    assert "| 2 | /b.zip | skipped |  |  | unsupported mime: application/zip |" in md


def test_render_log_roundtrips_through_load_note() -> None:
    files = [PerFileEntry(index=1, path="/a.txt", status=PerFileStatus.SUCCEEDED,
                          source_id="src_a_abcd", extractor="text@0.1.0")]
    log = _log(files, JobStatus.COMPLETED)
    full_text = render_log(log, include_frontmatter=True)
    note, body = load_note(full_text)
    parsed = parse_note(note.model_dump(mode="json")) if hasattr(note, "model_dump") else note
    assert isinstance(parsed, IngestJobLog)
    assert parsed.id == log.id
    assert parsed.files[0].source_id == "src_a_abcd"
    assert "| 1 | /a.txt |" in body
