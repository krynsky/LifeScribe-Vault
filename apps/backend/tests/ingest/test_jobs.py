from __future__ import annotations

from datetime import UTC, datetime

from lifescribe.ingest.jobs import JobRequest, new_job_id


def test_new_job_id_format() -> None:
    jid = new_job_id(datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC))
    assert jid.startswith("job_2026-04-12_14-08-03_")
    assert len(jid.split("_")[-1]) == 4


def test_job_request_minimum() -> None:
    req = JobRequest(files=["/abs/a.txt"])
    assert req.files == ["/abs/a.txt"]
