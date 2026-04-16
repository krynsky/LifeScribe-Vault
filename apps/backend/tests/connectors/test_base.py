from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest

from lifescribe.connectors.base import (
    Connector,
    ConnectorConfig,
    ImportedDoc,
    ImportItemEntry,
    ImportRequest,
    ImportResult,
)


class _Recorder(Connector):
    def __init__(self) -> None:
        self.events: list[str] = []
        self.raise_on_collect = False

    def configure(self, cfg: ConnectorConfig) -> None:
        self.events.append(f"configure:{cfg.vault_path}")

    def collect(self, req: ImportRequest) -> Iterator[ImportedDoc]:
        self.events.append("collect:start")
        if self.raise_on_collect:
            raise RuntimeError("boom")
        yield ImportedDoc(
            title="t",
            body_markdown="b",
            tags=[],
            source_meta={},
            assets=[],
            content_hash="0" * 64,
        )
        self.events.append("collect:end")

    def teardown(self) -> None:
        self.events.append("teardown")


def test_connector_is_abstract() -> None:
    with pytest.raises(TypeError):
        Connector()  # type: ignore[abstract]


def test_imported_doc_is_frozen() -> None:
    doc = ImportedDoc(
        title="t",
        body_markdown="b",
        tags=["x"],
        source_meta={"k": "v"},
        assets=[Path("/tmp/a")],
        content_hash="a" * 64,
    )
    with pytest.raises(Exception):
        doc.title = "changed"  # type: ignore[misc]


def test_import_result_defaults() -> None:
    r = ImportResult(connector="x", imported_count=0, skipped_count=0, errors=[])
    assert r.items == []


def test_import_item_entry_fields() -> None:
    entry = ImportItemEntry(
        status="imported",
        identifier="/tmp/a.txt",
        note_id="src_a_b",
        error=None,
        meta={"extractor": "text@0.1.0"},
    )
    assert entry.status == "imported"
    assert entry.meta["extractor"] == "text@0.1.0"


def test_connector_lifecycle_order(tmp_path: Path) -> None:
    c = _Recorder()
    c.configure(ConnectorConfig(vault_path=tmp_path, privacy_mode=False))
    list(c.collect(ImportRequest(inputs=[])))
    c.teardown()
    assert c.events == [f"configure:{tmp_path}", "collect:start", "collect:end", "teardown"]
