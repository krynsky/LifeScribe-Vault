from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status

from lifescribe.chat.orchestrator import ChatOrchestrator
from lifescribe.chat.sessions import SessionStore
from lifescribe.retrieval.index import FTSIndex
from lifescribe.retrieval.indexer import Indexer

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


def _envelope(session) -> dict[str, Any]:
    return {
        "id": session.id,
        "title": session.title,
        "provider_id": session.provider_id,
        "model": session.model,
        "turn_count": len(session.turns),
        "created_at": (session.turns[0].created_at.isoformat()
                       if session.turns else None),
        "updated_at": (session.turns[-1].created_at.isoformat()
                       if session.turns else None),
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
        raise HTTPException(
            404, {"code": "session_not_found", "message": session_id}
        ) from err
    return session.model_dump(mode="json")


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str) -> None:
    store = _require_sessions()
    try:
        store.read(session_id)
    except KeyError as err:
        raise HTTPException(
            404, {"code": "session_not_found", "message": session_id}
        ) from err
    store.delete(session_id)
