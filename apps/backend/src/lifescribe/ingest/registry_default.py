from __future__ import annotations

from typing import cast

from lifescribe.ingest.extractors.base import Extractor
from lifescribe.ingest.extractors.csv_ import CsvExtractor
from lifescribe.ingest.extractors.docling_ import DoclingExtractor
from lifescribe.ingest.extractors.docx import DocxExtractor
from lifescribe.ingest.extractors.html_ import HtmlExtractor
from lifescribe.ingest.extractors.image import ImageExtractor
from lifescribe.ingest.extractors.json_ import JsonExtractor
from lifescribe.ingest.extractors.markitdown_ import MarkItDownExtractor
from lifescribe.ingest.extractors.pdf import PdfExtractor
from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.extractors.router import RoutedExtractor
from lifescribe.ingest.extractors.text import MarkdownExtractor, TextExtractor
from lifescribe.ingest.extractors.xlsx import XlsxExtractor

PDF_MIMES = ("application/pdf",)
DOCX_MIMES = ("application/vnd.openxmlformats-officedocument.wordprocessingml.document",)
XLSX_MIMES = ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",)
HTML_MIMES = ("text/html",)
IMAGE_MIMES = (
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
)


def _routed(
    mimes: tuple[str, ...],
    *,
    include_native: Extractor | None = None,
) -> RoutedExtractor:
    extractors: list[Extractor] = [
        cast(Extractor, DoclingExtractor(mimes=mimes)),
        cast(Extractor, MarkItDownExtractor(mimes=mimes)),
    ]
    if include_native is not None:
        extractors.append(include_native)
    return RoutedExtractor(mimes=mimes, extractors=extractors)


def default_registry() -> ExtractorRegistry:
    reg = ExtractorRegistry()
    reg.register(TextExtractor())
    reg.register(MarkdownExtractor())
    reg.register(JsonExtractor())
    reg.register(CsvExtractor())
    reg.register(cast(Extractor, _routed(PDF_MIMES, include_native=PdfExtractor())))
    reg.register(cast(Extractor, _routed(DOCX_MIMES, include_native=DocxExtractor())))
    reg.register(cast(Extractor, _routed(XLSX_MIMES, include_native=XlsxExtractor())))
    reg.register(cast(Extractor, _routed(HTML_MIMES, include_native=HtmlExtractor())))
    reg.register(cast(Extractor, _routed(IMAGE_MIMES, include_native=ImageExtractor())))
    return reg
