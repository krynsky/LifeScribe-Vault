from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from lifescribe import connectors_dir
from lifescribe.connectors import load_catalog
from lifescribe.connectors.catalog import CatalogEntry
from lifescribe.vault.schemas import VaultSettings

router = APIRouter(prefix="/connectors", tags=["connectors"])


def _current_privacy_mode() -> bool:
    """Read privacy_mode from the active vault settings. Default False if no store/settings."""
    from lifescribe.api.routers.vault import _State  # lazy to avoid import cycles

    store = _State.store
    if store is None:
        return False
    for note in store.list_notes(type_="VaultSettings"):
        if isinstance(note, VaultSettings):
            return bool(note.privacy_mode)
    return False


def _entry_to_json(entry: CatalogEntry, *, privacy_mode: bool) -> dict[str, Any]:
    blocked = privacy_mode and entry.privacy_posture == "requires_network"
    return {
        "service": entry.service,
        "display_name": entry.display_name,
        "description": entry.description,
        "category": entry.category,
        "auth_mode": entry.auth_mode,
        "tier": entry.tier,
        "connector_type": entry.connector_type,
        "entry_point": entry.entry_point,
        "supported_formats": entry.supported_formats,
        "privacy_posture": entry.privacy_posture,
        "export_instructions": entry.export_instructions,
        "sample_file_urls": [
            f"/connectors/{entry.service}/samples/{p.name}" for p in entry.sample_files
        ],
        "manifest_schema_version": entry.manifest_schema_version,
        "blocked": blocked,
    }


@router.get("")
def list_connectors() -> dict[str, Any]:
    cat = load_catalog(connectors_dir())
    privacy = _current_privacy_mode()
    return {
        "entries": [_entry_to_json(e, privacy_mode=privacy) for e in cat.entries],
        "warnings": cat.warnings,
    }


@router.get("/{service}/samples/{filename}")
def get_sample(service: str, filename: str) -> FileResponse:
    cat = load_catalog(connectors_dir())
    entry = cat.find(service)
    if entry is None:
        raise HTTPException(status_code=404, detail="service not found")
    manifest_dir = entry.manifest_path.parent.resolve()
    requested = (manifest_dir / "samples" / filename).resolve()
    try:
        requested.relative_to(manifest_dir)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found") from None
    if not requested.is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(str(requested))
