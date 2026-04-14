from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status

from lifescribe.llm.base import (
    CredentialMissing,
    LLMError,
    PrivacyViolation,
    ProviderNotFound,
    UpstreamError,
    UpstreamTimeout,
)
from lifescribe.llm.secrets import SecretStore
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
