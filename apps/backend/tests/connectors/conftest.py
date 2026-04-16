from __future__ import annotations

from pathlib import Path
from textwrap import dedent

import pytest


@pytest.fixture
def connectors_dir(tmp_path: Path) -> Path:
    """A temp dir that looks like the repo's top-level `connectors/`."""
    d = tmp_path / "connectors"
    d.mkdir()
    return d


def _write_manifest(
    parent: Path,
    service: str,
    *,
    schema_version: int = 1,
    extra_body: str = "",
    privacy_posture: str = "local_only",
    entry_point: str = "tests.connectors.fake:FakeConnector",
) -> Path:
    cdir = parent / service
    cdir.mkdir()
    body = dedent(
        f"""
        manifest_schema_version = {schema_version}
        service = "{service}"
        display_name = "{service.title()}"
        description = "a test connector"
        category = "files"
        auth_mode = "none"
        tier = "free"
        connector_type = "file"
        entry_point = "{entry_point}"
        supported_formats = ["txt"]
        privacy_posture = "{privacy_posture}"
        export_instructions = "nothing to do"
        """
    ).strip()
    if extra_body:
        body += "\n" + extra_body
    else:
        body += "\nsample_files = []"
    body += "\n"
    (cdir / "manifest.toml").write_text(body)
    return cdir


@pytest.fixture
def write_manifest():
    return _write_manifest
