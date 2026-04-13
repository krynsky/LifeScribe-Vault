from __future__ import annotations

import secrets
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    files: list[str]


def new_job_id(at: datetime) -> str:
    stamp = at.strftime("%Y-%m-%d_%H-%M-%S")
    suffix = secrets.token_hex(2)
    return f"job_{stamp}_{suffix}"
