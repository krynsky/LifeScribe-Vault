from __future__ import annotations

from fastapi import Depends, FastAPI

from lifescribe import __version__
from lifescribe.api.auth import make_auth_dependency


def create_app(*, auth_token: str) -> FastAPI:
    require_auth = make_auth_dependency(auth_token)
    app = FastAPI(
        title="LifeScribe Vault API",
        version=__version__,
        dependencies=[Depends(require_auth)],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app
