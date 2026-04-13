from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Header, HTTPException, status


def make_auth_dependency(
    expected_token: str,
) -> Callable[[str | None], Awaitable[None]]:
    async def _dep(authorization: str | None = Header(default=None)) -> None:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
        presented = authorization.removeprefix("Bearer ").strip()
        if presented != expected_token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid bearer token")

    return _dep
