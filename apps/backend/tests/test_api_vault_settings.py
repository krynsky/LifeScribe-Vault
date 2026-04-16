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


def test_settings_default_chat_model_roundtrip(client: TestClient) -> None:
    r = client.put(
        "/vault/settings",
        headers=HEADERS,
        json={
            "privacy_mode": False,
            "default_chat_provider_id": "github_models",
            "default_chat_model": "gpt-4o",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["default_chat_provider_id"] == "github_models"
    assert body["default_chat_model"] == "gpt-4o"

    r2 = client.get("/vault/settings", headers=HEADERS)
    body2 = r2.json()
    assert body2["default_chat_provider_id"] == "github_models"
    assert body2["default_chat_model"] == "gpt-4o"


def test_settings_default_chat_model_nullable(client: TestClient) -> None:
    # Set then clear default_chat_model fields
    client.put(
        "/vault/settings",
        headers=HEADERS,
        json={
            "privacy_mode": False,
            "default_chat_provider_id": "github_models",
            "default_chat_model": "gpt-4o",
        },
    )
    r = client.put(
        "/vault/settings",
        headers=HEADERS,
        json={
            "privacy_mode": False,
            "default_chat_provider_id": None,
            "default_chat_model": None,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["default_chat_provider_id"] is None
    assert body["default_chat_model"] is None
