"""Pluggable connector framework for importing external data into the vault."""

from __future__ import annotations

import logging
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any, Protocol

from .base import (
    Connector,
    ConnectorConfig,
    ImportedDoc,
    ImportItemEntry,
    ImportRequest,
    ImportResult,
)
from .catalog import Catalog, CatalogEntry, load_catalog, resolve_entry_point

__all__ = [
    "Catalog",
    "CatalogEntry",
    "Connector",
    "ConnectorConfig",
    "ConnectorConfigError",
    "ImportItemEntry",
    "ImportRequest",
    "ImportResult",
    "ImportedDoc",
    "PrivacyBlockedError",
    "VaultImporterProtocol",
    "load_catalog",
    "resolve_entry_point",
    "run_connector",
]

logger = logging.getLogger(__name__)


class PrivacyBlockedError(RuntimeError):
    """Raised when a connector is blocked by privacy mode."""

    def __init__(self, service: str) -> None:
        super().__init__(f"connector '{service}' is blocked by privacy mode")
        self.service = service


class ConnectorConfigError(RuntimeError):
    """Raised when a connector's configure() rejects its options."""


class VaultImporterProtocol(Protocol):
    def ingest(
        self,
        connector: str,
        docs: Iterator[ImportedDoc] | Iterable[ImportedDoc],
        **kwargs: Any,
    ) -> ImportResult: ...


def run_connector(
    entry: CatalogEntry,
    request: ImportRequest,
    *,
    importer: VaultImporterProtocol,
    vault_path: Path,
    privacy_mode: bool,
) -> ImportResult:
    """Instantiate, configure, collect, and teardown a connector.

    Enforces privacy at the orchestration boundary so a misbehaving connector
    cannot bypass the gate by forgetting to read the flag itself.
    """
    if privacy_mode and entry.privacy_posture == "requires_network":
        raise PrivacyBlockedError(entry.service)

    cls = resolve_entry_point(entry.entry_point)
    connector = cls()

    try:
        try:
            connector.configure(
                ConnectorConfig(vault_path=vault_path, privacy_mode=privacy_mode)
            )
        except Exception as exc:
            raise ConnectorConfigError(str(exc)) from exc

        return importer.ingest(entry.service, connector.collect(request))
    finally:
        try:
            connector.teardown()
        except Exception as exc:
            logger.warning(
                "connector %s: teardown raised: %s", entry.service, exc
            )
