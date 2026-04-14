from __future__ import annotations

from dataclasses import dataclass

from lifescribe.llm.base import CredentialMissing, ProviderNotFound
from lifescribe.llm.openai_compatible import OpenAICompatibleClient
from lifescribe.llm.secrets import SecretStore
from lifescribe.vault.schemas import LLMProvider
from lifescribe.vault.store import VaultStore


@dataclass
class ProviderRegistry:
    store: VaultStore
    secrets: SecretStore

    def get_note(self, provider_id: str) -> LLMProvider:
        try:
            note, _body = self.store.read_note(provider_id)
        except KeyError as exc:
            raise ProviderNotFound(provider_id) from exc
        if not isinstance(note, LLMProvider):
            raise ProviderNotFound(provider_id)
        return note

    def instantiate(self, provider_id: str) -> OpenAICompatibleClient:
        note = self.get_note(provider_id)
        token: str | None = None
        if note.secret_ref:
            token = self.secrets.get(note.secret_ref)
        requires_token = not note.local
        if requires_token and not token:
            raise CredentialMissing(provider_id)
        return OpenAICompatibleClient(
            base_url=note.base_url,
            token=token,
            local=note.local,
            requires_token=requires_token,
            provider_id=note.id,
        )
