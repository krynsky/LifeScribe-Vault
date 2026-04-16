from __future__ import annotations

from lifescribe import connectors_dir
from lifescribe.connectors.base import Connector
from lifescribe.connectors.catalog import load_catalog, resolve_entry_point


def test_catalog_loads_without_warnings() -> None:
    cat = load_catalog(connectors_dir())
    assert cat.warnings == [], f"unexpected catalog warnings: {cat.warnings}"
    assert len(cat.entries) >= 1


def test_every_entry_point_resolves_to_connector_subclass() -> None:
    cat = load_catalog(connectors_dir())
    for entry in cat.entries:
        cls = resolve_entry_point(entry.entry_point)
        assert issubclass(cls, Connector), (
            f"{entry.service}: {entry.entry_point} is not a Connector subclass"
        )


def test_file_drop_is_present_and_local_only() -> None:
    cat = load_catalog(connectors_dir())
    entry = cat.find("file_drop")
    assert entry is not None, "file_drop manifest missing"
    assert entry.privacy_posture == "local_only"
    assert "txt" in entry.supported_formats
    assert entry.sample_files, "file_drop must ship with at least one sample file"
    for sample in entry.sample_files:
        assert sample.exists(), f"declared sample missing: {sample}"
