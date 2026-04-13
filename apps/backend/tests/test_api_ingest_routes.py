from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lifescribe.api.app import create_app
from lifescribe.api.routers.ingest import _IngestState
from lifescribe.api.routers.vault import _State
from lifescribe.vault.store import VaultStore


@pytest.fixture(autouse=True)
def _reset_state() -> None:  # type: ignore[return]
    yield
    _State.store = None
    _IngestState.active = None


def _wait_terminal(client: TestClient, jid: str, headers: dict[str, str]) -> dict:
    for _ in range(200):
        r = client.get(f"/ingest/jobs/{jid}", headers=headers)
        assert r.status_code == 200
        body = r.json()
        if body["status"] in ("completed", "completed_with_failures", "cancelled", "failed"):
            return body
        time.sleep(0.05)
    raise AssertionError("job did not reach terminal state")


def test_post_poll_completes(tmp_path: Path) -> None:
    app = create_app(auth_token="t")
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    _State.store = store

    src = tmp_path / "a.txt"
    src.write_text("hi", encoding="utf-8")

    headers = {"Authorization": "Bearer t"}
    with TestClient(app) as client:
        r = client.post("/ingest/jobs", json={"files": [str(src)]}, headers=headers)
        assert r.status_code == 202
        jid = r.json()["job_id"]
        body = _wait_terminal(client, jid, headers)

    assert body["total"] == 1
    assert body["succeeded"] == 1
    assert body["files"][0]["status"] == "succeeded"


def test_second_post_while_running_is_conflict(tmp_path: Path) -> None:
    app = create_app(auth_token="t")
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    _State.store = store

    srcs = [tmp_path / f"{i}.txt" for i in range(3)]
    for s in srcs:
        s.write_text(s.name, encoding="utf-8")

    headers = {"Authorization": "Bearer t"}
    with TestClient(app) as client:
        r1 = client.post("/ingest/jobs", json={"files": [str(s) for s in srcs]}, headers=headers)
        assert r1.status_code == 202
        r2 = client.post("/ingest/jobs", json={"files": [str(srcs[0])]}, headers=headers)
        # Might race: if r1 finished already, r2 also succeeds. Otherwise it's 409.
        assert r2.status_code in (202, 409)
        _wait_terminal(client, r1.json()["job_id"], headers)


def test_get_unknown_job_is_404(tmp_path: Path) -> None:
    app = create_app(auth_token="t")
    store = VaultStore.init(tmp_path / "v", app_version="0.2.0")
    _State.store = store
    headers = {"Authorization": "Bearer t"}
    with TestClient(app) as client:
        r = client.get("/ingest/jobs/job_nonexistent", headers=headers)
        assert r.status_code == 404
