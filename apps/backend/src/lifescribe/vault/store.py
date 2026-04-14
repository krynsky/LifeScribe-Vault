from __future__ import annotations

import os
import tempfile
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from lifescribe.migrations.framework import MigrationReport

from lifescribe.vault.errors import (
    SchemaTooNewError,
    VaultAlreadyInitializedError,
    VaultNotFoundError,
)
from lifescribe.vault.gitwrap import GitRepo
from lifescribe.vault.schemas import (
    ChatSession,
    ConnectorRecord,
    DocumentRecord,
    IngestionLogEntry,
    IngestJobLog,
    LLMProvider,
    Note,
    SourceRecord,
    VaultManifest,
    VaultSettings,
)
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
    "system/providers",
]

_GITIGNORE = """.obsidian/workspace*
.lifescribe/
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
class WriteResult:
    path: Path
    conflict: bool
    committed: bool


@dataclass
class AssetRef:
    path: Path


def _relative_path_for(note: Note, root: Path) -> Path:
    if isinstance(note, SourceRecord):
        return root / "10_sources" / f"{note.id}.md"
    if isinstance(note, DocumentRecord):
        return root / "10_sources" / note.parent_source / f"{note.id}.md"
    if isinstance(note, ConnectorRecord):
        return root / "system" / "connectors" / f"{note.id}.md"
    if isinstance(note, IngestionLogEntry):
        year_month = note.started_at.strftime("%Y-%m")
        return root / "system" / "logs" / "ingestion" / year_month / f"{note.id}.md"
    if isinstance(note, IngestJobLog):
        year_month = note.started_at.strftime("%Y-%m")
        return root / "system" / "logs" / "ingestion" / year_month / f"{note.id}.md"
    if isinstance(note, LLMProvider):
        return root / "system" / "providers" / f"{note.id}.md"
    if isinstance(note, ChatSession):
        return root / "70_chats" / f"{note.id}.md"
    if isinstance(note, VaultSettings):
        return root / "system" / f"{note.id}.md"
    if isinstance(note, VaultManifest):
        return root / "system" / "vault.md"
    raise TypeError(f"Unknown note type: {type(note).__name__}")


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        delete=False,
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    ) as tmp:
        tmp.write(text)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_name = tmp.name
    os.replace(tmp_name, path)


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
        (root / "system" / "vault.md").write_text(dump_note(manifest, body=""), encoding="utf-8")

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

    def write_note(
        self,
        note: Note,
        *,
        body: str = "",
        commit_message: str,
    ) -> WriteResult:
        target = _relative_path_for(note, self.root)
        rel = target.relative_to(self.root).as_posix()
        text = dump_note(note, body=body)

        if target.exists() and self._repo.is_modified(rel):
            stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            conflict_path = target.with_name(f"{target.stem}.conflict-{stamp}{target.suffix}")
            _atomic_write(conflict_path, text)
            self._repo.add([conflict_path.relative_to(self.root).as_posix()])
            self._repo.commit(
                f"conflict: {note.id} hand-edited; wrote {conflict_path.name}",
                author_name=APP_GIT_AUTHOR_NAME,
                author_email=APP_GIT_AUTHOR_EMAIL,
            )
            return WriteResult(path=conflict_path, conflict=True, committed=True)

        _atomic_write(target, text)
        self._repo.add([rel])
        self._repo.commit(
            commit_message,
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )
        return WriteResult(path=target, conflict=False, committed=True)

    def read_note(self, note_id: str) -> tuple[Note, str]:
        for md in self.root.rglob("*.md"):
            if md.stem == note_id:
                return load_note(md.read_text(encoding="utf-8"))
        raise KeyError(f"No note with id {note_id!r} found in vault")

    def exists(self, note_id: str) -> bool:
        return any(md.stem == note_id for md in self.root.rglob("*.md"))

    def write_batch(
        self,
        items: list[tuple[Note, str]],
        *,
        commit_message: str,
        extra_paths: list[str] | None = None,
    ) -> list[WriteResult]:
        if not items and not extra_paths:
            return []
        results: list[WriteResult] = []
        staged: list[str] = list(extra_paths or [])
        for note, body in items:
            target = _relative_path_for(note, self.root)
            rel = target.relative_to(self.root).as_posix()
            if target.exists() and self._repo.is_modified(rel):
                stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
                conflict_path = target.with_name(f"{target.stem}.conflict-{stamp}{target.suffix}")
                _atomic_write(conflict_path, dump_note(note, body=body))
                staged.append(conflict_path.relative_to(self.root).as_posix())
                results.append(WriteResult(path=conflict_path, conflict=True, committed=False))
            else:
                _atomic_write(target, dump_note(note, body=body))
                staged.append(rel)
                results.append(WriteResult(path=target, conflict=False, committed=False))
        self._repo.add(staged)
        self._repo.commit(
            commit_message,
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )
        return [WriteResult(path=r.path, conflict=r.conflict, committed=True) for r in results]

    def write_asset(self, src: Path, *, canonical_name: str | None = None) -> AssetRef:
        name = canonical_name or src.name
        dest = self.root / "assets" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(Path(src).read_bytes())
        return AssetRef(path=dest)

    def list_notes(self, *, type_: str | None = None) -> Iterator[Note]:
        for md in self.root.rglob("*.md"):
            if md.name == "README.md":
                continue
            try:
                note, _ = load_note(md.read_text(encoding="utf-8"))
            except Exception:
                continue
            if type_ is None or note.type == type_:
                yield note

    def path_for(self, note_id: str) -> Path | None:
        """Return the absolute filesystem path for the note with the given id.

        Returns None if the note cannot be found in the vault.
        """
        try:
            note, _ = self.read_note(note_id)
        except KeyError:
            return None
        return _relative_path_for(note, self.root)

    def delete_note(self, note_id: str, *, commit_message: str) -> None:
        """Delete a note file and commit the deletion."""
        target = self.path_for(note_id)
        if target is None:
            raise KeyError(note_id)
        if target.exists():
            target.unlink()
        rel = target.relative_to(self.root).as_posix()
        self._repo.add([rel])
        self._repo.commit(
            commit_message,
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )

    def migrate(self, target_version: int) -> MigrationReport:
        from lifescribe.migrations.framework import apply_migrations

        return apply_migrations(self, migrations=[], target_version=target_version)

    def is_hand_edited(self, note_id: str) -> bool:
        for md in self.root.rglob("*.md"):
            if md.stem == note_id:
                return self._repo.is_modified(md.relative_to(self.root).as_posix())
        return False
