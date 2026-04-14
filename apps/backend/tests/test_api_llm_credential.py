from __future__ import annotations

from fastapi.testclient import TestClient

from lifescribe.api.app import create_app
from lifescribe.api.routers.llm import set_vault_store
from lifescribe.llm.secrets import SecretStore
from lifescribe.vault.store import VaultStore

AUTH = {"Authorization": "Bearer t"}


def _setup(tmp_path):
    store = VaultStore.init(tmp_path / "v", app_version="t")
    app = create_app(auth_token="t")
    set_vault_store(store)
    return store, TestClient(app)


def test_put_credential_sets_keyring_and_syntesizes_ref(tmp_path) -> None:
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
    r = client.put(f"/llm/providers/{pid}/credential", json={"value": "pat_xyz"}, headers=AUTH)
    assert r.status_code == 204

    r = client.get(f"/llm/providers/{pid}", headers=AUTH)
    got = r.json()
    assert got["has_credential"] is True
    assert got["secret_ref"] == f"llm.{pid}.token"
    assert "pat_xyz" not in r.text
    assert SecretStore().get(f"llm.{pid}.token") == "pat_xyz"


def test_delete_credential_removes_keyring(tmp_path) -> None:
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
    client.put(f"/llm/providers/{pid}/credential", json={"value": "x"}, headers=AUTH)
    r = client.delete(f"/llm/providers/{pid}/credential", headers=AUTH)
    assert r.status_code == 204
    assert SecretStore().get(f"llm.{pid}.token") is None


def test_put_credential_unknown_provider_404(tmp_path) -> None:
    _, client = _setup(tmp_path)
    r = client.put("/llm/providers/llm_nope/credential", json={"value": "x"}, headers=AUTH)
    assert r.status_code == 404
