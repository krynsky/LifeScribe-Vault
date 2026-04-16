from __future__ import annotations

from pathlib import Path

import pytest

from lifescribe.connectors.base import Connector
from lifescribe.connectors.catalog import (
    Catalog,
    CatalogEntry,
    EntryPointResolutionError,
    load_catalog,
    resolve_entry_point,
)


def test_load_catalog_parses_valid_manifest(connectors_dir: Path, write_manifest) -> None:
    write_manifest(connectors_dir, "alpha")
    cat = load_catalog(connectors_dir)
    assert isinstance(cat, Catalog)
    assert len(cat.entries) == 1
    assert cat.warnings == []
    entry = cat.entries[0]
    assert isinstance(entry, CatalogEntry)
    assert entry.service == "alpha"
    assert entry.display_name == "Alpha"
    assert entry.privacy_posture == "local_only"
    assert entry.manifest_schema_version == 1
    assert entry.manifest_path == connectors_dir / "alpha" / "manifest.toml"


def test_find_returns_matching_entry(connectors_dir: Path, write_manifest) -> None:
    write_manifest(connectors_dir, "alpha")
    write_manifest(connectors_dir, "bravo")
    cat = load_catalog(connectors_dir)
    assert cat.find("alpha") is not None
    assert cat.find("alpha").service == "alpha"
    assert cat.find("missing") is None


def test_skips_dir_without_manifest(connectors_dir: Path, write_manifest) -> None:
    (connectors_dir / "bare").mkdir()
    write_manifest(connectors_dir, "alpha")
    cat = load_catalog(connectors_dir)
    assert [e.service for e in cat.entries] == ["alpha"]
    assert any("bare" in w for w in cat.warnings)


def test_skips_malformed_toml(connectors_dir: Path, write_manifest) -> None:
    bad = connectors_dir / "bad"
    bad.mkdir()
    (bad / "manifest.toml").write_text("not valid = = toml")
    write_manifest(connectors_dir, "alpha")
    cat = load_catalog(connectors_dir)
    assert [e.service for e in cat.entries] == ["alpha"]
    assert any("bad" in w for w in cat.warnings)


def test_skips_missing_required_field(connectors_dir: Path) -> None:
    bad = connectors_dir / "bad"
    bad.mkdir()
    (bad / "manifest.toml").write_text(
        'manifest_schema_version = 1\nservice = "bad"\n'
    )
    cat = load_catalog(connectors_dir)
    assert cat.entries == []
    assert any("missing" in w.lower() for w in cat.warnings)


def test_duplicate_service_keeps_first(connectors_dir: Path, write_manifest) -> None:
    write_manifest(connectors_dir, "alpha")
    # second dir with same service value but different folder name
    dup = connectors_dir / "alpha_copy"
    dup.mkdir()
    (dup / "manifest.toml").write_text(
        (connectors_dir / "alpha" / "manifest.toml").read_text()
    )
    cat = load_catalog(connectors_dir)
    assert len(cat.entries) == 1
    assert any("duplicate" in w.lower() for w in cat.warnings)


def test_unknown_schema_version_skipped(connectors_dir: Path, write_manifest) -> None:
    write_manifest(connectors_dir, "alpha", schema_version=999)
    cat = load_catalog(connectors_dir)
    assert cat.entries == []
    assert any("schema_version" in w for w in cat.warnings)


def test_sample_files_resolved_absolute(connectors_dir: Path, write_manifest) -> None:
    cdir = write_manifest(
        connectors_dir,
        "alpha",
        extra_body='sample_files = ["samples/hello.txt"]',
    )
    (cdir / "samples").mkdir()
    (cdir / "samples" / "hello.txt").write_text("hi")
    cat = load_catalog(connectors_dir)
    sample = cat.entries[0].sample_files[0]
    assert sample.is_absolute()
    assert sample == cdir / "samples" / "hello.txt"


def test_resolve_entry_point_success() -> None:
    cls = resolve_entry_point("lifescribe.connectors.base:Connector")
    assert cls is Connector


def test_resolve_entry_point_bad_format() -> None:
    with pytest.raises(EntryPointResolutionError):
        resolve_entry_point("no_colon_here")


def test_resolve_entry_point_missing_attr() -> None:
    with pytest.raises(EntryPointResolutionError):
        resolve_entry_point("lifescribe.connectors.base:DoesNotExist")
