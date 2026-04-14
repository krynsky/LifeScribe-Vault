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


def test_stream_chat_sse_happy_path(tmp_path, httpx_mock: HTTPXMock) -> None:
    _, client = _setup(tmp_path)
    pid = _provider(client)
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        content=(
            b'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
            b'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n'
            b"data: [DONE]\n\n"
        ),
        headers={"content-type": "text/event-stream"},
    )
    with client.stream(
        "POST",
        "/llm/chat/stream",
        json={
            "provider_id": pid,
            "model": "m",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers=AUTH,
    ) as resp:
        assert resp.status_code == 200
        body = b"".join(resp.iter_bytes()).decode()
    assert "event: chunk" in body
    assert '"delta":"Hel"' in body
    assert "event: done" in body


def test_stream_chat_error_before_first_chunk_returns_json(tmp_path, httpx_mock: HTTPXMock) -> None:
    _, client = _setup(tmp_path)
    pid = _provider(client)
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        status_code=502,
        text="bad gateway",
    )
    r = client.post(
        "/llm/chat/stream",
        json={
            "provider_id": pid,
            "model": "m",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers=AUTH,
    )
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "upstream_502"


def test_stream_chat_error_mid_stream_emits_error_event(tmp_path, httpx_mock: HTTPXMock) -> None:
    _, client = _setup(tmp_path)
    pid = _provider(client)

    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        content=b'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\nBROKEN',
        headers={"content-type": "text/event-stream"},
    )
    with client.stream(
        "POST",
        "/llm/chat/stream",
        json={
            "provider_id": pid,
            "model": "m",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers=AUTH,
    ) as resp:
        assert resp.status_code == 200
        body = b"".join(resp.iter_bytes()).decode()
    assert '"delta":"Hi"' in body
