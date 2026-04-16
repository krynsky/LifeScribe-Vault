from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from lifescribe.connectors import (
    ConnectorConfigError,
    PrivacyBlockedError,
    run_connector,
)
from lifescribe.connectors.base import (
    Connector,
    ConnectorConfig,
    ImportedDoc,
    ImportRequest,
    ImportResult,
)
from lifescribe.connectors.catalog import CatalogEntry


class _FakeImporter:
    def __init__(self) -> None:
        self.seen: list[ImportedDoc] = []

    def ingest(self, connector: str, docs: Iterator[ImportedDoc], **_: object) -> ImportResult:
        materialized = list(docs)
        self.seen.extend(materialized)
        return ImportResult(
            connector=connector,
            imported_count=len(materialized),
            skipped_count=0,
            errors=[],
        )


class _OkConnector(Connector):
    def __init__(self) -> None:
        self.events: list[str] = []

    def configure(self, cfg: ConnectorConfig) -> None:
        self.events.append("configure")

    def collect(self, req: ImportRequest) -> Iterator[ImportedDoc]:
        self.events.append("collect")
        yield ImportedDoc(
            title="t",
            body_markdown="b",
            tags=[],
            source_meta={},
            assets=[],
            content_hash="0" * 64,
        )

    def teardown(self) -> None:
        self.events.append("teardown")


class _ConfigFailsConnector(_OkConnector):
    def configure(self, cfg: ConnectorConfig) -> None:
        self.events.append("configure")
        raise ValueError("bad options")


class _CollectRaisesConnector(_OkConnector):
    def collect(self, req: ImportRequest) -> Iterator[ImportedDoc]:
        self.events.append("collect")
        raise RuntimeError("mid-collect boom")
        yield  # pragma: no cover


class _TeardownRaisesConnector(_OkConnector):
    def teardown(self) -> None:
        self.events.append("teardown")
        raise RuntimeError("teardown boom")


_FAKE_ENTRY = CatalogEntry(
    service="fake",
    display_name="Fake",
    description="",
    category="test",
    auth_mode="none",
    tier="free",
    connector_type="file",
    entry_point="irrelevant",
    supported_formats=[],
    privacy_posture="local_only",
    export_instructions="",
    sample_files=[],
    manifest_schema_version=1,
    manifest_path=Path("/tmp/manifest.toml"),
)


def _req() -> ImportRequest:
    return ImportRequest(inputs=[])


def test_happy_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    connector = _OkConnector()
    monkeypatch.setattr("lifescribe.connectors.resolve_entry_point", lambda _ep: lambda: connector)
    importer = _FakeImporter()
    result = run_connector(
        _FAKE_ENTRY,
        _req(),
        importer=importer,
        vault_path=tmp_path,
        privacy_mode=False,
    )
    assert connector.events == ["configure", "collect", "teardown"]
    assert result.imported_count == 1
    assert len(importer.seen) == 1


def test_privacy_blocks_requires_network(tmp_path: Path) -> None:
    entry = CatalogEntry(**{**_FAKE_ENTRY.__dict__, "privacy_posture": "requires_network"})
    with pytest.raises(PrivacyBlockedError):
        run_connector(
            entry,
            _req(),
            importer=_FakeImporter(),
            vault_path=tmp_path,
            privacy_mode=True,
        )


def test_privacy_allows_local_only_when_on(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    connector = _OkConnector()
    monkeypatch.setattr("lifescribe.connectors.resolve_entry_point", lambda _ep: lambda: connector)
    result = run_connector(
        _FAKE_ENTRY,
        _req(),
        importer=_FakeImporter(),
        vault_path=tmp_path,
        privacy_mode=True,
    )
    assert result.imported_count == 1


def test_configure_raise_wraps_as_config_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    connector = _ConfigFailsConnector()
    monkeypatch.setattr("lifescribe.connectors.resolve_entry_point", lambda _ep: lambda: connector)
    with pytest.raises(ConnectorConfigError):
        run_connector(
            _FAKE_ENTRY,
            _req(),
            importer=_FakeImporter(),
            vault_path=tmp_path,
            privacy_mode=False,
        )
    # teardown still called despite configure failure
    assert "teardown" in connector.events


def test_collect_raise_calls_teardown(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    connector = _CollectRaisesConnector()
    monkeypatch.setattr("lifescribe.connectors.resolve_entry_point", lambda _ep: lambda: connector)
    with pytest.raises(RuntimeError, match="mid-collect boom"):
        run_connector(
            _FAKE_ENTRY,
            _req(),
            importer=_FakeImporter(),
            vault_path=tmp_path,
            privacy_mode=False,
        )
    assert connector.events[-1] == "teardown"


def test_teardown_error_logged_not_raised(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    connector = _TeardownRaisesConnector()
    monkeypatch.setattr("lifescribe.connectors.resolve_entry_point", lambda _ep: lambda: connector)
    with caplog.at_level("WARNING"):
        result = run_connector(
            _FAKE_ENTRY,
            _req(),
            importer=_FakeImporter(),
            vault_path=tmp_path,
            privacy_mode=False,
        )
    assert result.imported_count == 1
    assert any("teardown" in rec.message.lower() for rec in caplog.records)
