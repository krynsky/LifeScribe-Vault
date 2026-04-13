from __future__ import annotations

from fastapi.testclient import TestClient

from lifescribe.api.app import create_app


def test_missing_token_is_401() -> None:
    app = create_app(auth_token="secret")
    with TestClient(app) as client:
        r = client.get("/health")
        assert r.status_code == 401


def test_wrong_token_is_401() -> None:
    app = create_app(auth_token="secret")
    with TestClient(app) as client:
        r = client.get("/health", headers={"Authorization": "Bearer nope"})
        assert r.status_code == 401


def test_correct_token_200() -> None:
    app = create_app(auth_token="secret")
    with TestClient(app) as client:
        r = client.get("/health", headers={"Authorization": "Bearer secret"})
        assert r.status_code == 200
        assert r.json()["status"] == "ok"
