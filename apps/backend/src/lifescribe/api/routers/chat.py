from __future__ import annotations

import json
import threading
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from lifescribe.chat.orchestrator import ChatEvent, ChatOrchestrator, ChatSendRequest
from lifescribe.chat.sessions import SessionStore
from lifescribe.llm.base import LLMError
from lifescribe.retrieval.index import FTSIndex
from lifescribe.retrieval.indexer import Indexer
from lifescribe.vault.schemas import ChatSession

router = APIRouter(prefix="/chat", tags=["chat"])


class _State:
    sessions: SessionStore | None = None
    orchestrator: ChatOrchestrator | None = None
    index: FTSIndex | None = None
    indexer: Indexer | None = None


def set_wiring(
    *,
    sessions: SessionStore | None,
    orchestrator: ChatOrchestrator | None,
    index: FTSIndex | None,
    indexer: Indexer | None,
) -> None:
    _State.sessions = sessions
    _State.orchestrator = orchestrator
    _State.index = index
    _State.indexer = indexer


def _require_sessions() -> SessionStore:
    if _State.sessions is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "vault_not_open"})
    return _State.sessions


def _envelope(session: ChatSession) -> dict[str, Any]:
    return {
        "id": session.id,
        "title": session.title,
        "provider_id": session.provider_id,
        "model": session.model,
        "turn_count": len(session.turns),
        "created_at": (session.turns[0].created_at.isoformat() if session.turns else None),
        "updated_at": (session.turns[-1].created_at.isoformat() if session.turns else None),
    }


@router.get("/sessions")
def list_sessions() -> list[dict[str, Any]]:
    store = _require_sessions()
    return [_envelope(s) for s in store.list()]


@router.get("/sessions/{session_id}")
def get_session(session_id: str) -> dict[str, Any]:
    store = _require_sessions()
    try:
        session = store.read(session_id)
    except KeyError as err:
        raise HTTPException(404, {"code": "session_not_found", "message": session_id}) from err
    return session.model_dump(mode="json")


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str) -> None:
    store = _require_sessions()
    try:
        store.read(session_id)
    except KeyError as err:
        raise HTTPException(404, {"code": "session_not_found", "message": session_id}) from err
    store.delete(session_id)


def _require_orchestrator() -> ChatOrchestrator:
    if _State.orchestrator is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "vault_not_open"})
    return _State.orchestrator


class _ChatSendBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str | None = None
    message: str
    provider_id: str
    model: str


async def _encode_events(gen: AsyncIterator[ChatEvent]) -> AsyncIterator[bytes]:
    try:
        async for ev in gen:
            payload = json.dumps(ev.data, default=str, separators=(",", ":"))
            yield f"event: {ev.event}\ndata: {payload}\n\n".encode()
    except LLMError as exc:
        payload = json.dumps(
            {"code": getattr(exc, "code", "llm_error"), "message": str(exc)},
            default=str,
            separators=(",", ":"),
        )
        yield f"event: error\ndata: {payload}\n\n".encode()


_reindex_lock = threading.Lock()


def _require_indexer() -> Indexer:
    if _State.indexer is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "vault_not_open"})
    return _State.indexer


def _require_index() -> FTSIndex:
    if _State.index is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "vault_not_open"})
    return _State.index


@router.post("/reindex")
def reindex() -> dict[str, Any]:
    indexer = _require_indexer()
    _require_index()
    if not _reindex_lock.acquire(blocking=False):
        raise HTTPException(
            409, {"code": "reindex_in_progress", "message": "rebuild already running"}
        )
    try:
        started = time.monotonic()
        indexed = indexer.reindex_all()
        elapsed_ms = int((time.monotonic() - started) * 1000)
        return {
            "indexed_notes": indexed,
            "elapsed_ms": elapsed_ms,
            "last_indexed_at": datetime.now(tz=UTC).isoformat(),
        }
    finally:
        _reindex_lock.release()


@router.get("/index/status")
def index_status() -> dict[str, Any]:
    index = _require_index()
    indexer = _require_indexer()
    st = index.status()
    return {**st, "stale_notes": indexer.count_stale()}


@router.post("/send")
async def chat_send(body: _ChatSendBody) -> StreamingResponse:
    orch = _require_orchestrator()
    req = ChatSendRequest(
        session_id=body.session_id,
        message=body.message,
        provider_id=body.provider_id,
        model=body.model,
    )
    return StreamingResponse(_encode_events(orch.send(req)), media_type="text/event-stream")
