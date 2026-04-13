from __future__ import annotations

from pathlib import Path

from lifescribe.ingest.extractors.html_ import HtmlExtractor


def test_extracts_main_content(tmp_path: Path) -> None:
    p = tmp_path / "a.html"
    p.write_text(
        """<html><head><title>Doc Title</title></head>
<body>
  <nav>nav</nav>
  <article>
    <h1>Heading</h1>
    <p>Main content paragraph with several words in it.</p>
  </article>
  <footer>footer</footer>
</body></html>""",
        encoding="utf-8",
    )
    r = HtmlExtractor().extract(p)
    assert "Main content paragraph" in r.body_markdown
    assert r.title == "Doc Title"
    assert r.extractor == "html@0.1.0"


def test_empty_html_fallback(tmp_path: Path) -> None:
    p = tmp_path / "a.html"
    p.write_text("<html><body><p>tiny</p></body></html>", encoding="utf-8")
    r = HtmlExtractor().extract(p)
    assert "tiny" in r.body_markdown
