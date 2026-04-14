from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lifescribe.api.app import create_app
from lifescribe.api.routers.ingest import _IngestState
from lifescribe.api.routers.vault import _State as _VaultState
from lifescribe.vault.store import VaultStore

TOKEN = "testtoken"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _reset() -> None:
    _VaultState.store = None
    _IngestState.active = None
    yield
    _VaultState.store = None
    _IngestState.active = None


def test_browse_after_import_loop(tmp_path: Path) -> None:
    store = VaultStore.init(tmp_path / "vault", app_version="0.0.0-test")
    _VaultState.store = store

    fixture = tmp_path / "hi.txt"
    fixture.write_text("hello world", encoding="utf-8")

    client = TestClient(create_app(auth_token=TOKEN))
    r = client.post("/ingest/jobs", headers=HEADERS, json={"files": [str(fixture)]})
    assert r.status_code == 202
    job_id = r.json()["job_id"]

    deadline = time.time() + 10
    while time.time() < deadline:
        g = client.get(f"/ingest/jobs/{job_id}", headers=HEADERS)
        if g.json()["status"] in {"completed", "completed_with_failures", "failed"}:
            break
        time.sleep(0.1)
    else:
        pytest.fail("job did not terminate in time")

    r = client.get("/vault/notes?type=SourceRecord", headers=HEADERS)
    assert r.status_code == 200
    notes = r.json()
    assert len(notes) == 1
    assert notes[0]["original_filename"] == "hi.txt"

    r = client.get(f"/vault/notes/{notes[0]['id']}", headers=HEADERS)
    assert r.status_code == 200
    assert "hello world" in r.json()["body"]
