from __future__ import annotations

from dataclasses import dataclass

from lifescribe.llm.openai_compatible import OpenAICompatibleClient
from lifescribe.vault.schemas import LLMProvider


@dataclass
class GitHubModelsProvider:
    client: OpenAICompatibleClient

    @classmethod
    def from_note(cls, note: LLMProvider, *, token: str | None) -> GitHubModelsProvider:
        return cls(
            client=OpenAICompatibleClient(
                base_url=note.base_url,
                token=token,
                local=False,
                requires_token=True,
                provider_id=note.id,
            )
        )
