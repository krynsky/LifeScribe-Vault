from __future__ import annotations

from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock

from lifescribe.api.app import create_app
from lifescribe.api.routers.llm import set_vault_store
from lifescribe.vault.schemas import VaultSettings
from lifescribe.vault.store import VaultStore

AUTH = {"Authorization": "Bearer t"}


def _setup(tmp_path):
    store = VaultStore.init(tmp_path / "v", app_version="t")
    app = create_app(auth_token="t")
    set_vault_store(store)
    return store, TestClient(app)


def _provider(client):
    r = client.post(
        "/llm/providers",
        json={
            "display_name": "Local",
            "base_url": "http://127.0.0.1:1234/v1",
            "local": True,
        },
        headers=AUTH,
    )
    return r.json()["id"]


def test_non_streaming_chat_returns_full_content(tmp_path, httpx_mock: HTTPXMock) -> None:
    _, client = _setup(tmp_path)
    pid = _provider(client)
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        content=(
            b'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'
            b'data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\n\n'
            b"data: [DONE]\n\n"
        ),
        headers={"content-type": "text/event-stream"},
    )
    r = client.post(
        "/llm/chat",
        json={
            "provider_id": pid,
            "model": "m",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers=AUTH,
    )
    assert r.status_code == 200
    assert r.json() == {"content": "Hi!", "finish_reason": "stop"}


def test_chat_privacy_blocks_remote(tmp_path) -> None:
    store, client = _setup(tmp_path)
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
    store.write_note(
        VaultSettings(id="settings_default", type="VaultSettings", privacy_mode=True),
        body="",
        commit_message="privacy",
    )
    r = client.post(
        "/llm/chat",
        json={
            "provider_id": pid,
            "model": "m",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers=AUTH,
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "remote_provider_disabled"
