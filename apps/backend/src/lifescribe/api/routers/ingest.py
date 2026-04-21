from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, ClassVar

from fastapi import APIRouter, HTTPException, status

from lifescribe import __version__
from lifescribe.api.routers.vault import _State as _VaultState
from lifescribe.ingest.jobs import JobRequest, new_job_id
from lifescribe.ingest.pipeline import JobHandle, run_job
from lifescribe.ingest.registry_default import default_registry
from lifescribe.retrieval.indexer import Indexer
from lifescribe.vault.schemas import IngestJobLog, JobStatus
from lifescribe.vault.serialization import load_note

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["ingest"])

_REGISTRY = default_registry()


class _IngestState:
    active: JobHandle | None = None
    last_error: str | None = None
    last_error_job_id: str | None = None
    indexer: Indexer | None = None
    _tasks: ClassVar[set[asyncio.Task[None]]] = set()


def set_indexer(indexer: Indexer | None) -> None:
    """Inject the retrieval Indexer so ingest jobs trigger re-indexing."""
    _IngestState.indexer = indexer


def _require_store() -> Any:
    if _VaultState.store is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "vault not open")
    return _VaultState.store


def _read_log(store: Any, job_id: str) -> IngestJobLog | None:
    for md in (store.root / "system" / "logs" / "ingestion").rglob(f"{job_id}.md"):
        note, _ = load_note(md.read_text(encoding="utf-8"))
        if isinstance(note, IngestJobLog):
            return note
    return None


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
async def post_job(req: JobRequest) -> dict[str, Any]:
    store = _require_store()
    if _IngestState.active is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"job {_IngestState.active.id} is active",
        )
    started = datetime.now(UTC)
    job_id = new_job_id(started)
    handle = JobHandle(id=job_id)
    _IngestState.active = handle

    async def _run() -> None:
        try:
            await asyncio.to_thread(
                run_job,
                store,
                files=[Path(f) for f in req.files],
                registry=_REGISTRY,
                app_version=__version__,
                handle=handle,
                indexer=_IngestState.indexer,
            )
        except Exception:
            logger.exception("ingest job %s failed", job_id)
            _IngestState.last_error = f"job {job_id} failed unexpectedly"
            _IngestState.last_error_job_id = job_id
        finally:
            _IngestState.active = None

    task = asyncio.create_task(_run())
    _IngestState._tasks.add(task)
    task.add_done_callback(_IngestState._tasks.discard)
    return {"job_id": job_id, "status": "queued", "total": len(req.files)}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    store = _require_store()
    if _IngestState.active is not None and _IngestState.active.id == job_id:
        return {
            "job_id": job_id,
            "status": JobStatus.RUNNING.value,
            "started_at": None,
            "finished_at": None,
            "total": 0,
            "succeeded": 0,
            "failed": 0,
            "skipped": 0,
            "cancelled": 0,
            "files": [],
        }
    log = _read_log(store, job_id)
    if log is None:
        if _IngestState.last_error_job_id == job_id:
            return {
                "job_id": job_id,
                "status": "failed",
                "started_at": None,
                "finished_at": None,
                "total": 0,
                "succeeded": 0,
                "failed": 0,
                "skipped": 0,
                "cancelled": 0,
                "files": [],
                "error": _IngestState.last_error,
            }
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no such job {job_id}")
    return log.model_dump(mode="json")


@router.delete("/jobs/{job_id}", status_code=status.HTTP_202_ACCEPTED)
def delete_job(job_id: str) -> dict[str, Any]:
    if _IngestState.active is None or _IngestState.active.id != job_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not an active job")
    with _IngestState.active.lock:
        _IngestState.active.cancel_requested = True
    return {"status": "cancelling"}
