from __future__ import annotations

import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from lifescribe.llm.base import ChatMessage, ChatRequest
from lifescribe.llm.service import LLMService
from lifescribe.retrieval.index import FTSIndex, SearchResult
from lifescribe.retrieval.indexer import Indexer
from lifescribe.vault.schemas import ChatCitation, ChatTurn

from .prompt import build_system_prompt
from .sessions import SessionStore, auto_title, _render_body

_BM25_CUTOFF = 0.0  # FTS5 bm25() scores are negative; keep any match (score < 0)
_TOP_K = 6
_HISTORY_CAP = 10
_CITE_RE = re.compile(r"\[(\d+)\]")


class ChatSendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str | None
    message: str
    provider_id: str
    model: str


@dataclass(frozen=True)
class ChatEvent:
    event: str
    data: dict[str, Any]


class ChatOrchestrator:
    def __init__(self, *, sessions, index, indexer, llm) -> None:
        self._sessions = sessions
        self._index = index
        self._indexer = indexer
        self._llm = llm

    async def send(self, req: ChatSendRequest) -> AsyncIterator[ChatEvent]:
        now = datetime.now(tz=UTC)
        user_turn = ChatTurn(role="user", content=req.message, created_at=now)

        if req.session_id is None:
            session = self._sessions.create(
                title=auto_title(req.message) or "new chat",
                provider_id=req.provider_id, model=req.model, first_turn=user_turn,
            )
            created_new = True
        else:
            session = self._sessions.read(req.session_id)
            created_new = False

        yield ChatEvent("session", {"session_id": session.id, "title": session.title})

        chunks = self._retrieve(req.message)
        if not chunks:
            if not created_new:
                self._sessions.append_turn_pair(
                    session_id=session.id,
                    user=ChatTurn(role="user", content=req.message, created_at=now, empty_retrieval=True),
                    assistant=ChatTurn(role="assistant", content="", created_at=now, empty_retrieval=True),
                )
            else:
                # Update the first turn (already persisted) to have empty_retrieval=True,
                # then append the empty assistant turn.
                # We re-read the session fresh, patch turns[0], write it back, then append.
                fresh = self._sessions.read(session.id)
                fresh.turns[0] = ChatTurn(
                    role="user", content=req.message, created_at=now, empty_retrieval=True
                )
                self._sessions._vault.write_note(
                    fresh,
                    body=_render_body(fresh.turns),
                    commit_message=f"chat: session {fresh.id} mark empty retrieval",
                )
                self._sessions.append_turn_pair(
                    session_id=session.id,
                    assistant=ChatTurn(role="assistant", content="", created_at=now, empty_retrieval=True),
                )
            yield ChatEvent("no_context", {"message": "No relevant notes found in your vault."})
            yield ChatEvent("done", {"finish_reason": "no_context"})
            return

        yield ChatEvent("retrieval", {
            "chunks": [
                {"n": i + 1, "note_id": c.note_id, "chunk_id": c.chunk_id, "note_type": c.note_type,
                 "score": c.score, "snippet": c.snippet, "tags": c.tags}
                for i, c in enumerate(chunks)
            ]
        })

        system_prompt = build_system_prompt(chunks)
        history_turns = [] if created_new else list(session.turns)
        capped = history_turns[-_HISTORY_CAP:]
        messages = [ChatMessage(role="system", content=system_prompt)]
        for t in capped:
            messages.append(ChatMessage(role=t.role, content=t.content))
        messages.append(ChatMessage(role="user", content=req.message))

        chat_req = ChatRequest(provider_id=req.provider_id, model=req.model, messages=messages)

        accumulated = ""
        finish_reason = None
        async for chunk in self._llm.stream_chat(chat_req):
            if chunk.delta:
                accumulated += chunk.delta
                yield ChatEvent("chunk", {"delta": chunk.delta, "finish_reason": chunk.finish_reason})
            if chunk.finish_reason is not None:
                finish_reason = chunk.finish_reason

        citations = self._validate_citations(accumulated, chunks)
        yield ChatEvent("citations", {"citations": [c.model_dump() for c in citations]})

        assistant_turn = ChatTurn(
            role="assistant", content=accumulated, created_at=datetime.now(tz=UTC), citations=citations
        )
        if created_new:
            self._sessions.append_turn_pair(session_id=session.id, assistant=assistant_turn)
        else:
            self._sessions.append_turn_pair(session_id=session.id, user=user_turn, assistant=assistant_turn)

        self._indexer.reindex_notes([session.id])

        yield ChatEvent("done", {"finish_reason": finish_reason})

    def _retrieve(self, query: str) -> list[SearchResult]:
        results = self._index.search(query, k=_TOP_K)
        return [r for r in results if r.score < _BM25_CUTOFF]

    def _validate_citations(self, text: str, chunks: list[SearchResult]) -> list[ChatCitation]:
        markers = sorted({int(m) for m in _CITE_RE.findall(text)})
        out = []
        for n in markers:
            if 1 <= n <= len(chunks):
                c = chunks[n - 1]
                out.append(ChatCitation(marker=n, note_id=c.note_id, chunk_id=c.chunk_id, score=c.score, resolved=True))
            else:
                out.append(ChatCitation(marker=n, note_id="", chunk_id="", score=0.0, resolved=False))
        return out
