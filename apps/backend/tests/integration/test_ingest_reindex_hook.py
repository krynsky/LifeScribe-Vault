from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient


def _auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def test_ingest_completion_indexes_new_notes(client: TestClient, tmp_path: Path) -> None:
    # Put the source file in a subdir so it doesn't collide with the vault
    # (the `client` fixture initialises the vault at tmp_path directly).
    src_dir = tmp_path / "sources"
    src_dir.mkdir()
    src = src_dir / "hello.txt"
    src.write_text("quarterly planning lives here", encoding="utf-8")

    r = client.post("/ingest/jobs", json={"files": [str(src)]}, headers=_auth())
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]

    for _ in range(40):
        r = client.get(f"/ingest/jobs/{job_id}", headers=_auth())
        if r.json()["status"] == "completed":
            break
        time.sleep(0.05)

    r = client.post(
        "/retrieval/search",
        json={"query": "quarterly", "k": 3},
        headers=_auth(),
    )
    assert r.status_code == 200, r.text
    assert r.json()["chunks"]
