from __future__ import annotations

import importlib
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .base import Connector

SUPPORTED_SCHEMA_VERSIONS = {1}
REQUIRED_FIELDS = (
    "manifest_schema_version",
    "service",
    "display_name",
    "category",
    "auth_mode",
    "tier",
    "connector_type",
    "entry_point",
    "privacy_posture",
)


class EntryPointResolutionError(ValueError):
    """Raised when a manifest's `entry_point` cannot be resolved to a Connector class."""


@dataclass(frozen=True)
class CatalogEntry:
    service: str
    display_name: str
    description: str
    category: str
    auth_mode: str
    tier: str
    connector_type: str
    entry_point: str
    supported_formats: list[str]
    privacy_posture: str
    export_instructions: str
    sample_files: list[Path]
    manifest_schema_version: int
    manifest_path: Path


@dataclass(frozen=True)
class Catalog:
    entries: list[CatalogEntry] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def find(self, service: str) -> CatalogEntry | None:
        for e in self.entries:
            if e.service == service:
                return e
        return None


def load_catalog(connectors_dir: Path) -> Catalog:
    """Scan ``connectors_dir`` for subdirectories containing ``manifest.toml``."""
    entries: list[CatalogEntry] = []
    warnings: list[str] = []
    seen_services: set[str] = set()

    if not connectors_dir.exists():
        warnings.append(f"{connectors_dir}: connectors directory not found")
        return Catalog(entries=entries, warnings=warnings)

    for child in sorted(connectors_dir.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        manifest_path = child / "manifest.toml"
        if not manifest_path.exists():
            warnings.append(f"{child}: missing manifest.toml")
            continue
        try:
            raw = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
        except (tomllib.TOMLDecodeError, UnicodeDecodeError, OSError) as exc:
            warnings.append(f"{manifest_path}: failed to parse TOML: {exc}")
            continue

        missing = [k for k in REQUIRED_FIELDS if k not in raw]
        if missing:
            warnings.append(f"{manifest_path}: missing required fields: {missing}")
            continue

        schema_version = raw["manifest_schema_version"]
        if schema_version not in SUPPORTED_SCHEMA_VERSIONS:
            warnings.append(
                f"{manifest_path}: unsupported manifest_schema_version={schema_version}"
            )
            continue

        service = raw["service"]
        if service in seen_services:
            warnings.append(f"{manifest_path}: duplicate service '{service}' (first wins)")
            continue
        seen_services.add(service)

        sample_files = [
            (child / s).resolve()
            for s in raw.get("sample_files", [])
            if isinstance(s, str)
        ]

        entries.append(
            CatalogEntry(
                service=service,
                display_name=raw["display_name"],
                description=raw.get("description", ""),
                category=raw["category"],
                auth_mode=raw["auth_mode"],
                tier=raw["tier"],
                connector_type=raw["connector_type"],
                entry_point=raw["entry_point"],
                supported_formats=list(raw.get("supported_formats", [])),
                privacy_posture=raw["privacy_posture"],
                export_instructions=raw.get("export_instructions", ""),
                sample_files=sample_files,
                manifest_schema_version=schema_version,
                manifest_path=manifest_path,
            )
        )

    return Catalog(entries=entries, warnings=warnings)


def resolve_entry_point(entry_point: str) -> type[Connector]:
    """Resolve ``"pkg.mod:ClassName"`` to a Connector subclass."""
    if ":" not in entry_point:
        raise EntryPointResolutionError(
            f"entry_point must be 'module:Class', got {entry_point!r}"
        )
    module_name, _, attr = entry_point.partition(":")
    try:
        module = importlib.import_module(module_name)
    except ImportError as exc:
        raise EntryPointResolutionError(
            f"cannot import module {module_name!r}: {exc}"
        ) from exc
    cls: Any = getattr(module, attr, None)
    if cls is None:
        raise EntryPointResolutionError(
            f"module {module_name!r} has no attribute {attr!r}"
        )
    if not (isinstance(cls, type) and issubclass(cls, Connector)):
        raise EntryPointResolutionError(
            f"{entry_point!r} does not resolve to a Connector subclass"
        )
    return cls
