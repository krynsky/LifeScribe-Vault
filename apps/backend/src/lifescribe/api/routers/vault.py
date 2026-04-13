from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from lifescribe import __version__
from lifescribe.vault.errors import (
    SchemaTooNewError,
    VaultAlreadyInitializedError,
    VaultNotFoundError,
)
from lifescribe.vault.store import VaultStore

router = APIRouter(prefix="/vault", tags=["vault"])


class _State:
    store: VaultStore | None = None


class _InitRequest(BaseModel):
    path: str


class _OpenRequest(BaseModel):
    path: str


def _manifest_dict(store: VaultStore) -> dict[str, Any]:
    return store.manifest.model_dump(mode="json")


@router.get("/status")
def status_endpoint() -> dict[str, Any]:
    if _State.store is None:
        return {"open": False, "manifest": None}
    return {"open": True, "manifest": _manifest_dict(_State.store)}


@router.post("/init")
def init_endpoint(req: _InitRequest) -> dict[str, Any]:
    try:
        store = VaultStore.init(Path(req.path), app_version=__version__)
    except VaultAlreadyInitializedError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    _State.store = store
    return {"open": True, "manifest": _manifest_dict(store)}


@router.post("/open")
def open_endpoint(req: _OpenRequest) -> dict[str, Any]:
    try:
        store = VaultStore.open(Path(req.path), app_version=__version__)
    except VaultNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except SchemaTooNewError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    _State.store = store
    return {"open": True, "manifest": _manifest_dict(store)}
