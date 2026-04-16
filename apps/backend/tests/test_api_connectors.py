from __future__ import annotations

HEADERS = {"Authorization": "Bearer test-token"}


def test_get_connectors_lists_file_drop(client) -> None:
    r = client.get("/connectors", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert "entries" in body and "warnings" in body
    services = [e["service"] for e in body["entries"]]
    assert "file_drop" in services
    entry = next(e for e in body["entries"] if e["service"] == "file_drop")
    assert entry["blocked"] is False
    assert entry["privacy_posture"] == "local_only"


def test_get_connectors_precomputes_blocked_when_privacy_on(client) -> None:
    r = client.put("/vault/settings", json={"privacy_mode": True}, headers=HEADERS)
    assert r.status_code == 200, r.text
    r = client.get("/connectors", headers=HEADERS)
    body = r.json()
    # file_drop is local_only → still unblocked
    entry = next(e for e in body["entries"] if e["service"] == "file_drop")
    assert entry["blocked"] is False


def test_get_connector_sample_returns_file(client) -> None:
    r = client.get("/connectors/file_drop/samples/example.txt", headers=HEADERS)
    assert r.status_code == 200
    assert b"sample" in r.content.lower()


def test_get_connector_sample_rejects_traversal(client) -> None:
    r = client.get("/connectors/file_drop/samples/..%2Fmanifest.toml", headers=HEADERS)
    assert r.status_code == 404


def test_get_connector_sample_unknown_service_404(client) -> None:
    r = client.get("/connectors/does_not_exist/samples/foo.txt", headers=HEADERS)
    assert r.status_code == 404
