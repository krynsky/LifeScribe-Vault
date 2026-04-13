from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PrivacyLabel(StrEnum):
    PRIVATE = "private"
    SHAREABLE = "shareable"
    PUBLISHABLE = "publishable"
    RESTRICTED = "restricted"


class Links(BaseModel):
    parent_source: str | None = None
    derived_from: list[str] = Field(default_factory=list)


class _NoteBase(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=False)

    id: str
    schema_version: int = 1
    privacy: PrivacyLabel = PrivacyLabel.PRIVATE
    links: Links = Field(default_factory=Links)
    tags: list[str] = Field(default_factory=list)


class _ProvenanceMixin(BaseModel):
    source_path: str
    source_hash: str
    source_mtime: datetime
    imported_at: datetime
    imported_by_job: str
    extractor: str
    extractor_confidence: float = Field(ge=0.0, le=1.0)


class SourceRecord(_NoteBase, _ProvenanceMixin):
    type: Literal["SourceRecord"]
    mime_type: str
    original_filename: str
    size_bytes: int = Field(ge=0)
    page_count: int | None = None

    @model_validator(mode="after")
    def _check_id_prefix(self) -> SourceRecord:
        if not self.id.startswith("src_"):
            raise ValueError("SourceRecord id must start with 'src_'")
        return self


class DocumentRecord(_NoteBase, _ProvenanceMixin):
    type: Literal["DocumentRecord"]
    parent_source: str
    position_in_parent: str

    @model_validator(mode="after")
    def _check_id_prefix(self) -> DocumentRecord:
        if not self.id.startswith("doc_"):
            raise ValueError("DocumentRecord id must start with 'doc_'")
        return self


class ConnectorRecord(_NoteBase):
    type: Literal["ConnectorRecord"]
    connector_type: Literal[
        "FileConnector",
        "ManualExportConnector",
        "APISyncConnector",
        "WatchFolderConnector",
        "BridgeConnector",
    ]
    auth_ref: str | None
    schedule: str | None
    last_run: datetime | None
    status: Literal["active", "paused", "error"]

    @model_validator(mode="after")
    def _check_id_prefix(self) -> ConnectorRecord:
        if not self.id.startswith("conn_"):
            raise ValueError("ConnectorRecord id must start with 'conn_'")
        return self


class IngestionLogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: Literal["IngestionLogEntry"]
    schema_version: int = 1
    job_id: str
    started_at: datetime
    finished_at: datetime
    inputs: list[str]
    outputs: list[str]
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _ids_match(self) -> IngestionLogEntry:
        if self.id != self.job_id:
            raise ValueError("IngestionLogEntry id must equal job_id")
        if not self.id.startswith("job_"):
            raise ValueError("IngestionLogEntry id must start with 'job_'")
        return self


class MigrationRecord(BaseModel):
    from_version: int = Field(alias="from")
    to_version: int = Field(alias="to")
    applied_at: datetime

    model_config = ConfigDict(populate_by_name=True)


class VaultManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: Literal["VaultManifest"]
    schema_version: int
    app_version: str
    created_at: datetime
    migrations: list[MigrationRecord] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_id_prefix(self) -> VaultManifest:
        if not self.id.startswith("vault_"):
            raise ValueError("VaultManifest id must start with 'vault_'")
        return self


Note = Annotated[
    SourceRecord | DocumentRecord | ConnectorRecord | IngestionLogEntry | VaultManifest,
    Field(discriminator="type"),
]


class _NoteEnvelope(BaseModel):
    note: Note


def parse_note(data: dict[str, object]) -> Note:
    """Parse an untyped dict into the correct Note subclass based on ``type``."""
    return _NoteEnvelope(note=data).note  # type: ignore[arg-type]
