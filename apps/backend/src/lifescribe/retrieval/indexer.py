from __future__ import annotations

from lifescribe.vault.schemas import (
    ChatSession,
    DocumentRecord,
    SourceRecord,
)
from lifescribe.vault.store import VaultStore

from .chunker import Chunk, chunk_text
from .index import FTSIndex

_INDEXED_TYPES = {"DocumentRecord", "SourceRecord", "ChatSession"}


class Indexer:
    def __init__(self, *, vault: VaultStore, index: FTSIndex) -> None:
        self._vault = vault
        self._index = index

    def reindex_notes(self, note_ids: list[str]) -> int:
        count = 0
        for note_id in note_ids:
            if self._reindex_one(note_id):
                count += 1
        return count

    def count_stale(self) -> int:
        known = self._index.all_note_mtimes()
        stale = 0
        seen: set[str] = set()
        for note_id, path in self._iter_indexable():
            seen.add(note_id)
            if known.get(note_id) != path.stat().st_mtime:
                stale += 1
        stale += len(set(known) - seen)
        return stale

    def reindex_stale(self) -> int:
        known = self._index.all_note_mtimes()
        touched = 0
        seen: set[str] = set()
        for note_id, path in self._iter_indexable():
            seen.add(note_id)
            mtime = path.stat().st_mtime
            if known.get(note_id) != mtime:
                if self._reindex_one(note_id):
                    touched += 1
        for gone in set(known) - seen:
            self._index.delete_note(gone)
            touched += 1
        return touched

    def reindex_all(self) -> int:
        for note_id in list(self._index.all_note_mtimes()):
            self._index.delete_note(note_id)
        touched = 0
        for note_id, _ in self._iter_indexable():
            if self._reindex_one(note_id):
                touched += 1
        return touched

    def _iter_indexable(self):
        for note in self._vault.list_notes():
            if note.type not in _INDEXED_TYPES:
                continue
            path = self._vault.path_for(note.id)
            if path is None or not path.exists():
                continue
            yield note.id, path

    def _reindex_one(self, note_id: str) -> bool:
        try:
            note, body = self._vault.read_note(note_id)
        except KeyError:
            self._index.delete_note(note_id)
            return True
        if note.type not in _INDEXED_TYPES:
            return False
        path = self._vault.path_for(note_id)
        mtime = path.stat().st_mtime if path and path.exists() else 0.0
        tags = list(getattr(note, "tags", []) or [])
        imported_at = getattr(note, "imported_at", "") or ""
        chunks = self._build_chunks(note, body)
        self._index.upsert_note(
            note_id=note_id,
            note_type=note.type,
            tags=tags,
            imported_at=str(imported_at),
            chunks=chunks,
            mtime=mtime,
        )
        return True

    def _build_chunks(self, note, body: str) -> list[Chunk]:
        if isinstance(note, DocumentRecord):
            return chunk_text(body, note_id=note.id)
        if isinstance(note, SourceRecord):
            # Index the extracted body content (if present) plus metadata.
            metadata = (
                f"{note.source_path} imported {note.imported_at} "
                f"tags {','.join(note.tags or [])}"
            )
            text = f"{metadata}\n\n{body}".strip() if body else metadata
            return chunk_text(text, note_id=note.id)
        if isinstance(note, ChatSession):
            combined = "\n\n".join(
                f"{turn.role}: {turn.content}" for turn in note.turns
            )
            return chunk_text(combined, note_id=note.id)
        return []
