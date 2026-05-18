from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict

from lifescribe import connectors_dir
from lifescribe.api.routers.vault import _State as _VaultState
from lifescribe.connectors import (
    ConnectorConfigError,
    ImportRequest,
    PrivacyBlockedError,
    load_catalog,
    run_connector,
)
from lifescribe.vault.importer import VaultImporter
from lifescribe.vault.schemas import VaultSettings

router = APIRouter(prefix="/imports", tags=["imports"])


class ImportBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: str
    inputs: list[str] = []
    options: dict[str, Any] = {}


def _require_store() -> Any:
    if _VaultState.store is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "vault_not_open"})
    return _VaultState.store


def _privacy_mode() -> bool:
    store = _require_store()
    for note in store.list_notes(type_="VaultSettings"):
        if isinstance(note, VaultSettings):
            return bool(note.privacy_mode)
    return False


@router.post("")
def import_from_connector(body: ImportBody) -> dict[str, Any]:
    store = _require_store()
    catalog = load_catalog(connectors_dir())
    entry = catalog.find(body.service)
    if entry is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            {"code": "connector_not_found", "service": body.service},
        )

    request = ImportRequest(inputs=[Path(p) for p in body.inputs], options=body.options)
    try:
        result = run_connector(
            entry,
            request,
            importer=VaultImporter(store),
            vault_path=store.root,
            privacy_mode=_privacy_mode(),
        )
    except PrivacyBlockedError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": "privacy_blocked", "service": exc.service, "message": str(exc)},
        ) from exc
    except ConnectorConfigError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            {"code": "connector_config_error", "message": str(exc)},
        ) from exc

    return asdict(result)
