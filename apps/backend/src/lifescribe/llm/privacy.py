from __future__ import annotations

from urllib.parse import urlparse

from lifescribe.llm.base import PrivacyViolation

_LOCAL_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


def check_url_allowed(url: str, *, privacy_mode: bool) -> None:
    if not privacy_mode:
        return
    try:
        parsed = urlparse(url)
    except ValueError as exc:
        raise PrivacyViolation("url_not_local", "malformed URL") from exc
    host = (parsed.hostname or "").lower()
    if not host or host not in _LOCAL_HOSTS:
        raise PrivacyViolation(
            "url_not_local",
            f"privacy mode on; host {host!r} is not in the local allow-list",
        )
