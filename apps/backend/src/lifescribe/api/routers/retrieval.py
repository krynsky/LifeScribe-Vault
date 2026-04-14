from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict

from lifescribe.retrieval.index import FTSIndex

router = APIRouter(prefix="/retrieval", tags=["retrieval"])


class _State:
    index: FTSIndex | None = None


def set_index(index: FTSIndex | None) -> None:
    _State.index = index


def _require_index() -> FTSIndex:
    if _State.index is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "vault_not_open"})
    return _State.index


class _SearchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str
    k: int = 6


@router.post("/search")
def search(body: _SearchBody) -> dict[str, Any]:
    idx = _require_index()
    results = idx.search(body.query, k=body.k)
    status_ = idx.status()
    return {
        "chunks": [
            {
                "n": i + 1,
                "note_id": r.note_id,
                "chunk_id": r.chunk_id,
                "note_type": r.note_type,
                "score": r.score,
                "snippet": r.snippet,
                "tags": r.tags,
            }
            for i, r in enumerate(results)
        ],
        "index_last_updated_at": status_["last_indexed_at"],
    }
