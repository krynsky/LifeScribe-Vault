from __future__ import annotations

from fastapi.testclient import TestClient


def _auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def test_retrieval_search_returns_chunks(client: TestClient, seeded_index) -> None:
    r = client.post(
        "/retrieval/search",
        json={"query": "quarterly", "k": 3},
        headers=_auth(),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["chunks"]
    assert body["chunks"][0]["note_id"]
    assert "index_last_updated_at" in body


def test_retrieval_search_empty_query(client: TestClient, seeded_index) -> None:
    r = client.post(
        "/retrieval/search",
        json={"query": "", "k": 3},
        headers=_auth(),
    )
    assert r.status_code == 200
    assert r.json()["chunks"] == []


def test_retrieval_requires_open_vault(unopened_client: TestClient) -> None:
    r = unopened_client.post(
        "/retrieval/search",
        json={"query": "x", "k": 3},
        headers=_auth(),
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "vault_not_open"
