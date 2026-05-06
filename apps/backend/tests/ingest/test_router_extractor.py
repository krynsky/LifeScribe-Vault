from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import pytest

from lifescribe.ingest.extractors.base import ExtractionResult
from lifescribe.ingest.extractors.router import ExtractionChainError, RoutedExtractor


class _GoodExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
    NAME: ClassVar[str] = "good"
    VERSION: ClassVar[str] = "1.0.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown="good output",
            extractor="good@1.0.0",
            confidence=1.0,
        )


class _BoomExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
    NAME: ClassVar[str] = "boom"
    VERSION: ClassVar[str] = "1.0.0"

    def extract(self, path: Path) -> ExtractionResult:
        raise RuntimeError("conversion failed")


class _FallbackExtractor:
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
    NAME: ClassVar[str] = "fallback"
    VERSION: ClassVar[str] = "1.0.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown="fallback output",
            extractor="fallback@1.0.0",
            confidence=1.0,
        )


def test_routed_extractor_uses_first_success(tmp_path: Path) -> None:
    p = tmp_path / "input.txt"
    p.write_text("input", encoding="utf-8")

    result = RoutedExtractor(
        mimes=("text/plain",),
        extractors=[_GoodExtractor(), _FallbackExtractor()],
    ).extract(p)

    assert result.body_markdown == "good output"
    assert result.extractor == "good@1.0.0"
    assert result.extra_frontmatter["engine_router"] == "routed@0.1.0"
    assert result.extra_frontmatter["engine_selected"] == "good@1.0.0"
    assert result.extra_frontmatter["engine_attempts"] == ["good@1.0.0"]
    assert result.extra_frontmatter["engine_warnings"] == []


def test_routed_extractor_falls_back_after_failure(tmp_path: Path) -> None:
    p = tmp_path / "input.txt"
    p.write_text("input", encoding="utf-8")

    result = RoutedExtractor(
        mimes=("text/plain",),
        extractors=[_BoomExtractor(), _FallbackExtractor()],
    ).extract(p)

    assert result.body_markdown == "fallback output"
    assert result.extractor == "fallback@1.0.0"
    assert result.extra_frontmatter["engine_selected"] == "fallback@1.0.0"
    assert result.extra_frontmatter["engine_attempts"] == [
        "boom@1.0.0",
        "fallback@1.0.0",
    ]
    assert result.extra_frontmatter["engine_warnings"] == [
        "boom@1.0.0 failed: RuntimeError: conversion failed"
    ]


def test_routed_extractor_raises_aggregate_error_when_all_fail(tmp_path: Path) -> None:
    p = tmp_path / "input.txt"
    p.write_text("input", encoding="utf-8")

    with pytest.raises(ExtractionChainError) as exc_info:
        RoutedExtractor(mimes=("text/plain",), extractors=[_BoomExtractor()]).extract(p)

    message = str(exc_info.value)
    assert "all extraction engines failed" in message
    assert "boom@1.0.0 failed: RuntimeError: conversion failed" in message
