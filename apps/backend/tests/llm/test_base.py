from __future__ import annotations

from lifescribe.llm.base import (
    ChatChunk,
    ChatMessage,
    ChatRequest,
    CredentialMissing,
    LLMError,
    ModelInfo,
    PrivacyViolation,
    ProviderNotFound,
    UpstreamError,
    UpstreamTimeout,
)


def test_chat_request_roundtrip() -> None:
    req = ChatRequest(
        provider_id="llm_a",
        model="m",
        messages=[ChatMessage(role="user", content="hi")],
    )
    d = req.model_dump()
    assert d["messages"][0]["role"] == "user"


def test_chat_chunk_default_finish_reason_none() -> None:
    assert ChatChunk(delta="hi").finish_reason is None


def test_model_info_minimal() -> None:
    m = ModelInfo(id="gpt-4o")
    assert m.context_length is None


def test_error_hierarchy_codes() -> None:
    assert issubclass(PrivacyViolation, LLMError)
    assert issubclass(ProviderNotFound, LLMError)
    assert issubclass(CredentialMissing, LLMError)
    assert issubclass(UpstreamError, LLMError)
    assert issubclass(UpstreamTimeout, LLMError)
    e = UpstreamError(502, "bad gateway", body="...")
    assert e.code == "upstream_502"
    assert UpstreamTimeout().code == "upstream_timeout"
    assert CredentialMissing("llm_x").code == "credential_missing"
    assert ProviderNotFound("llm_x").code == "provider_not_found"
