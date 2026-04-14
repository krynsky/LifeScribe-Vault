from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lifescribe.api.app import create_app


@pytest.fixture
def tmp_vault(tmp_path: Path) -> Iterator[Path]:
    """Provide a fresh, empty directory suitable for vault init."""
    vault_dir = tmp_path / "vault"
    vault_dir.mkdir()
    yield vault_dir


@pytest.fixture
def client(tmp_path) -> TestClient:
    app = create_app(auth_token="test-token")
    c = TestClient(app)
    r = c.post(
        "/vault/init",
        json={"path": str(tmp_path)},
        headers={"Authorization": "Bearer test-token"},
    )
    assert r.status_code == 200, r.text
    return c


@pytest.fixture
def unopened_client() -> TestClient:
    from lifescribe.api.routers import chat as chat_router
    from lifescribe.api.routers import retrieval as retrieval_router
    # Clear any state left by a prior test so the vault is truly un-opened.
    retrieval_router.set_index(None)
    chat_router.set_wiring(sessions=None, orchestrator=None, index=None, indexer=None)
    return TestClient(create_app(auth_token="test-token"))


@pytest.fixture
def seeded_index(client):
    from lifescribe.api.routers.retrieval import _State
    idx = _State.index
    assert idx is not None
    from lifescribe.retrieval.chunker import Chunk
    idx.upsert_note(
        note_id="doc_a", note_type="DocumentRecord", tags=["planning"],
        imported_at="2026-04-14T00:00:00Z",
        chunks=[Chunk(note_id="doc_a", chunk_id="c1",
                      content="quarterly planning notes",
                      start_offset=0, end_offset=26)],
    )
    return idx


@pytest.fixture
def client_with_stub_llm(client):
    from lifescribe.api.routers.chat import _State

    class _StubLLM:
        async def stream_chat(self, req):
            from lifescribe.llm.base import ChatChunk
            yield ChatChunk(delta="stub answer [1]", finish_reason=None)
            yield ChatChunk(delta="", finish_reason="stop")

    _State.orchestrator._llm = _StubLLM()
    return client


@pytest.fixture
def client_with_stub_llm_and_seeded_index(client_with_stub_llm, seeded_index):
    return client_with_stub_llm


@pytest.fixture
def client_with_busy_indexer(client):
    from lifescribe.api.routers.chat import _reindex_lock
    _reindex_lock.acquire()
    yield client
    _reindex_lock.release()


@pytest.fixture(autouse=True)
def _in_memory_keyring(monkeypatch, tmp_path):
    import keyring
    from keyrings.alt.file import PlaintextKeyring

    kr = PlaintextKeyring()
    kr.file_path = str(tmp_path / "test-keyring.cfg")  # type: ignore[attr-defined]
    monkeypatch.setattr(keyring, "get_keyring", lambda: kr)
    monkeypatch.setattr(keyring, "set_password", kr.set_password)
    monkeypatch.setattr(keyring, "get_password", kr.get_password)
    monkeypatch.setattr(keyring, "delete_password", kr.delete_password)
    yield
