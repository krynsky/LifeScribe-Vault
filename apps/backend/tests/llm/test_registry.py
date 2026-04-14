from __future__ import annotations

import pytest

from lifescribe.llm.base import CredentialMissing, ProviderNotFound
from lifescribe.llm.openai_compatible import OpenAICompatibleClient
from lifescribe.llm.registry import ProviderRegistry
from lifescribe.llm.secrets import SecretStore
from lifescribe.vault.schemas import LLMProvider
from lifescribe.vault.store import VaultStore


def _mk_store(tmp_path):
    return VaultStore.init(tmp_path / "v", app_version="test")


def test_get_note_404_when_missing(tmp_path) -> None:
    reg = ProviderRegistry(_mk_store(tmp_path), SecretStore())
    with pytest.raises(ProviderNotFound):
        reg.get_note("llm_missing")


def test_lmstudio_instantiated_without_token(tmp_path) -> None:
    store = _mk_store(tmp_path)
    note = LLMProvider(
        id="llm_lmstudio_default",
        type="LLMProvider",
        display_name="LM Studio",
        base_url="http://127.0.0.1:1234/v1",
        local=True,
    )
    store.write_note(note, body="", commit_message="add")
    reg = ProviderRegistry(store, SecretStore())
    client = reg.instantiate("llm_lmstudio_default")
    assert isinstance(client, OpenAICompatibleClient)
    assert client.token is None


def test_github_models_requires_credential(tmp_path) -> None:
    store = _mk_store(tmp_path)
    note = LLMProvider(
        id="llm_github_default",
        type="LLMProvider",
        display_name="GH",
        base_url="https://models.inference.ai.azure.com",
        local=False,
        secret_ref="llm.llm_github_default.token",
        adapter="openai_compatible",
    )
    store.write_note(note, body="", commit_message="add")
    reg = ProviderRegistry(store, SecretStore())
    with pytest.raises(CredentialMissing):
        reg.instantiate("llm_github_default")


def test_credential_resolved_from_secret_ref(tmp_path) -> None:
    store = _mk_store(tmp_path)
    note = LLMProvider(
        id="llm_github_default",
        type="LLMProvider",
        display_name="GH",
        base_url="https://models.inference.ai.azure.com",
        local=False,
        secret_ref="llm.llm_github_default.token",
    )
    store.write_note(note, body="", commit_message="add")
    secrets = SecretStore()
    secrets.set("llm.llm_github_default.token", "pat_xyz")
    reg = ProviderRegistry(store, secrets)
    client = reg.instantiate("llm_github_default")
    assert client.token == "pat_xyz"
