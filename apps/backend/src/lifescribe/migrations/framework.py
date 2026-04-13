from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from lifescribe.vault.schemas import MigrationRecord, VaultManifest
from lifescribe.vault.serialization import dump_note
from lifescribe.vault.store import (
    APP_GIT_AUTHOR_EMAIL,
    APP_GIT_AUTHOR_NAME,
    VaultStore,
)


class Migration(Protocol):
    from_version: int
    to_version: int

    @classmethod
    def apply(cls, store: VaultStore) -> None: ...


@dataclass
class MigrationReport:
    applied: list[tuple[int, int]] = field(default_factory=list)


def apply_migrations(
    store: VaultStore,
    *,
    migrations: list[type[Migration]],
    target_version: int,
) -> MigrationReport:
    report = MigrationReport()
    current = store.manifest.schema_version
    if current >= target_version:
        return report

    ordered = sorted(migrations, key=lambda m: m.from_version)
    for mig in ordered:
        if mig.from_version < current:
            continue
        if mig.from_version >= target_version:
            break
        mig.apply(store)
        current = mig.to_version
        report.applied.append((mig.from_version, mig.to_version))

        now = datetime.now(UTC)
        updated_manifest = VaultManifest(
            id=store.manifest.id,
            type="VaultManifest",
            schema_version=mig.to_version,
            app_version=store.app_version,
            created_at=store.manifest.created_at,
            migrations=[
                *store.manifest.migrations,
                MigrationRecord.model_validate(
                    {"from": mig.from_version, "to": mig.to_version, "applied_at": now}
                ),
            ],
        )
        manifest_path = store.root / "system" / "vault.md"
        manifest_path.write_text(dump_note(updated_manifest, body=""), encoding="utf-8")
        store.manifest = updated_manifest
        store._repo.add(["system/vault.md"])
        store._repo.commit(
            f"migrate: v{mig.from_version} -> v{mig.to_version}",
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )

    return report
