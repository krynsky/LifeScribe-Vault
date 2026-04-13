from __future__ import annotations

from pathlib import Path

import pytest

from lifescribe.vault.errors import (
    SchemaTooNewError,
    VaultAlreadyInitializedError,
    VaultNotFoundError,
)
from lifescribe.vault.store import SCHEMA_VERSION, VaultStore

EXPECTED_FOLDERS = [
    "00_inbox",
    "10_sources",
    "20_entities",
    "30_events",
    "40_domains",
    "50_summaries",
    "60_publish",
    "assets",
    "system",
    "system/connectors",
    "system/logs/ingestion",
    "system/migrations",
]


def test_init_creates_all_folders(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    for folder in EXPECTED_FOLDERS:
        assert (tmp_vault / folder).is_dir(), f"missing {folder}"
    assert (tmp_vault / "system" / "vault.md").is_file()
    assert store.manifest.schema_version == SCHEMA_VERSION


def test_init_writes_gitignore_and_gitattributes(tmp_vault: Path) -> None:
    VaultStore.init(tmp_vault, app_version="0.1.0")
    assert (tmp_vault / ".gitignore").is_file()
    assert (tmp_vault / ".gitattributes").is_file()
    assert (tmp_vault / ".git").is_dir()


def test_init_commits_initial_state(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    log = store._repo.log_oneline()
    assert len(log) == 1
    assert "chore: initialize vault" in log[0]


def test_init_rejects_existing_vault(tmp_vault: Path) -> None:
    VaultStore.init(tmp_vault, app_version="0.1.0")
    with pytest.raises(VaultAlreadyInitializedError):
        VaultStore.init(tmp_vault, app_version="0.1.0")


def test_open_loads_manifest(tmp_vault: Path) -> None:
    VaultStore.init(tmp_vault, app_version="0.1.0")
    store = VaultStore.open(tmp_vault, app_version="0.1.0")
    assert store.manifest.schema_version == SCHEMA_VERSION


def test_open_missing_vault_errors(tmp_vault: Path) -> None:
    with pytest.raises(VaultNotFoundError):
        VaultStore.open(tmp_vault, app_version="0.1.0")


def test_open_rejects_newer_schema(tmp_vault: Path) -> None:
    VaultStore.init(tmp_vault, app_version="0.1.0")
    manifest_path = tmp_vault / "system" / "vault.md"
    text = manifest_path.read_text(encoding="utf-8")
    text = text.replace("schema_version: 1", "schema_version: 99")
    manifest_path.write_text(text, encoding="utf-8")
    with pytest.raises(SchemaTooNewError):
        VaultStore.open(tmp_vault, app_version="0.1.0")
