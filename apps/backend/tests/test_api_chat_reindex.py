from __future__ import annotations

from fastapi.testclient import TestClient


def _auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def test_reindex_runs(client: TestClient) -> None:
    r = client.post("/chat/reindex", headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert "indexed_notes" in body
    assert "elapsed_ms" in body
    assert "last_indexed_at" in body


def test_index_status(client: TestClient) -> None:
    r = client.get("/chat/index/status", headers=_auth())
    assert r.status_code == 200
    body = r.json()
    for key in ("last_indexed_at", "note_count", "chunk_count",
                "db_size_bytes", "stale_notes"):
        assert key in body


def test_reindex_concurrency_returns_409(client_with_busy_indexer: TestClient) -> None:
    r = client_with_busy_indexer.post("/chat/reindex", headers=_auth())
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "reindex_in_progress"
