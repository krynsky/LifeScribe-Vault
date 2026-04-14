from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from lifescribe.chat.orchestrator import ChatOrchestrator, ChatSendRequest
from lifescribe.chat.sessions import SessionStore
from lifescribe.llm.base import ChatChunk
from lifescribe.retrieval.chunker import Chunk
from lifescribe.retrieval.index import FTSIndex, SearchResult
from lifescribe.retrieval.indexer import Indexer
from lifescribe.vault.store import VaultStore


@pytest.fixture
def orch(tmp_path: Path):
    vault = VaultStore.init(tmp_path, app_version="test")
    idx = FTSIndex.open(tmp_path / ".lifescribe" / "fts.db", vault_id=vault.manifest.id)
    indexer = Indexer(vault=vault, index=idx)
    sessions = SessionStore(vault=vault)
    llm = MagicMock()
    orch = ChatOrchestrator(sessions=sessions, index=idx, indexer=indexer, llm=llm)
    yield orch, idx, llm, vault, sessions
    idx.close()


async def _collect(gen) -> list[tuple[str, dict]]:
    out = []
    async for ev in gen:
        out.append((ev.event, ev.data))
    return out


@pytest.mark.asyncio
async def test_empty_retrieval_short_circuits(orch):
    o, idx, llm, _, sessions = orch
    req = ChatSendRequest(session_id=None, message="anything", provider_id="p", model="m")
    events = await _collect(o.send(req))
    names = [e[0] for e in events]
    assert names == ["session", "no_context", "done"]
    llm.stream_chat.assert_not_called()
    sid = events[0][1]["session_id"]
    persisted = sessions.read(sid)
    assert persisted.turns[0].empty_retrieval is True


@pytest.mark.asyncio
async def test_happy_path_streams_and_persists(orch, monkeypatch):
    o, idx, llm, vault, sessions = orch
    idx.upsert_note(
        note_id="doc_a", note_type="DocumentRecord", tags=[], imported_at="",
        chunks=[Chunk(note_id="doc_a", chunk_id="cc", content="quarterly plans", start_offset=0, end_offset=14)],
    )

    async def fake_stream(req) -> AsyncIterator[ChatChunk]:
        yield ChatChunk(delta="According to [1] the ", finish_reason=None)
        yield ChatChunk(delta="plan is clear.", finish_reason=None)
        yield ChatChunk(delta="", finish_reason="stop")

    llm.stream_chat = fake_stream

    req = ChatSendRequest(session_id=None, message="quarterly plans", provider_id="p", model="m")
    events = await _collect(o.send(req))
    names = [e[0] for e in events]
    assert names[0] == "session"
    assert names[1] == "retrieval"
    assert "chunk" in names
    assert names[-2] == "citations"
    assert names[-1] == "done"

    citations = next(e for e in events if e[0] == "citations")[1]["citations"]
    assert citations[0]["marker"] == 1
    assert citations[0]["note_id"] == "doc_a"
    assert citations[0]["resolved"] is True

    sid = events[0][1]["session_id"]
    persisted = sessions.read(sid)
    assert len(persisted.turns) == 2
    assert persisted.turns[1].citations[0].resolved


@pytest.mark.asyncio
async def test_unresolved_citation_flagged(orch):
    o, idx, llm, _, _ = orch
    idx.upsert_note(
        note_id="doc_a", note_type="DocumentRecord", tags=[], imported_at="",
        chunks=[Chunk(note_id="doc_a", chunk_id="cc", content="hello", start_offset=0, end_offset=5)],
    )

    async def fake_stream(req):
        yield ChatChunk(delta="answer with [9]", finish_reason=None)
        yield ChatChunk(delta="", finish_reason="stop")

    llm.stream_chat = fake_stream
    events = await _collect(
        o.send(ChatSendRequest(session_id=None, message="hello", provider_id="p", model="m"))
    )
    citations = next(e for e in events if e[0] == "citations")[1]["citations"]
    assert citations == [
        {"marker": 9, "note_id": "", "chunk_id": "", "score": 0.0, "resolved": False}
    ]


@pytest.mark.asyncio
async def test_history_cap_10_turns(orch):
    o, idx, llm, _, sessions = orch
    idx.upsert_note(
        note_id="doc_a", note_type="DocumentRecord", tags=[], imported_at="",
        chunks=[Chunk(note_id="doc_a", chunk_id="cc", content="topic", start_offset=0, end_offset=5)],
    )
    from lifescribe.vault.schemas import ChatTurn
    first = ChatTurn(role="user", content="seed", created_at=datetime.now(tz=UTC))
    session = sessions.create(title="t", provider_id="p", model="m", first_turn=first)
    for i in range(11):
        sessions.append_turn_pair(
            session_id=session.id,
            user=ChatTurn(role="user", content=f"u{i}", created_at=datetime.now(tz=UTC)) if i % 2 else None,
            assistant=ChatTurn(role="assistant", content=f"a{i}", created_at=datetime.now(tz=UTC)),
        )

    captured = {}

    async def fake_stream(req):
        captured["messages"] = req.messages
        yield ChatChunk(delta="[1]", finish_reason=None)
        yield ChatChunk(delta="", finish_reason="stop")

    llm.stream_chat = fake_stream
    await _collect(
        o.send(ChatSendRequest(session_id=session.id, message="topic", provider_id="p", model="m"))
    )
    assert len(captured["messages"]) == 12
    assert captured["messages"][0].role == "system"
    assert captured["messages"][-1].role == "user"
