from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator


@dataclass(frozen=True)
class ConnectorConfig:
    """Per-run configuration passed to a connector before collect()."""

    vault_path: Path
    privacy_mode: bool
    options: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ImportRequest:
    """Inputs for a single collect() call."""

    inputs: list[Path] = field(default_factory=list)
    options: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ImportedDoc:
    """Connector-agnostic payload yielded from collect() into the importer."""

    title: str
    body_markdown: str
    tags: list[str]
    source_meta: dict[str, object]
    assets: list[Path]
    content_hash: str  # sha256 hex


@dataclass(frozen=True)
class ImportItemEntry:
    """Per-item outcome. Generic enough to carry file / message / email metadata."""

    status: str  # "imported" | "skipped_identical" | "skipped_unsupported" | "failed" | "cancelled"
    identifier: str  # path, message-id, etc. for UI display
    note_id: str | None = None
    error: str | None = None
    meta: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ImportResult:
    connector: str
    imported_count: int
    skipped_count: int
    errors: list[str]
    items: list[ImportItemEntry] = field(default_factory=list)


class Connector(ABC):
    """Pluggable source adapter. Subclasses live under `connectors/<service>/connector.py`.

    Lifecycle: configure() → collect() → teardown(). The orchestrator always calls
    teardown() in a finally block — even when configure() or collect() raise.
    """

    @abstractmethod
    def configure(self, cfg: ConnectorConfig) -> None:
        """Validate options, open auth sessions. Called exactly once before collect()."""

    @abstractmethod
    def collect(self, req: ImportRequest) -> Iterator[ImportedDoc]:
        """Yield ImportedDoc payloads. Pure parsing/fetching — no vault writes."""

    @abstractmethod
    def teardown(self) -> None:
        """Release resources. Called in a finally block; errors logged but not re-raised."""
