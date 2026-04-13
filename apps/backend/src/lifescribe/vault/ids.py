from __future__ import annotations

import base64
import hashlib
import re

_SLUG_MAX_LEN = 40
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_PREFIX_RE = re.compile(r"^[a-z]+$")
_HASH_RE = re.compile(r"^[a-z2-7]{4}$")


def sanitize_slug(raw: str) -> str:
    """Lowercase, collapse non-alphanumerics to dashes, trim, cap at 40 chars.

    Falls back to ``"untitled"`` if the result would be empty.
    """
    lowered = raw.lower()
    replaced = _NON_ALNUM.sub("-", lowered)
    stripped = replaced.strip("-")
    if not stripped:
        return "untitled"
    return stripped[:_SLUG_MAX_LEN].rstrip("-") or "untitled"


def content_short_hash(content: bytes) -> str:
    """Return the first 4 chars of lowercase-base32(sha256(content))."""
    digest = hashlib.sha256(content).digest()
    b32 = base64.b32encode(digest).decode("ascii").lower().rstrip("=")
    return b32[:4]


def compose_id(*, type_prefix: str, slug: str, short_hash: str) -> str:
    """Compose a canonical id as ``<prefix>_<slug>_<hash>``.

    ``slug`` is sanitized; ``type_prefix`` must match ``^[a-z]+$``; ``short_hash``
    must be exactly 4 lowercase base32 chars.
    """
    if not _PREFIX_RE.match(type_prefix):
        raise ValueError(f"Invalid type prefix: {type_prefix!r}")
    if not _HASH_RE.match(short_hash):
        raise ValueError(f"Invalid short hash: {short_hash!r}")
    return f"{type_prefix}_{sanitize_slug(slug)}_{short_hash}"
