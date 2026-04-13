from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from lifescribe.vault.errors import (
    SchemaTooNewError,
    VaultAlreadyInitializedError,
    VaultNotFoundError,
)
from lifescribe.vault.gitwrap import GitRepo
from lifescribe.vault.schemas import VaultManifest
from lifescribe.vault.serialization import dump_note, load_note

SCHEMA_VERSION = 1
APP_GIT_AUTHOR_NAME = "LifeScribe Vault"
APP_GIT_AUTHOR_EMAIL = "noreply@lifescribe.local"

_RESERVED_FOLDERS = [
    "00_inbox",
    "20_entities",
    "30_events",
    "40_domains",
    "50_summaries",
    "60_publish",
]
_ACTIVE_FOLDERS = [
    "10_sources",
    "assets",
    "system",
    "system/connectors",
    "system/logs/ingestion",
    "system/migrations",
]

_GITIGNORE = """.obsidian/workspace*
"""
_GITATTRIBUTES = """* text=auto eol=lf
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.pdf binary
*.zip binary
"""

_RESERVED_README = """# Reserved folder

This folder is reserved for a future sub-project. It will be populated
once the associated feature ships. See the top-level overview spec for
the v1 / v2 scope split.
"""


@dataclass
class VaultStore:
    root: Path
    manifest: VaultManifest
    app_version: str
    _repo: GitRepo

    @classmethod
    def init(cls, root: Path, *, app_version: str) -> VaultStore:
        root = Path(root)
        root.mkdir(parents=True, exist_ok=True)
        if (root / "system" / "vault.md").exists():
            raise VaultAlreadyInitializedError(f"Vault already exists at {root}")

        for folder in _ACTIVE_FOLDERS + _RESERVED_FOLDERS:
            (root / folder).mkdir(parents=True, exist_ok=True)
        for folder in _RESERVED_FOLDERS:
            (root / folder / "README.md").write_text(_RESERVED_README, encoding="utf-8")

        (root / ".gitignore").write_text(_GITIGNORE, encoding="utf-8")
        (root / ".gitattributes").write_text(_GITATTRIBUTES, encoding="utf-8")

        manifest = VaultManifest(
            id=f"vault_{uuid.uuid4()}",
            type="VaultManifest",
            schema_version=SCHEMA_VERSION,
            app_version=app_version,
            created_at=datetime.now(UTC),
            migrations=[],
        )
        (root / "system" / "vault.md").write_text(
            dump_note(manifest, body=""), encoding="utf-8"
        )

        repo = GitRepo.init(root, initial_branch="main")
        repo.add(["."])
        repo.commit(
            "chore: initialize vault",
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )
        return cls(root=root, manifest=manifest, app_version=app_version, _repo=repo)

    @classmethod
    def open(cls, root: Path, *, app_version: str) -> VaultStore:
        root = Path(root)
        manifest_path = root / "system" / "vault.md"
        if not manifest_path.exists():
            raise VaultNotFoundError(f"No VaultManifest at {manifest_path}")
        note, _body = load_note(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(note, VaultManifest):
            raise VaultNotFoundError("system/vault.md is not a VaultManifest")
        if note.schema_version > SCHEMA_VERSION:
            raise SchemaTooNewError(
                f"Vault schema v{note.schema_version} exceeds app max v{SCHEMA_VERSION}"
            )
        repo = GitRepo.open(root)
        return cls(root=root, manifest=note, app_version=app_version, _repo=repo)
