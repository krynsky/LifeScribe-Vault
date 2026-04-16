from __future__ import annotations

from fastapi.testclient import TestClient


def _auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def test_list_sessions_empty(client: TestClient) -> None:
    r = client.get("/chat/sessions", headers=_auth())
    assert r.status_code == 200
    assert r.json() == []


def test_get_missing_session_404(client: TestClient) -> None:
    r = client.get("/chat/sessions/chat_nope", headers=_auth())
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "session_not_found"


def test_delete_missing_session_404(client: TestClient) -> None:
    r = client.delete("/chat/sessions/chat_nope", headers=_auth())
    assert r.status_code == 404
