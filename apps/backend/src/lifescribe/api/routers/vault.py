from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict

from lifescribe import __version__
from lifescribe.api.routers.chat import set_wiring as _chat_set_wiring
from lifescribe.api.routers.llm import set_vault_store as _llm_set_store
from lifescribe.api.routers.retrieval import set_index as _retrieval_set_index
from lifescribe.chat.orchestrator import ChatOrchestrator
from lifescribe.chat.sessions import SessionStore
from lifescribe.llm.service import LLMService
from lifescribe.retrieval.index import FTSIndex
from lifescribe.retrieval.indexer import Indexer
from lifescribe.vault.errors import (
    SchemaTooNewError,
    VaultAlreadyInitializedError,
    VaultNotFoundError,
)
from lifescribe.vault.schemas import VaultSettings
from lifescribe.vault.store import VaultStore

router = APIRouter(prefix="/vault", tags=["vault"])


class _State:
    store: VaultStore | None = None


class _InitRequest(BaseModel):
    path: str


class _OpenRequest(BaseModel):
    path: str


def _wire_chat_stack(store: VaultStore) -> None:
    """Build and register the retrieval/chat stack for an opened vault."""
    index = FTSIndex.open(
        store.root / ".lifescribe" / "fts.db",
        vault_id=store.manifest.id,
    )
    indexer = Indexer(vault=store, index=index)
    indexer.reindex_stale()
    sessions = SessionStore(vault=store)
    orchestrator = ChatOrchestrator(
        sessions=sessions,
        index=index,
        indexer=indexer,
        llm=LLMService(store=store),
    )
    _retrieval_set_index(index)
    _chat_set_wiring(
        sessions=sessions,
        orchestrator=orchestrator,
        index=index,
        indexer=indexer,
    )


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
    _llm_set_store(store)
    _wire_chat_stack(store)
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
    _llm_set_store(store)
    _wire_chat_stack(store)
    return {"open": True, "manifest": _manifest_dict(store)}


_ALLOWED_NOTE_TYPES = {
    "SourceRecord",
    "DocumentRecord",
    "ConnectorRecord",
    "IngestionLogEntry",
    "IngestJobLog",
    "VaultManifest",
    "VaultSettings",
}


def _require_store() -> VaultStore:
    if _State.store is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "vault not open")
    return _State.store


@router.get("/notes")
def list_notes(type: str) -> list[dict[str, Any]]:
    if type not in _ALLOWED_NOTE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown type: {type}")
    store = _require_store()
    return [n.model_dump(mode="json") for n in store.list_notes(type_=type)]


@router.get("/notes/{note_id}")
def get_note(note_id: str) -> dict[str, Any]:
    store = _require_store()
    try:
        note, body = store.read_note(note_id)
    except KeyError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    return {"note": note.model_dump(mode="json"), "body": body}


_SETTINGS_ID = "settings_default"


class _SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    privacy_mode: bool


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    store = _require_store()
    try:
        note, _ = store.read_note(_SETTINGS_ID)
    except KeyError:
        return VaultSettings(id=_SETTINGS_ID, type="VaultSettings").model_dump(mode="json")
    assert isinstance(note, VaultSettings)
    return note.model_dump(mode="json")


@router.put("/settings")
def put_settings(req: _SettingsUpdate) -> dict[str, Any]:
    store = _require_store()
    note = VaultSettings(
        id=_SETTINGS_ID,
        type="VaultSettings",
        privacy_mode=req.privacy_mode,
    )
    store.write_note(note, body="", commit_message="settings: update")
    return note.model_dump(mode="json")
