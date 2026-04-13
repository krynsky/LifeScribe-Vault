from __future__ import annotations

from datetime import UTC, datetime

from lifescribe.vault.schemas import SourceRecord
from lifescribe.vault.serialization import dump_note, load_note


def _ts() -> datetime:
    return datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC)


def _record() -> SourceRecord:
    return SourceRecord(
        id="src_hello_abcd",
        type="SourceRecord",
        schema_version=1,
        source_path="/tmp/hello.txt",
        source_hash="sha256:deadbeef",
        source_mtime=_ts(),
        imported_at=_ts(),
        imported_by_job="job_2026-04-12_001",
        extractor="test@0.0.1",
        extractor_confidence=1.0,
        privacy="private",
        links={"parent_source": None, "derived_from": []},
        tags=[],
        mime_type="text/plain",
        original_filename="hello.txt",
        size_bytes=5,
    )


def test_dump_produces_frontmatter_and_body() -> None:
    rec = _record()
    text = dump_note(rec, body="Hello, world.")
    assert text.startswith("---\n")
    assert "id: src_hello_abcd" in text
    assert "\n---\n" in text
    assert text.rstrip().endswith("Hello, world.")


def test_load_round_trips() -> None:
    rec = _record()
    text = dump_note(rec, body="Hello.")
    loaded_note, body = load_note(text)
    assert loaded_note == rec
    assert body.strip() == "Hello."


def test_missing_body_dumps_empty() -> None:
    rec = _record()
    text = dump_note(rec, body="")
    loaded, body = load_note(text)
    assert loaded == rec
    assert body == ""


def test_datetime_serializes_as_iso8601() -> None:
    rec = _record()
    text = dump_note(rec, body="")
    assert "2026-04-12T14:08:03" in text
