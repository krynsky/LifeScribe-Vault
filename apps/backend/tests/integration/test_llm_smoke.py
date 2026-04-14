from __future__ import annotations

from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock

from lifescribe.api.app import create_app

AUTH = {"Authorization": "Bearer t"}


def test_init_vault_then_full_llm_flow(tmp_path, httpx_mock: HTTPXMock) -> None:
    app = create_app(auth_token="t")
    client = TestClient(app)

    r = client.post("/vault/init", json={"path": str(tmp_path / "v")}, headers=AUTH)
    assert r.status_code == 200

    r = client.post(
        "/llm/providers",
        json={
            "display_name": "Local",
            "base_url": "http://127.0.0.1:1234/v1",
            "local": True,
        },
        headers=AUTH,
    )
    pid = r.json()["id"]

    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/models",
        json={"data": [{"id": "local-llm"}]},
    )
    r = client.get(f"/llm/providers/{pid}/models", headers=AUTH)
    assert [m["id"] for m in r.json()] == ["local-llm"]

    httpx_mock.add_response(
        url="http://127.0.0.1:1234/v1/chat/completions",
        content=(
            b'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n'
            b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
            b"data: [DONE]\n\n"
        ),
        headers={"content-type": "text/event-stream"},
    )
    r = client.post(
        "/llm/chat",
        json={
            "provider_id": pid,
            "model": "local-llm",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers=AUTH,
    )
    assert r.json()["content"] == "OK"
