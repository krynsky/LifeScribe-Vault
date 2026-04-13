from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.migrations.framework import Migration, MigrationReport, apply_migrations
from lifescribe.vault.schemas import VaultManifest
from lifescribe.vault.serialization import load_note
from lifescribe.vault.store import VaultStore


class FakeMigration:
    from_version = 1
    to_version = 2

    called_with: ClassVar[list[VaultStore]] = []

    @classmethod
    def apply(cls, store: VaultStore) -> None:
        cls.called_with.append(store)


def test_migration_runs_and_updates_manifest(tmp_vault: Path) -> None:
    FakeMigration.called_with.clear()
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    assert store.manifest.schema_version == 1
    report: MigrationReport = apply_migrations(
        store,
        migrations=[FakeMigration],
        target_version=2,
    )
    assert report.applied == [(1, 2)]
    manifest_note, _ = load_note((tmp_vault / "system" / "vault.md").read_text(encoding="utf-8"))
    assert isinstance(manifest_note, VaultManifest)
    assert manifest_note.schema_version == 2
    assert len(manifest_note.migrations) == 1


def test_no_op_when_already_at_target(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    report = apply_migrations(store, migrations=[FakeMigration], target_version=1)
    assert report.applied == []


def test_migration_protocol_compile_time(tmp_vault: Path) -> None:
    m: Migration = FakeMigration  # type: ignore[assignment]
    assert m.from_version == 1
