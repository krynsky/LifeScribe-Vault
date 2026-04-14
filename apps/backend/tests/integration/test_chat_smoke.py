from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for frame in text.split("\n\n"):
        if not frame.strip():
            continue
        event = "message"
        data_lines = []
        for line in frame.splitlines():
            if line.startswith("event:"):
                event = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:"):].lstrip())
        if data_lines:
            events.append((event, json.loads("\n".join(data_lines))))
    return events


def test_end_to_end_chat_with_vault(
    client_with_stub_llm_and_seeded_index: TestClient,
) -> None:
    client = client_with_stub_llm_and_seeded_index
    r = client.post(
        "/chat/send",
        json={"session_id": None, "message": "what about planning?",
              "provider_id": "p", "model": "m"},
        headers=_auth(),
    )
    assert r.status_code == 200
    events = _parse_sse(r.text)
    session_event = next(e for e in events if e[0] == "session")
    sid = session_event[1]["session_id"]

    r = client.get("/chat/sessions", headers=_auth())
    assert r.status_code == 200
    assert any(s["id"] == sid for s in r.json())

    r = client.get(f"/chat/sessions/{sid}", headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert body["title"]
    assert body["turns"][0]["role"] == "user"
    assert body["turns"][-1]["role"] == "assistant"

    r = client.delete(f"/chat/sessions/{sid}", headers=_auth())
    assert r.status_code == 204
    r = client.get(f"/chat/sessions/{sid}", headers=_auth())
    assert r.status_code == 404


def test_empty_vault_returns_no_context(client_with_stub_llm: TestClient) -> None:
    r = client_with_stub_llm.post(
        "/chat/send",
        json={"session_id": None, "message": "anything",
              "provider_id": "p", "model": "m"},
        headers=_auth(),
    )
    events = _parse_sse(r.text)
    assert any(e[0] == "no_context" for e in events)
