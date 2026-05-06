from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_backend_build_scripts_collect_docling_runtime_metadata() -> None:
    required_flags = (
        "--collect-all docling",
        "--collect-all docling_core",
        "--collect-all docling_parse",
        "--collect-all docling_ibm_models",
        "--copy-metadata docling-slim",
    )

    for relative_path in (
        "scripts/build-backend.ps1",
        "scripts/build-backend.sh",
        ".github/workflows/release.yml",
    ):
        text = (ROOT / relative_path).read_text(encoding="utf-8")
        for flag in required_flags:
            assert flag in text, f"{relative_path} missing {flag}"
