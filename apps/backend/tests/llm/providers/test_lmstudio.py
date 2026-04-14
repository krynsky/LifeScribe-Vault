from __future__ import annotations

from lifescribe.llm.providers.lmstudio import LMStudioProvider


def test_build_client_from_note() -> None:
    from lifescribe.vault.schemas import LLMProvider

    note = LLMProvider(
        id="llm_lmstudio_default",
        type="LLMProvider",
        display_name="LM Studio",
        base_url="http://127.0.0.1:1234/v1",
        local=True,
    )
    provider = LMStudioProvider.from_note(note, token=None)
    client = provider.client
    assert client.base_url == "http://127.0.0.1:1234/v1"
    assert client.requires_token is False
    assert client.token is None
    assert client.local is True
