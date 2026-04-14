from __future__ import annotations

import pytest
from pytest_httpx import HTTPXMock

from lifescribe.llm.base import (
    ChatMessage,
    ChatRequest,
    CredentialMissing,
    PrivacyViolation,
    UpstreamError,
    UpstreamTimeout,
)
from lifescribe.llm.openai_compatible import OpenAICompatibleClient


@pytest.fixture
def client() -> OpenAICompatibleClient:
    return OpenAICompatibleClient(
        base_url="http://127.0.0.1:1234/v1",
        token=None,
        local=True,
    )


async def test_list_models_parses_response(httpx_mock: HTTPXMock, client) -> None:
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/models",
        json={"data": [{"id": "llama-3"}, {"id": "qwen-2"}]},
    )
    models = await client.list_models(privacy_mode=False)
    assert [m.id for m in models] == ["llama-3", "qwen-2"]


async def test_list_models_parses_bare_array_response(httpx_mock: HTTPXMock, client) -> None:
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/models",
        json=[{"id": "gpt-4o-mini"}, {"id": "phi-3"}],
    )
    models = await client.list_models(privacy_mode=False)
    assert [m.id for m in models] == ["gpt-4o-mini", "phi-3"]


async def test_privacy_blocks_remote_base_url(httpx_mock: HTTPXMock) -> None:
    client = OpenAICompatibleClient(base_url="https://api.github.com/v1", token="t", local=False)
    with pytest.raises(PrivacyViolation):
        await client.list_models(privacy_mode=True)


async def test_non_streaming_chat_returns_full_content(httpx_mock: HTTPXMock, client) -> None:
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        json={
            "choices": [
                {
                    "message": {"role": "assistant", "content": "hello world"},
                    "finish_reason": "stop",
                }
            ]
        },
    )
    req = ChatRequest(
        provider_id="x",
        model="m",
        messages=[ChatMessage(role="user", content="hi")],
    )
    result = await client.chat(req, privacy_mode=False)
    assert result.content == "hello world"
    assert result.finish_reason == "stop"


async def test_upstream_401_raises_upstream_error(httpx_mock: HTTPXMock, client) -> None:
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/models", status_code=401, json={"error": "nope"}
    )
    with pytest.raises(UpstreamError) as exc:
        await client.list_models(privacy_mode=False)
    assert exc.value.status == 401
    assert exc.value.code == "upstream_401"


async def test_upstream_timeout_raised(httpx_mock: HTTPXMock, client) -> None:
    import httpx

    httpx_mock.add_exception(httpx.ReadTimeout("slow"))
    with pytest.raises(UpstreamTimeout):
        await client.list_models(privacy_mode=False)


async def test_missing_token_raises_credential_missing() -> None:
    client = OpenAICompatibleClient(
        base_url="http://127.0.0.1:1234/v1", token=None, local=True, requires_token=True
    )
    with pytest.raises(CredentialMissing):
        await client.list_models(privacy_mode=False)


async def test_stream_chat_yields_chunks_and_terminates_on_done(
    httpx_mock: HTTPXMock, client
) -> None:
    body = (
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
        'data: {"choices":[{"delta":{"content":"lo."},"finish_reason":null}]}\n\n'
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
        "data: [DONE]\n\n"
    )
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        content=body.encode("utf-8"),
        headers={"content-type": "text/event-stream"},
    )
    req = ChatRequest(
        provider_id="x",
        model="m",
        messages=[ChatMessage(role="user", content="hi")],
    )
    chunks = [c async for c in client.stream_chat(req, privacy_mode=False)]
    assert [c.delta for c in chunks] == ["Hel", "lo.", ""]
    assert chunks[-1].finish_reason == "stop"


async def test_stream_chat_skips_malformed_sse_lines(httpx_mock: HTTPXMock, client) -> None:
    body = (
        "garbage line\n\n"
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
        "data: {not json}\n\n"
        "data: [DONE]\n\n"
    )
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        content=body.encode("utf-8"),
        headers={"content-type": "text/event-stream"},
    )
    req = ChatRequest(
        provider_id="x",
        model="m",
        messages=[ChatMessage(role="user", content="hi")],
    )
    chunks = [c async for c in client.stream_chat(req, privacy_mode=False)]
    assert [c.delta for c in chunks] == ["ok"]


async def test_stream_chat_upstream_error_before_first_chunk(httpx_mock: HTTPXMock, client) -> None:
    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        status_code=502,
        text="bad gw",
    )
    req = ChatRequest(
        provider_id="x",
        model="m",
        messages=[ChatMessage(role="user", content="hi")],
    )
    with pytest.raises(UpstreamError) as exc:
        async for _ in client.stream_chat(req, privacy_mode=False):
            pass
    assert exc.value.status == 502
