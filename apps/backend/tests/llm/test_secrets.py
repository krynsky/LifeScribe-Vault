from __future__ import annotations

import pytest

from lifescribe.llm.secrets import SecretStore


def test_set_get_roundtrip() -> None:
    s = SecretStore()
    s.set("llm.foo.token", "pat_abc123")
    assert s.get("llm.foo.token") == "pat_abc123"


def test_get_missing_returns_none() -> None:
    assert SecretStore().get("llm.missing.token") is None


def test_delete_is_idempotent() -> None:
    s = SecretStore()
    s.set("llm.foo.token", "v")
    s.delete("llm.foo.token")
    s.delete("llm.foo.token")
    assert s.get("llm.foo.token") is None


def test_empty_ref_rejected() -> None:
    with pytest.raises(ValueError):
        SecretStore().get("")
