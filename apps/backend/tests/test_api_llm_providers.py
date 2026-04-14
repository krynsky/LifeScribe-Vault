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
