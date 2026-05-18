from __future__ import annotations

import sys
from pathlib import Path

import lifescribe


def test_connectors_dir_prefers_pyinstaller_bundle(
    monkeypatch,
    tmp_path: Path,
) -> None:
    bundled = tmp_path / "bundle" / "connectors"
    bundled.mkdir(parents=True)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path / "bundle"), raising=False)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "app" / "lifescribe-archive-backend.exe"))

    result = lifescribe.connectors_dir()

    assert result == bundled
    assert str(bundled.parent) in sys.path
