from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from lifescribe.vault.schemas import (
    ConnectorRecord,
    DocumentRecord,
    IngestionLogEntry,
    Note,
    PrivacyLabel,
    SourceRecord,
    VaultManifest,
    parse_note,
)


def _ts() -> datetime:
    return datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC)


class TestSourceRecord:
    def _valid(self) -> dict[str, object]:
        return {
            "id": "src_foo_abcd",
            "type": "SourceRecord",
            "schema_version": 1,
            "source_path": "/tmp/foo.pdf",
            "source_hash": "sha256:abc",
            "source_mtime": _ts(),
            "imported_at": _ts(),
            "imported_by_job": "job_2026-04-12_001",
            "extractor": "test@0.0.1",
            "extractor_confidence": 1.0,
            "privacy": "private",
            "links": {"parent_source": None, "derived_from": []},
            "tags": [],
            "mime_type": "application/pdf",
            "original_filename": "foo.pdf",
            "size_bytes": 1234,
            "page_count": 3,
        }

    def test_valid(self) -> None:
        rec = SourceRecord(**self._valid())  # type: ignore[arg-type]
        assert rec.id == "src_foo_abcd"
        assert rec.privacy is PrivacyLabel.PRIVATE

    def test_rejects_wrong_type(self) -> None:
        data = self._valid()
        data["type"] = "DocumentRecord"
        with pytest.raises(ValidationError):
            SourceRecord(**data)  # type: ignore[arg-type]

    def test_rejects_bad_id_prefix(self) -> None:
        data = self._valid()
        data["id"] = "doc_foo_abcd"
        with pytest.raises(ValidationError):
            SourceRecord(**data)  # type: ignore[arg-type]


class TestVaultManifest:
    def test_valid(self) -> None:
        m = VaultManifest(
            id="vault_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            type="VaultManifest",
            schema_version=1,
            app_version="0.1.0",
            created_at=_ts(),
            migrations=[],
        )
        assert m.schema_version == 1


class TestParseNote:
    def test_dispatches_on_type(self) -> None:
        src = {
            "id": "src_foo_abcd",
            "type": "SourceRecord",
            "schema_version": 1,
            "source_path": "/tmp/x",
            "source_hash": "sha256:xx",
            "source_mtime": _ts(),
            "imported_at": _ts(),
            "imported_by_job": "job_2026-04-12_001",
            "extractor": "e@1",
            "extractor_confidence": 1.0,
            "privacy": "private",
            "links": {"parent_source": None, "derived_from": []},
            "tags": [],
            "mime_type": "text/plain",
            "original_filename": "x.txt",
            "size_bytes": 3,
        }
        note: Note = parse_note(src)
        assert isinstance(note, SourceRecord)

    def test_unknown_type_raises(self) -> None:
        with pytest.raises(ValidationError):
            parse_note({"type": "Bogus", "id": "bog_x_abcd"})


class TestDocumentRecord:
    def test_requires_parent_source(self) -> None:
        with pytest.raises(ValidationError):
            DocumentRecord(
                id="doc_x_abcd",
                type="DocumentRecord",
                schema_version=1,
                source_path="/tmp/x",
                source_hash="sha256:y",
                source_mtime=_ts(),
                imported_at=_ts(),
                imported_by_job="job_2026-04-12_001",
                extractor="e@1",
                extractor_confidence=1.0,
                privacy="private",
                links={"parent_source": None, "derived_from": []},
                tags=[],
                parent_source=None,  # type: ignore[arg-type]
                position_in_parent="page 1",
            )


class TestConnectorAndLog:
    def test_connector(self) -> None:
        c = ConnectorRecord(
            id="conn_local_abcd",
            type="ConnectorRecord",
            schema_version=1,
            connector_type="FileConnector",
            auth_ref=None,
            schedule=None,
            last_run=None,
            status="active",
            privacy="private",
            links={"parent_source": None, "derived_from": []},
            tags=[],
        )
        assert c.connector_type == "FileConnector"

    def test_ingestion_log(self) -> None:
        e = IngestionLogEntry(
            id="job_2026-04-12_001",
            type="IngestionLogEntry",
            schema_version=1,
            job_id="job_2026-04-12_001",
            started_at=_ts(),
            finished_at=_ts(),
            inputs=["/tmp/foo.pdf"],
            outputs=["src_foo_abcd"],
            warnings=[],
            errors=[],
        )
        assert e.job_id == e.id


def test_ingest_job_log_roundtrip() -> None:
    from lifescribe.vault.schemas import (
        IngestJobLog,
        JobStatus,
        PerFileEntry,
        PerFileStatus,
        parse_note,
    )

    log = IngestJobLog(
        id="job_2026-04-12_14-08-03_abc1",
        type="IngestJobLog",
        status=JobStatus.COMPLETED,
        started_at=datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC),
        finished_at=datetime(2026, 4, 12, 14, 9, 41, tzinfo=UTC),
        total=2,
        succeeded=1,
        failed=0,
        skipped=1,
        cancelled=0,
        app_version="0.2.0",
        files=[
            PerFileEntry(
                index=1,
                path="/abs/a.pdf",
                status=PerFileStatus.SUCCEEDED,
                source_id="src_report_abc1",
                extractor="pdf@0.1.0",
                error=None,
            ),
            PerFileEntry(
                index=2,
                path="/abs/b.zip",
                status=PerFileStatus.SKIPPED,
                source_id=None,
                extractor=None,
                error="unsupported mime: application/zip",
            ),
        ],
    )
    dumped = log.model_dump(mode="json")
    parsed = parse_note(dumped)
    assert parsed == log
    assert parsed.id.startswith("job_")


def test_ingest_job_log_id_prefix_rejected() -> None:
    from lifescribe.vault.schemas import IngestJobLog, JobStatus

    with pytest.raises(ValueError, match="id must start with 'job_'"):
        IngestJobLog(
            id="bad",
            type="IngestJobLog",
            status=JobStatus.QUEUED,
            started_at=datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC),
            finished_at=None,
            total=0,
            succeeded=0,
            failed=0,
            skipped=0,
            cancelled=0,
            app_version="0.2.0",
            files=[],
        )


def test_llm_provider_note_parses_and_enforces_id_prefix() -> None:
    from lifescribe.vault.schemas import LLMProvider, parse_note

    data = {
        "id": "llm_lmstudio_default",
        "type": "LLMProvider",
        "schema_version": 1,
        "adapter": "openai_compatible",
        "display_name": "LM Studio",
        "base_url": "http://127.0.0.1:1234/v1",
        "local": True,
        "secret_ref": None,
        "default_model": None,
        "enabled": True,
    }
    note = parse_note(data)
    assert isinstance(note, LLMProvider)
    assert note.display_name == "LM Studio"
    assert note.local is True


def test_llm_provider_rejects_bad_id_prefix() -> None:
    import pytest

    from lifescribe.vault.schemas import LLMProvider

    with pytest.raises(ValueError, match="llm_"):
        LLMProvider(
            id="bad_id",
            type="LLMProvider",
            display_name="X",
            base_url="http://127.0.0.1:1234/v1",
            local=True,
        )
