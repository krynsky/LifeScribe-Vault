from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.mime import detect_mime


def test_detects_pdf_by_magic(tmp_path: Path) -> None:
    p = tmp_path / "doc.pdf"
    p.write_bytes(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    assert detect_mime(p) == "application/pdf"


def test_detects_plain_by_extension(tmp_path: Path) -> None:
    p = tmp_path / "note.txt"
    p.write_text("hello", encoding="utf-8")
    assert detect_mime(p) == "text/plain"


def test_markdown_by_extension(tmp_path: Path) -> None:
    p = tmp_path / "n.md"
    p.write_text("# h", encoding="utf-8")
    assert detect_mime(p) == "text/markdown"


def test_csv_by_extension(tmp_path: Path) -> None:
    p = tmp_path / "a.csv"
    p.write_text("a,b\n1,2\n", encoding="utf-8")
    assert detect_mime(p) == "text/csv"


def test_png_by_magic(tmp_path: Path) -> None:
    p = tmp_path / "i.png"
    p.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    assert detect_mime(p) == "image/png"


def test_unknown_returns_octet_stream(tmp_path: Path) -> None:
    p = tmp_path / "blob.xyz"
    p.write_bytes(b"\x00\x01\x02\x03")
    assert detect_mime(p) == "application/octet-stream"
