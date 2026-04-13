from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import ClassVar

from lifescribe.migrations.framework import apply_migrations
from lifescribe.vault.ids import compose_id, content_short_hash, sanitize_slug
from lifescribe.vault.schemas import SourceRecord, VaultManifest
from lifescribe.vault.serialization import load_note
from lifescribe.vault.store import VaultStore


def _ts() -> datetime:
    return datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC)


class SyntheticV2Migration:
    from_version = 1
    to_version = 2

    called_with: ClassVar[list[VaultStore]] = []

    @classmethod
    def apply(cls, store: VaultStore) -> None:
        cls.called_with.append(store)
        marker = store.root / "system" / "migrated-to-v2.marker"
        marker.write_text("ok", encoding="utf-8")
        store._repo.add(["system/migrated-to-v2.marker"])


def test_foundation_end_to_end(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()

    store = VaultStore.init(vault, app_version="0.1.0")
    assert store.manifest.schema_version == 1

    content = b"Hello, world.\n"
    short = content_short_hash(content)
    slug = sanitize_slug("Hello World")
    note_id = compose_id(type_prefix="src", slug=slug, short_hash=short)
    rec = SourceRecord(
        id=note_id,
        type="SourceRecord",
        schema_version=1,
        source_path="/tmp/hello.txt",
        source_hash=f"sha256:fake-{short}",
        source_mtime=_ts(),
        imported_at=_ts(),
        imported_by_job="job_2026-04-12_001",
        extractor="e2e@0.0.1",
        extractor_confidence=1.0,
        privacy="private",
        links={"parent_source": None, "derived_from": []},
        tags=[],
        mime_type="text/plain",
        original_filename="hello.txt",
        size_bytes=len(content),
    )

    asset_src = tmp_path / "hello.txt"
    asset_src.write_bytes(content)
    store.write_asset(asset_src, canonical_name=f"hello-{short}.txt")
    store.write_note(rec, body="Hello, world.", commit_message=f"ingest: {rec.id}")

    loaded, body = store.read_note(rec.id)
    assert loaded == rec
    assert body == "Hello, world."

    pre_log = store._repo.log_oneline()
    store.write_note(
        rec, body="Hello, world. redux.", commit_message="ingest: updated content"
    )
    post_log = store._repo.log_oneline()
    assert len(post_log) == len(pre_log) + 1

    note_path = vault / "10_sources" / f"{rec.id}.md"
    note_path.write_text(
        note_path.read_text(encoding="utf-8") + "\n<!-- hand -->\n", encoding="utf-8"
    )
    result = store.write_note(rec, body="Hello, world.", commit_message="ingest: should conflict")
    assert result.conflict is True
    assert result.path.name.startswith(f"{rec.id}.conflict-")

    report = apply_migrations(store, migrations=[SyntheticV2Migration], target_version=2)
    assert report.applied == [(1, 2)]
    manifest_note, _ = load_note((vault / "system" / "vault.md").read_text(encoding="utf-8"))
    assert isinstance(manifest_note, VaultManifest)
    assert manifest_note.schema_version == 2
    assert (vault / "system" / "migrated-to-v2.marker").exists()
