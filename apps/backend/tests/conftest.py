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
