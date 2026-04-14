from __future__ import annotations

from fastapi.testclient import TestClient

from lifescribe.api.app import create_app
from lifescribe.api.routers.llm import set_vault_store
from lifescribe.vault.schemas import LLMProvider
from lifescribe.vault.store import VaultStore

AUTH = {"Authorization": "Bearer test-token"}


def _setup(tmp_path):
    store = VaultStore.init(tmp_path / "v", app_version="t")
    app = create_app(auth_token="test-token")
    set_vault_store(store)
    return store, TestClient(app)


def test_list_and_get_provider(tmp_path) -> None:
    store, client = _setup(tmp_path)
    note = LLMProvider(
        id="llm_lmstudio_default",
        type="LLMProvider",
        display_name="LM Studio",
        base_url="http://127.0.0.1:1234/v1",
        local=True,
    )
    store.write_note(note, body="", commit_message="add")

    r = client.get("/llm/providers", headers=AUTH)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["id"] == "llm_lmstudio_default"
    assert data[0]["has_credential"] is False
    assert "secret_ref" in data[0]
    assert "token" not in data[0]

    r = client.get("/llm/providers/llm_lmstudio_default", headers=AUTH)
    assert r.status_code == 200
    assert r.json()["display_name"] == "LM Studio"

    r = client.get("/llm/providers/llm_missing", headers=AUTH)
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "provider_not_found"


def test_create_provider_assigns_id_and_writes_note(tmp_path) -> None:
    store, client = _setup(tmp_path)
    body = {
        "display_name": "My LM Studio",
        "base_url": "http://127.0.0.1:1234/v1",
        "local": True,
    }
    r = client.post("/llm/providers", json=body, headers=AUTH)
    assert r.status_code == 201
    got = r.json()
    assert got["id"].startswith("llm_")
    assert got["display_name"] == "My LM Studio"
    assert sum(1 for _ in store.list_notes(type_="LLMProvider")) == 1


def test_update_provider_round_trips(tmp_path) -> None:
    _, client = _setup(tmp_path)
    r = client.post(
        "/llm/providers",
        json={"display_name": "A", "base_url": "http://127.0.0.1:1234/v1", "local": True},
        headers=AUTH,
    )
    pid = r.json()["id"]
    r = client.put(
        f"/llm/providers/{pid}",
        json={"display_name": "B", "base_url": "http://127.0.0.1:1234/v1", "local": True},
        headers=AUTH,
    )
    assert r.status_code == 200
    assert r.json()["display_name"] == "B"


def test_delete_provider_removes_note_and_credential(tmp_path) -> None:
    _, client = _setup(tmp_path)
    r = client.post(
        "/llm/providers",
        json={
            "display_name": "GH",
            "base_url": "https://models.inference.ai.azure.com",
            "local": False,
        },
        headers=AUTH,
    )
    pid = r.json()["id"]
    client.put(f"/llm/providers/{pid}/credential", json={"value": "pat_x"}, headers=AUTH)
    pid = pid  # no-op
    r = client.delete(f"/llm/providers/{pid}", headers=AUTH)
    assert r.status_code == 204
    r = client.get(f"/llm/providers/{pid}", headers=AUTH)
    assert r.status_code == 404
