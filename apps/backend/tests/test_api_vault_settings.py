from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lifescribe.api.app import create_app
from lifescribe.api.routers.vault import _State
from lifescribe.vault.store import VaultStore

TOKEN = "testtoken"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _reset_state() -> None:
    _State.store = None
    yield
    _State.store = None


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    store = VaultStore.init(tmp_path / "vault", app_version="0.0.0-test")
    _State.store = store
    return TestClient(create_app(auth_token=TOKEN))


def test_get_settings_on_fresh_vault_returns_defaults(client: TestClient) -> None:
    r = client.get("/vault/settings", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["privacy_mode"] is False
    assert body["id"] == "settings_default"
    assert body["type"] == "VaultSettings"


def test_put_settings_persists(client: TestClient) -> None:
    r = client.put(
        "/vault/settings",
        headers=HEADERS,
        json={"privacy_mode": True},
    )
    assert r.status_code == 200
    assert r.json()["privacy_mode"] is True

    r2 = client.get("/vault/settings", headers=HEADERS)
    assert r2.json()["privacy_mode"] is True


def test_put_settings_rejects_unknown_fields(client: TestClient) -> None:
    r = client.put(
        "/vault/settings",
        headers=HEADERS,
        json={"privacy_mode": True, "bogus": 1},
    )
    assert r.status_code == 422
