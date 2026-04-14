from __future__ import annotations

from lifescribe.llm.providers.github_models import GitHubModelsProvider
from lifescribe.vault.schemas import LLMProvider


def test_requires_token_and_marks_non_local() -> None:
    note = LLMProvider(
        id="llm_github_default",
        type="LLMProvider",
        display_name="GitHub Models",
        base_url="https://models.inference.ai.azure.com",
        local=False,
        secret_ref="llm.llm_github_default.token",
    )
    provider = GitHubModelsProvider.from_note(note, token="pat_abc")
    assert provider.client.base_url == "https://models.inference.ai.azure.com"
    assert provider.client.requires_token is True
    assert provider.client.token == "pat_abc"
    assert provider.client.local is False
