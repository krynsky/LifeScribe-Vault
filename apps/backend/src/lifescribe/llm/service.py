from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

from lifescribe.llm.base import (
    ChatChunk,
    ChatRequest,
    ModelInfo,
    PrivacyViolation,
)
from lifescribe.llm.openai_compatible import ChatResult
from lifescribe.llm.registry import ProviderRegistry
from lifescribe.llm.secrets import SecretStore
from lifescribe.vault.schemas import VaultSettings
from lifescribe.vault.store import VaultStore


@dataclass
class LLMService:
    store: VaultStore

    def _settings(self) -> VaultSettings:
        try:
            note, _ = self.store.read_note("settings_default")
        except KeyError:
            return VaultSettings(id="settings_default", type="VaultSettings")
        assert isinstance(note, VaultSettings)
        return note

    def _registry(self) -> ProviderRegistry:
        return ProviderRegistry(self.store, SecretStore())

    async def list_models(self, provider_id: str) -> list[ModelInfo]:
        settings = self._settings()
        registry = self._registry()
        note = registry.get_note(provider_id)
        if settings.privacy_mode and not note.local:
            raise PrivacyViolation("remote_provider_disabled")
        client = registry.instantiate(provider_id)
        return await client.list_models(privacy_mode=settings.privacy_mode)

    async def stream_chat(self, req: ChatRequest) -> AsyncIterator[ChatChunk]:
        settings = self._settings()
        registry = self._registry()
        note = registry.get_note(req.provider_id)
        if settings.privacy_mode and not note.local:
            raise PrivacyViolation("remote_provider_disabled")
        client = registry.instantiate(req.provider_id)
        async for chunk in client.stream_chat(req, privacy_mode=settings.privacy_mode):
            yield chunk

    async def chat(self, req: ChatRequest) -> ChatResult:
        pieces: list[str] = []
        finish_reason: str | None = None
        async for chunk in self.stream_chat(req):
            pieces.append(chunk.delta)
            if chunk.finish_reason is not None:
                finish_reason = chunk.finish_reason
        return ChatResult(content="".join(pieces), finish_reason=finish_reason)
