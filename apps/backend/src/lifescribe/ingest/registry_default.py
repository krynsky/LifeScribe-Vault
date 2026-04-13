from __future__ import annotations

from lifescribe.ingest.extractors.csv_ import CsvExtractor
from lifescribe.ingest.extractors.docx import DocxExtractor
from lifescribe.ingest.extractors.html_ import HtmlExtractor
from lifescribe.ingest.extractors.image import ImageExtractor
from lifescribe.ingest.extractors.json_ import JsonExtractor
from lifescribe.ingest.extractors.pdf import PdfExtractor
from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.extractors.text import MarkdownExtractor, TextExtractor
from lifescribe.ingest.extractors.xlsx import XlsxExtractor


def default_registry() -> ExtractorRegistry:
    reg = ExtractorRegistry()
    reg.register(TextExtractor())
    reg.register(MarkdownExtractor())
    reg.register(JsonExtractor())
    reg.register(CsvExtractor())
    reg.register(HtmlExtractor())
    reg.register(PdfExtractor())
    reg.register(DocxExtractor())
    reg.register(XlsxExtractor())
    reg.register(ImageExtractor())
    return reg
