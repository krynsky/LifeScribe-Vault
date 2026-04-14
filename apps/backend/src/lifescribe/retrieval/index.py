from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .chunker import Chunk

_SCHEMA_VERSION = "1"


@dataclass(frozen=True)
class SearchResult:
    note_id: str
    chunk_id: str
    note_type: str
    tags: list[str]
    imported_at: str
    content: str
    score: float
    snippet: str


class FTSIndex:
    class VaultMismatch(Exception):
        pass

    def __init__(self, conn: sqlite3.Connection, *, path: Path) -> None:
        self._conn = conn
        self._path = path
        self._write_lock = threading.Lock()

    @classmethod
    def open(cls, path: Path, *, vault_id: str) -> FTSIndex:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        cls._ensure_schema(conn)
        stored_id = cls._get_meta(conn, "vault_id")
        if stored_id is None:
            cls._set_meta(conn, "vault_id", vault_id)
        elif stored_id != vault_id:
            conn.close()
            raise cls.VaultMismatch(
                f"index at {path} belongs to vault {stored_id}, not {vault_id}"
            )
        return cls(conn, path=path)

    @staticmethod
    def _ensure_schema(conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
              note_id     UNINDEXED,
              chunk_id    UNINDEXED,
              note_type   UNINDEXED,
              tags        UNINDEXED,
              imported_at UNINDEXED,
              content,
              tokenize = 'porter unicode61'
            );
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT
            );
            CREATE TABLE IF NOT EXISTS note_index (
              note_id     TEXT PRIMARY KEY,
              note_mtime  REAL NOT NULL,
              chunk_count INTEGER NOT NULL
            );
            """
        )
        cur = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'")
        row = cur.fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO meta(key, value) VALUES (?, ?)",
                ("schema_version", _SCHEMA_VERSION),
            )
        conn.commit()

    @staticmethod
    def _get_meta(conn: sqlite3.Connection, key: str) -> str | None:
        row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return None if row is None else str(row["value"])

    @staticmethod
    def _set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
        conn.execute(
            "INSERT INTO meta(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        conn.commit()

    def close(self) -> None:
        self._conn.close()

    def upsert_note(
        self,
        *,
        note_id: str,
        note_type: str,
        tags: list[str],
        imported_at: str,
        chunks: list[Chunk],
        mtime: float = 0.0,
    ) -> None:
        tags_joined = ",".join(tags)
        with self._write_lock:
            self._conn.execute("DELETE FROM chunks WHERE note_id = ?", (note_id,))
            self._conn.executemany(
                "INSERT INTO chunks(note_id, chunk_id, note_type, tags, imported_at, content)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (note_id, c.chunk_id, note_type, tags_joined, imported_at, c.content)
                    for c in chunks
                ],
            )
            self._conn.execute(
                "INSERT INTO note_index(note_id, note_mtime, chunk_count)"
                " VALUES (?, ?, ?) "
                " ON CONFLICT(note_id) DO UPDATE SET"
                "   note_mtime = excluded.note_mtime,"
                "   chunk_count = excluded.chunk_count",
                (note_id, mtime, len(chunks)),
            )
            self._set_meta(self._conn, "last_indexed_at", datetime.now(tz=UTC).isoformat())
            self._conn.commit()

    def delete_note(self, note_id: str) -> None:
        with self._write_lock:
            self._conn.execute("DELETE FROM chunks WHERE note_id = ?", (note_id,))
            self._conn.execute("DELETE FROM note_index WHERE note_id = ?", (note_id,))
            self._conn.commit()

    def get_note_mtime(self, note_id: str) -> float | None:
        row = self._conn.execute(
            "SELECT note_mtime FROM note_index WHERE note_id = ?", (note_id,)
        ).fetchone()
        return None if row is None else float(row["note_mtime"])

    def search(self, query: str, *, k: int) -> list[SearchResult]:
        if not query.strip():
            return []
        # FTS5 MATCH syntax: escape double quotes; wrap phrase-ish queries
        safe = query.replace('"', '""')
        sql = (
            "SELECT note_id, chunk_id, note_type, tags, imported_at, content,"
            "       bm25(chunks) AS score,"
            "       snippet(chunks, 5, '<b>', '</b>', '...', 12) AS snippet"
            " FROM chunks WHERE chunks MATCH ? ORDER BY score LIMIT ?"
        )
        rows = self._conn.execute(sql, (f'"{safe}"', k)).fetchall()
        return [
            SearchResult(
                note_id=r["note_id"],
                chunk_id=r["chunk_id"],
                note_type=r["note_type"],
                tags=[t for t in (r["tags"] or "").split(",") if t],
                imported_at=r["imported_at"] or "",
                content=r["content"],
                score=float(r["score"]),
                snippet=r["snippet"] or "",
            )
            for r in rows
        ]

    def status(self) -> dict[str, Any]:
        note_count = self._conn.execute("SELECT COUNT(*) AS c FROM note_index").fetchone()["c"]
        chunk_count = self._conn.execute("SELECT COUNT(*) AS c FROM chunks").fetchone()["c"]
        last_indexed_at = self._get_meta(self._conn, "last_indexed_at") or ""
        size = self._path.stat().st_size if self._path.exists() else 0
        return {
            "note_count": int(note_count),
            "chunk_count": int(chunk_count),
            "last_indexed_at": last_indexed_at,
            "db_size_bytes": size,
        }

    def all_note_mtimes(self) -> dict[str, float]:
        rows = self._conn.execute("SELECT note_id, note_mtime FROM note_index").fetchall()
        return {r["note_id"]: float(r["note_mtime"]) for r in rows}
