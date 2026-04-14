from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    provider_id: str
    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    max_tokens: int | None = None


class ChatChunk(BaseModel):
    delta: str
    finish_reason: str | None = None


class ModelInfo(BaseModel):
    id: str
    context_length: int | None = None


class LLMError(Exception):
    code: str = "llm_error"


class PrivacyViolation(LLMError):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


class ProviderNotFound(LLMError):
    code = "provider_not_found"

    def __init__(self, provider_id: str) -> None:
        super().__init__(f"provider not found: {provider_id}")


class CredentialMissing(LLMError):
    code = "credential_missing"

    def __init__(self, provider_id: str) -> None:
        super().__init__(f"credential missing for provider: {provider_id}")


class UpstreamError(LLMError):
    def __init__(self, status: int, message: str, *, body: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.body = body
        self.code = f"upstream_{status}" if status > 0 else "upstream_network"


class UpstreamTimeout(LLMError):
    code = "upstream_timeout"

    def __init__(self, message: str = "upstream timeout") -> None:
        super().__init__(message)
