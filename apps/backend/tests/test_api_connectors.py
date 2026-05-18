from __future__ import annotations

from pathlib import Path
from textwrap import dedent

HEADERS = {"Authorization": "Bearer test-token"}


def _write_remote_manifest(connectors_dir: Path, service: str = "test_remote") -> None:
    cdir = connectors_dir / service
    cdir.mkdir()
    (cdir / "manifest.toml").write_text(
        dedent(
            f"""
            manifest_schema_version = 1
            service = "{service}"
            display_name = "Test Remote"
            description = "Requires network access."
            category = "test"
            auth_mode = "api_key"
            tier = "free"
            connector_type = "api_sync"
            entry_point = "tests.connectors.missing:MissingConnector"
            supported_formats = []
            privacy_posture = "requires_network"
            export_instructions = "For privacy-gate testing only."
            sample_files = []
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )


def test_get_connectors_lists_file_drop(client) -> None:
    r = client.get("/connectors", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert "entries" in body and "warnings" in body
    services = [e["service"] for e in body["entries"]]
    assert "file_drop" in services
    entry = next(e for e in body["entries"] if e["service"] == "file_drop")
    assert entry["blocked"] is False
    assert entry["privacy_posture"] == "local_only"


def test_get_connectors_precomputes_blocked_when_privacy_on(client) -> None:
    r = client.put("/vault/settings", json={"privacy_mode": True}, headers=HEADERS)
    assert r.status_code == 200, r.text
    r = client.get("/connectors", headers=HEADERS)
    body = r.json()
    # file_drop is local_only → still unblocked
    entry = next(e for e in body["entries"] if e["service"] == "file_drop")
    assert entry["blocked"] is False


def test_get_connectors_blocks_requires_network_when_privacy_on(
    client, tmp_path, monkeypatch
) -> None:
    connectors_dir = tmp_path / "connectors"
    connectors_dir.mkdir()
    _write_remote_manifest(connectors_dir)
    monkeypatch.setattr(
        "lifescribe.api.routers.connectors.connectors_dir", lambda: connectors_dir
    )

    r = client.put("/vault/settings", json={"privacy_mode": True}, headers=HEADERS)
    assert r.status_code == 200, r.text
    r = client.get("/connectors", headers=HEADERS)
    assert r.status_code == 200, r.text
    entry = next(e for e in r.json()["entries"] if e["service"] == "test_remote")
    assert entry["blocked"] is True
    assert entry["privacy_posture"] == "requires_network"


def test_get_connector_sample_returns_file(client) -> None:
    r = client.get("/connectors/file_drop/samples/example.txt", headers=HEADERS)
    assert r.status_code == 200
    assert b"sample" in r.content.lower()


def test_get_connector_sample_rejects_traversal(client) -> None:
    r = client.get("/connectors/file_drop/samples/..%2Fmanifest.toml", headers=HEADERS)
    assert r.status_code == 404


def test_get_connector_sample_unknown_service_404(client) -> None:
    r = client.get("/connectors/does_not_exist/samples/foo.txt", headers=HEADERS)
    assert r.status_code == 404


def test_post_imports_file_drop_returns_import_result(client, tmp_path) -> None:
    src = tmp_path / "hello.txt"
    src.write_text("sample import through the generic connector route", encoding="utf-8")

    r = client.post(
        "/imports",
        json={"service": "file_drop", "inputs": [str(src)]},
        headers=HEADERS,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["connector"] == "file_drop"
    assert body["imported_count"] == 1
    assert body["skipped_count"] == 0
    assert body["errors"] == []


def test_post_imports_requires_network_returns_409_when_privacy_on(
    client, tmp_path, monkeypatch
) -> None:
    connectors_dir = tmp_path / "connectors"
    connectors_dir.mkdir()
    _write_remote_manifest(connectors_dir)
    monkeypatch.setattr("lifescribe.api.routers.imports.connectors_dir", lambda: connectors_dir)

    r = client.put("/vault/settings", json={"privacy_mode": True}, headers=HEADERS)
    assert r.status_code == 200, r.text
    r = client.post(
        "/imports",
        json={"service": "test_remote", "inputs": []},
        headers=HEADERS,
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "privacy_blocked"
    assert r.json()["detail"]["service"] == "test_remote"
