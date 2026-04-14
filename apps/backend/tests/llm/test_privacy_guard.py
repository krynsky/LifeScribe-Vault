from __future__ import annotations

import pytest

from lifescribe.llm.base import PrivacyViolation
from lifescribe.llm.privacy import check_url_allowed


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:1234/v1",
        "http://[::1]:8080/v1",
        "http://localhost:5000/v1",
        "https://localhost/v1",
    ],
)
def test_privacy_on_allows_local_hosts(url: str) -> None:
    check_url_allowed(url, privacy_mode=True)


@pytest.mark.parametrize(
    "url",
    [
        "https://api.github.com/v1",
        "http://192.168.1.5/v1",
        "https://evil.com/127.0.0.1/v1",
        "http://127.0.0.1.evil.com/v1",
    ],
)
def test_privacy_on_blocks_non_local(url: str) -> None:
    with pytest.raises(PrivacyViolation) as exc:
        check_url_allowed(url, privacy_mode=True)
    assert exc.value.code == "url_not_local"


def test_privacy_off_allows_everything() -> None:
    check_url_allowed("https://api.github.com/v1", privacy_mode=False)
    check_url_allowed("http://127.0.0.1/v1", privacy_mode=False)


def test_malformed_url_under_privacy_blocks() -> None:
    with pytest.raises(PrivacyViolation):
        check_url_allowed("not a url", privacy_mode=True)
