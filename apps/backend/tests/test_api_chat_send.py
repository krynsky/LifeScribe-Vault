from __future__ import annotations

import json

from fastapi.testclient import TestClient


def _auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for frame in text.split("\n\n"):
        if not frame.strip():
            continue
        event = "message"
        data_lines: list[str] = []
        for line in frame.splitlines():
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:") :].lstrip())
        if data_lines:
            events.append((event, json.loads("\n".join(data_lines))))
    return events


def test_chat_send_empty_vault_returns_no_context(client_with_stub_llm: TestClient) -> None:
    r = client_with_stub_llm.post(
        "/chat/send",
        json={"session_id": None, "message": "anything", "provider_id": "p", "model": "m"},
        headers=_auth(),
    )
    assert r.status_code == 200
    events = _parse_sse(r.text)
    names = [e[0] for e in events]
    assert "no_context" in names
    assert names[-1] == "done"


def test_chat_send_happy_path(client_with_stub_llm_and_seeded_index: TestClient) -> None:
    r = client_with_stub_llm_and_seeded_index.post(
        "/chat/send",
        json={"session_id": None, "message": "planning", "provider_id": "p", "model": "m"},
        headers=_auth(),
    )
    assert r.status_code == 200
    events = _parse_sse(r.text)
    names = [e[0] for e in events]
    assert names[0] == "session"
    assert "retrieval" in names
    assert "chunk" in names
    assert "citations" in names
    assert names[-1] == "done"
