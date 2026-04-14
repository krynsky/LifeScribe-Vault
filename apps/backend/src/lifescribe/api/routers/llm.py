from __future__ import annotations

import json
import re
import secrets as _secrets
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from lifescribe.llm.base import (
    ChatRequest,
    CredentialMissing,
    LLMError,
    PrivacyViolation,
    ProviderNotFound,
    UpstreamError,
    UpstreamTimeout,
)
from lifescribe.llm.secrets import SecretStore
from lifescribe.llm.service import LLMService
from lifescribe.vault.schemas import LLMProvider
from lifescribe.vault.store import VaultStore

router = APIRouter(prefix="/llm", tags=["llm"])


class _State:
    store: VaultStore | None = None


def set_vault_store(store: VaultStore | None) -> None:
    _State.store = store


def _require_store() -> VaultStore:
    if _State.store is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "vault_not_open"})
    return _State.store


def _error(exc: LLMError) -> HTTPException:
    if isinstance(exc, PrivacyViolation):
        return HTTPException(403, {"code": exc.code, "message": str(exc)})
    if isinstance(exc, ProviderNotFound):
        return HTTPException(404, {"code": exc.code, "message": str(exc)})
    if isinstance(exc, CredentialMissing):
        return HTTPException(400, {"code": exc.code, "message": str(exc)})
    if isinstance(exc, UpstreamTimeout):
        return HTTPException(504, {"code": exc.code, "message": str(exc)})
    if isinstance(exc, UpstreamError):
        return HTTPException(502, {"code": exc.code, "message": str(exc)})
    return HTTPException(500, {"code": "llm_error", "message": str(exc)})


def _envelope(note: LLMProvider) -> dict[str, Any]:
    data = note.model_dump(mode="json")
    has_cred = False
    if note.secret_ref:
        has_cred = SecretStore().get(note.secret_ref) is not None
    data["has_credential"] = has_cred
    return data


@router.get("/providers")
def list_providers() -> list[dict[str, Any]]:
    store = _require_store()
    return [_envelope(n) for n in store.list_notes(type_="LLMProvider")]  # type: ignore[arg-type]


@router.get("/providers/{provider_id}")
def get_provider(provider_id: str) -> dict[str, Any]:
    store = _require_store()
    try:
        note, _ = store.read_note(provider_id)
    except KeyError as err:
        raise HTTPException(404, {"code": "provider_not_found", "message": provider_id}) from err
    if not isinstance(note, LLMProvider):
        raise HTTPException(404, {"code": "provider_not_found", "message": provider_id})
    return _envelope(note)


class _ProviderBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str
    base_url: str
    local: bool
    adapter: str = "openai_compatible"
    secret_ref: str | None = None
    default_model: str | None = None
    enabled: bool = True


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    return s or "provider"


def _new_provider_id(display_name: str) -> str:
    return f"llm_{_slug(display_name)}_{_secrets.token_hex(3)}"


def _note_delete_path(store: VaultStore, note_id: str) -> None:
    target = Path(store.root) / "system" / "providers" / f"{note_id}.md"
    if target.exists():
        target.unlink()
    store._repo.add([str(target.relative_to(store.root).as_posix())])
    store._repo.commit(
        f"llm: delete provider {note_id}",
        author_name="LifeScribe Vault",
        author_email="noreply@lifescribe.local",
    )


@router.post("/providers", status_code=201)
def create_provider(body: _ProviderBody) -> dict[str, Any]:
    store = _require_store()
    pid = _new_provider_id(body.display_name)
    note = LLMProvider(
        id=pid,
        type="LLMProvider",
        adapter="openai_compatible",
        display_name=body.display_name,
        base_url=body.base_url,
        local=body.local,
        secret_ref=body.secret_ref,
        default_model=body.default_model,
        enabled=body.enabled,
    )
    store.write_note(note, body="", commit_message=f"llm: add provider {pid}")
    return _envelope(note)


@router.put("/providers/{provider_id}")
def update_provider(provider_id: str, body: _ProviderBody) -> dict[str, Any]:
    store = _require_store()
    try:
        existing, _ = store.read_note(provider_id)
    except KeyError as err:
        raise HTTPException(404, {"code": "provider_not_found", "message": provider_id}) from err
    if not isinstance(existing, LLMProvider):
        raise HTTPException(404, {"code": "provider_not_found", "message": provider_id})
    note = LLMProvider(
        id=provider_id,
        type="LLMProvider",
        adapter="openai_compatible",
        display_name=body.display_name,
        base_url=body.base_url,
        local=body.local,
        secret_ref=body.secret_ref if body.secret_ref is not None else existing.secret_ref,
        default_model=body.default_model,
        enabled=body.enabled,
    )
    result = store.write_note(note, body="", commit_message=f"llm: update {provider_id}")
    if result.conflict:
        raise HTTPException(409, {"code": "conflict_file_written", "message": str(result.path)})
    _bump_credential_version(provider_id)
    return _envelope(note)


@router.delete("/providers/{provider_id}", status_code=204)
def delete_provider(provider_id: str) -> None:
    store = _require_store()
    try:
        existing, _ = store.read_note(provider_id)
    except KeyError as err:
        raise HTTPException(404, {"code": "provider_not_found", "message": provider_id}) from err
    if not isinstance(existing, LLMProvider):
        raise HTTPException(404, {"code": "provider_not_found", "message": provider_id})
    if existing.secret_ref:
        SecretStore().delete(existing.secret_ref)
    _note_delete_path(store, provider_id)
    _bump_credential_version(provider_id)


class _CredentialBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: str


@router.put("/providers/{provider_id}/credential", status_code=204)
def put_credential(provider_id: str, body: _CredentialBody) -> None:
    store = _require_store()
    try:
        note, _ = store.read_note(provider_id)
    except KeyError as err:
        raise HTTPException(404, {"code": "provider_not_found", "message": provider_id}) from err
    if not isinstance(note, LLMProvider):
        raise HTTPException(404, {"code": "provider_not_found", "message": provider_id})
    ref = note.secret_ref or f"llm.{provider_id}.token"
    SecretStore().set(ref, body.value)
    if not note.secret_ref:
        updated = note.model_copy(update={"secret_ref": ref})
        store.write_note(updated, body="", commit_message=f"llm: set secret_ref for {provider_id}")
    _bump_credential_version(provider_id)


@router.delete("/providers/{provider_id}/credential", status_code=204)
def delete_credential(provider_id: str) -> None:
    store = _require_store()
    try:
        note, _ = store.read_note(provider_id)
    except KeyError as err:
        raise HTTPException(404, {"code": "provider_not_found", "message": provider_id}) from err
    if not isinstance(note, LLMProvider):
        raise HTTPException(404, {"code": "provider_not_found", "message": provider_id})
    if note.secret_ref:
        SecretStore().delete(note.secret_ref)
    _bump_credential_version(provider_id)


_MODEL_CACHE: dict[str, tuple[float, int, list[dict[str, Any]]]] = {}
_CREDENTIAL_VERSION: dict[str, int] = {}
_TTL_SECONDS = 300.0


def reset_model_cache() -> None:
    _MODEL_CACHE.clear()
    _CREDENTIAL_VERSION.clear()


def _bump_credential_version(provider_id: str) -> None:
    _CREDENTIAL_VERSION[provider_id] = _CREDENTIAL_VERSION.get(provider_id, 0) + 1
    _MODEL_CACHE.pop(provider_id, None)


@router.get("/providers/{provider_id}/models")
async def list_models(provider_id: str) -> list[dict[str, Any]]:
    store = _require_store()
    version = _CREDENTIAL_VERSION.get(provider_id, 0)
    entry = _MODEL_CACHE.get(provider_id)
    if entry is not None:
        cached_at, cached_version, cached_payload = entry
        if cached_version == version and (time.monotonic() - cached_at) < _TTL_SECONDS:
            return cached_payload

    svc = LLMService(store)
    try:
        models = await svc.list_models(provider_id)
    except LLMError as exc:
        raise _error(exc) from exc
    payload = [m.model_dump(mode="json") for m in models]
    _MODEL_CACHE[provider_id] = (time.monotonic(), version, payload)
    return payload


@router.post("/chat")
async def chat(req: ChatRequest) -> dict[str, Any]:
    store = _require_store()
    svc = LLMService(store)
    try:
        result = await svc.chat(req)
    except LLMError as exc:
        raise _error(exc) from exc
    return {"content": result.content, "finish_reason": result.finish_reason}


async def _sse_frames(service: LLMService, req: ChatRequest) -> AsyncIterator[str]:
    first_chunk = True
    try:
        agen = service.stream_chat(req).__aiter__()
        try:
            chunk = await agen.__anext__()
        except StopAsyncIteration:
            yield f"event: done\ndata: {json.dumps({'finish_reason': None}, separators=(',', ':'))}\n\n"
            return
        first_chunk = False
        yield f"event: chunk\ndata: {json.dumps(chunk.model_dump(), separators=(',', ':'))}\n\n"
        async for chunk in agen:
            yield f"event: chunk\ndata: {json.dumps(chunk.model_dump(), separators=(',', ':'))}\n\n"
        yield f"event: done\ndata: {json.dumps({'finish_reason': chunk.finish_reason}, separators=(',', ':'))}\n\n"
    except LLMError as exc:
        if first_chunk:
            raise
        payload = json.dumps(
            {"code": getattr(exc, "code", "llm_error"), "message": str(exc)}, separators=(",", ":")
        )
        yield f"event: error\ndata: {payload}\n\n"


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    store = _require_store()
    svc = LLMService(store)
    agen = _sse_frames(svc, req)
    try:
        first = await agen.__anext__()
    except LLMError as exc:
        raise _error(exc) from exc
    except StopAsyncIteration:
        first = ""

    async def relay() -> AsyncIterator[bytes]:
        if first:
            yield first.encode("utf-8")
        async for piece in agen:
            yield piece.encode("utf-8")

    return StreamingResponse(relay(), media_type="text/event-stream")
