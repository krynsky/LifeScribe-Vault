from __future__ import annotations

from fastapi import Depends, FastAPI

from lifescribe import __version__
from lifescribe.api.auth import make_auth_dependency
from lifescribe.api.routers.vault import router as vault_router


def create_app(*, auth_token: str) -> FastAPI:
    require_auth = make_auth_dependency(auth_token)
    app = FastAPI(
        title="LifeScribe Vault API",
        version=__version__,
        dependencies=[Depends(require_auth)],
    )
    app.include_router(vault_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app
