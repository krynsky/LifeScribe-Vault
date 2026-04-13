from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from lifescribe.api.app import create_app


def _client() -> TestClient:
    app = create_app(auth_token="t")
    return TestClient(app)


AUTH = {"Authorization": "Bearer t"}


def test_status_empty(tmp_path: Path) -> None:
    with _client() as c:
        r = c.get("/vault/status", headers=AUTH)
        assert r.status_code == 200
        assert r.json() == {"open": False, "manifest": None}


def test_init_then_status(tmp_path: Path) -> None:
    target = tmp_path / "myvault"
    with _client() as c:
        r = c.post("/vault/init", json={"path": str(target)}, headers=AUTH)
        assert r.status_code == 200
        body = r.json()
        assert body["manifest"]["schema_version"] == 1
        r2 = c.get("/vault/status", headers=AUTH)
        assert r2.json()["open"] is True


def test_open_nonexistent_404(tmp_path: Path) -> None:
    with _client() as c:
        r = c.post("/vault/open", json={"path": str(tmp_path / "missing")}, headers=AUTH)
        assert r.status_code == 404
