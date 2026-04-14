from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest


@pytest.fixture
def tmp_vault(tmp_path: Path) -> Iterator[Path]:
    """Provide a fresh, empty directory suitable for vault init."""
    vault_dir = tmp_path / "vault"
    vault_dir.mkdir()
    yield vault_dir


@pytest.fixture(autouse=True)
def _in_memory_keyring(monkeypatch, tmp_path):
    import keyring
    from keyrings.alt.file import PlaintextKeyring

    kr = PlaintextKeyring()
    kr.file_path = str(tmp_path / "test-keyring.cfg")  # type: ignore[attr-defined]
    monkeypatch.setattr(keyring, "get_keyring", lambda: kr)
    monkeypatch.setattr(keyring, "set_password", kr.set_password)
    monkeypatch.setattr(keyring, "get_password", kr.get_password)
    monkeypatch.setattr(keyring, "delete_password", kr.delete_password)
    yield
