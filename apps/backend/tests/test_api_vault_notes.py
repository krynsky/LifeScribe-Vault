from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lifescribe.api.app import create_app
from lifescribe.api.routers.vault import _State
from lifescribe.vault.schemas import SourceRecord
from lifescribe.vault.store import VaultStore

TOKEN = "testtoken"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _reset_state() -> None:
    _State.store = None
    yield
    _State.store = None


@pytest.fixture
def client_with_store(tmp_path: Path) -> TestClient:
    store = VaultStore.init(tmp_path / "vault", app_version="0.0.0-test")
    _State.store = store
    return TestClient(create_app(auth_token=TOKEN))


def _make_source(store: VaultStore, id_: str, title: str) -> None:
    note = SourceRecord(
        id=id_,
        type="SourceRecord",
        source_path="/abs/x.txt",
        source_hash="deadbeef" * 8,
        source_mtime=datetime.now(UTC),
        imported_at=datetime.now(UTC),
        imported_by_job="job_test",
        extractor="text@0.1.0",
        extractor_confidence=1.0,
        mime_type="text/plain",
        original_filename="x.txt",
        size_bytes=3,
    )
    store.write_note(note, body=f"# {title}\n", commit_message="test")


def test_list_notes_by_type(client_with_store: TestClient) -> None:
    store = _State.store
    assert store is not None
    _make_source(store, "src_alpha-11111111", "Alpha")
    _make_source(store, "src_beta-22222222", "Beta")

    r = client_with_store.get("/vault/notes?type=SourceRecord", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    ids = {n["id"] for n in body}
    assert ids == {"src_alpha-11111111", "src_beta-22222222"}
    assert all(n["type"] == "SourceRecord" for n in body)


def test_list_notes_unknown_type(client_with_store: TestClient) -> None:
    r = client_with_store.get("/vault/notes?type=Bogus", headers=HEADERS)
    assert r.status_code == 400


def test_list_notes_empty_when_none_match(client_with_store: TestClient) -> None:
    r = client_with_store.get("/vault/notes?type=IngestJobLog", headers=HEADERS)
    assert r.status_code == 200
    assert r.json() == []


def test_list_notes_requires_open_vault(tmp_path: Path) -> None:
    client = TestClient(create_app(auth_token=TOKEN))
    r = client.get("/vault/notes?type=SourceRecord", headers=HEADERS)
    assert r.status_code == 409
