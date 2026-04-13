from __future__ import annotations

import pytest

from lifescribe.vault.ids import (
    compose_id,
    content_short_hash,
    sanitize_slug,
)


class TestSanitizeSlug:
    def test_lowercases(self) -> None:
        assert sanitize_slug("Quarterly Report") == "quarterly-report"

    def test_collapses_non_alphanumeric(self) -> None:
        assert sanitize_slug("foo!!!bar???baz") == "foo-bar-baz"

    def test_collapses_dashes(self) -> None:
        assert sanitize_slug("foo---bar") == "foo-bar"

    def test_strips_leading_and_trailing_dashes(self) -> None:
        assert sanitize_slug("---foo---") == "foo"

    def test_caps_at_40_chars(self) -> None:
        s = sanitize_slug("a" * 100)
        assert len(s) == 40
        assert s == "a" * 40

    def test_falls_back_to_untitled_if_empty(self) -> None:
        assert sanitize_slug("!!!") == "untitled"
        assert sanitize_slug("") == "untitled"

    def test_unicode_stripped(self) -> None:
        assert sanitize_slug("café résumé") == "caf-r-sum"


class TestContentShortHash:
    def test_deterministic(self) -> None:
        assert content_short_hash(b"hello") == content_short_hash(b"hello")

    def test_different_content_different_hash(self) -> None:
        assert content_short_hash(b"hello") != content_short_hash(b"goodbye")

    def test_length_is_4(self) -> None:
        assert len(content_short_hash(b"hello")) == 4

    def test_lowercase_base32(self) -> None:
        h = content_short_hash(b"hello")
        assert h.islower()
        assert all(c in "abcdefghijklmnopqrstuvwxyz234567" for c in h)


class TestComposeId:
    def test_format(self) -> None:
        out = compose_id(type_prefix="src", slug="foo-bar", short_hash="abcd")
        assert out == "src_foo-bar_abcd"

    def test_sanitizes_slug(self) -> None:
        out = compose_id(type_prefix="src", slug="Foo Bar!!", short_hash="abcd")
        assert out == "src_foo-bar_abcd"

    def test_rejects_bad_prefix(self) -> None:
        with pytest.raises(ValueError):
            compose_id(type_prefix="SRC", slug="foo", short_hash="abcd")
        with pytest.raises(ValueError):
            compose_id(type_prefix="", slug="foo", short_hash="abcd")

    def test_rejects_bad_hash(self) -> None:
        with pytest.raises(ValueError):
            compose_id(type_prefix="src", slug="foo", short_hash="abc")
        with pytest.raises(ValueError):
            compose_id(type_prefix="src", slug="foo", short_hash="ABCD")
