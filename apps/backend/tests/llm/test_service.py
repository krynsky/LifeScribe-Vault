from __future__ import annotations

import pytest
from pytest_httpx import HTTPXMock

from lifescribe.llm.base import ChatMessage, ChatRequest, PrivacyViolation
from lifescribe.llm.service import LLMService
from lifescribe.vault.schemas import LLMProvider, VaultSettings
from lifescribe.vault.store import VaultStore


def _settings_write(store: VaultStore, privacy: bool) -> None:
    store.write_note(
        VaultSettings(id="settings_default", type="VaultSettings", privacy_mode=privacy),
        body="",
        commit_message="s",
    )


def _note(provider_id: str, base_url: str, local: bool) -> LLMProvider:
    return LLMProvider(
        id=provider_id,
        type="LLMProvider",
        display_name=provider_id,
        base_url=base_url,
        local=local,
    )


async def test_fast_fail_blocks_remote_when_privacy_on(tmp_path) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="t")
    store.write_note(
        _note("llm_gh", "https://models.inference.ai.azure.com", local=False),
        body="",
        commit_message="add",
    )
    _settings_write(store, privacy=True)
    svc = LLMService(store)
    req = ChatRequest(
        provider_id="llm_gh",
        model="m",
        messages=[ChatMessage(role="user", content="hi")],
    )
    with pytest.raises(PrivacyViolation) as exc:
        async for _ in svc.stream_chat(req):
            pass
    assert exc.value.code == "remote_provider_disabled"


async def test_privacy_off_allows_remote(tmp_path, httpx_mock: HTTPXMock) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="t")
    store.write_note(
        _note("llm_local", "http://127.0.0.1:1234/v1", local=True),
        body="",
        commit_message="add",
    )
    _settings_write(store, privacy=False)
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        content=b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
        headers={"content-type": "text/event-stream"},
    )
    svc = LLMService(store)
    req = ChatRequest(
        provider_id="llm_local",
        model="m",
        messages=[ChatMessage(role="user", content="hi")],
    )
    chunks = [c async for c in svc.stream_chat(req)]
    assert chunks[0].delta == "hi"


async def test_chat_concatenates_stream(tmp_path, httpx_mock: HTTPXMock) -> None:
    store = VaultStore.init(tmp_path / "v", app_version="t")
    store.write_note(
        _note("llm_local", "http://127.0.0.1:1234/v1", local=True),
        body="",
        commit_message="add",
    )
    _settings_write(store, privacy=False)
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        content=(
            b'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
            b'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n'
            b"data: [DONE]\n\n"
        ),
        headers={"content-type": "text/event-stream"},
    )
    svc = LLMService(store)
    req = ChatRequest(
        provider_id="llm_local",
        model="m",
        messages=[ChatMessage(role="user", content="hi")],
    )
    result = await svc.chat(req)
    assert result.content == "Hello"
    assert result.finish_reason == "stop"
