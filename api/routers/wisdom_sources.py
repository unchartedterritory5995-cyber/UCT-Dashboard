"""Wisdom Loop sources routes (stream S-C, CONTRACTS.md §2.1 / §6.3).

ADMIN (`/api/admin/wisdom/sources`, every route Depends(require_admin); the admin
guard middleware does not cover this prefix, so the dependency IS the gate):
  GET  /discord/status          cursors, back-off, counts per in-scope channel
  POST /discord/backfill        resumable history walk on a daemon thread
  GET  /sunday-scans/verify     public-URL diff of the newest N issues on a daemon thread + status
  GET  /transcripts/coverage    coverage by stream + the incomplete list

MACHINE (`/api/internal/wisdom/sources`, Depends(require_push_secret)):
  POST /discord/legacy-ids      id-only batches of the legacy classified corpus

Long work never runs on the request path (the web pod has one shared
threadpool): the two long operations start a daemon thread and return at once,
with a per-process overlap guard. No route returns message text or transcript text.
"""
from __future__ import annotations

import hmac
import os
import sqlite3
import threading
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from api.middleware.auth_middleware import require_admin
from api.services.wisdom.core import flags, store

router = APIRouter(prefix="/api/admin/wisdom/sources", tags=["wisdom"])
internal_router = APIRouter(prefix="/api/internal/wisdom/sources", tags=["wisdom"])

_LOCK = threading.Lock()
_TASKS: dict[str, dict] = {
    "discord_backfill": {"running": False, "started_at": None, "finished_at": None, "result": None, "error": None},
    "sunday_scans_verify": {"running": False, "started_at": None, "finished_at": None, "result": None,
                            "error": None, "progress": []},
}


def require_push_secret(request: Request) -> None:
    """The WORKER's credential — the ``PUSH_SECRET`` bearer (copied from
    api/routers/scan_live.py). An UNSET or BLANK secret refuses everybody;
    compare_digest over BYTES so a non-ASCII header answers 401, never 500."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(
            auth.encode("utf-8"), f"Bearer {expected}".encode("utf-8")):
        raise HTTPException(status_code=401, detail="worker credential required")


def _snapshot(name: str) -> dict:
    with _LOCK:
        t = _TASKS[name]
        return {k: (list(v) if isinstance(v, list) else v) for k, v in t.items()}


def _start(name: str, work) -> bool:
    with _LOCK:
        if _TASKS[name]["running"]:
            return False
        _TASKS[name].update({"running": True, "started_at": int(time.time()), "finished_at": None,
                             "result": None, "error": None})
        if "progress" in _TASKS[name]:
            _TASKS[name]["progress"] = []

    def _go() -> None:
        result, error = None, None
        try:
            result = work()
        except Exception as exc:  # noqa: BLE001 — recorded, surfaced on the status route
            error = f"{type(exc).__name__}: {str(exc)[:500]}"
        finally:
            with _LOCK:
                _TASKS[name].update({"running": False, "finished_at": int(time.time()),
                                     "result": result, "error": error})

    threading.Thread(target=_go, name=f"wisdom-sources-{name}", daemon=True).start()
    return True


@router.get("/discord/status")
def discord_status(_admin: dict = Depends(require_admin)) -> dict:
    from api.services.wisdom import sources

    try:
        with store.read(for_request=True) as conn:
            status = sources.discord_status(conn)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")
    status["listener_enabled"] = flags.discord_listener_enabled()
    status["backfill_task"] = _snapshot("discord_backfill")
    return status


@router.post("/discord/backfill")
def discord_backfill(max_pages: int = Query(50, ge=1, le=500), force: bool = Query(False),
                     _admin: dict = Depends(require_admin)) -> dict:
    if not force and not flags.discord_listener_enabled():
        raise HTTPException(status_code=409, detail="WISDOM_DISCORD_LISTENER_ENABLED is off (pass force=true)")

    def work():
        from api.services.wisdom.sources import discord

        return discord.tick(page_budget=max_pages, backfill=True)

    if not _start("discord_backfill", work):
        raise HTTPException(status_code=409, detail="a Discord backfill is already running in this process")
    return {"started": True, "max_pages_per_channel": max_pages}


@router.get("/sunday-scans/verify")
def sunday_scans_verify(limit: Optional[int] = Query(None, ge=1, le=100), force: bool = Query(False),
                        _admin: dict = Depends(require_admin)) -> dict:
    """With `limit`, start a verification of the newest `limit` published issues
    (when none is running); always return the task's status."""
    started = False
    if limit is not None:
        if not force and not flags.sources_ingest_enabled():
            raise HTTPException(status_code=409, detail="WISDOM_SOURCES_INGEST_ENABLED is off (pass force=true)")

        def work():
            from api.services.wisdom.sources import sunday_scans

            def progress(res: dict) -> None:
                with _LOCK:
                    _TASKS["sunday_scans_verify"]["progress"].append(
                        {k: res.get(k) for k in ("post_id", "result", "similarity", "reason")})

            return sunday_scans.verify_recent(limit=limit, progress=progress)

        started = _start("sunday_scans_verify", work)
    return {"started": started, "task": _snapshot("sunday_scans_verify")}


@router.get("/transcripts/coverage")
def transcripts_coverage(_admin: dict = Depends(require_admin)) -> dict:
    from api.services.wisdom import sources

    try:
        with store.read(for_request=True) as conn:
            return sources.transcript_coverage(conn)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")


class LegacyIdsIn(BaseModel):
    channel_id: str
    message_ids: list[str]


@internal_router.post("/discord/legacy-ids")
def discord_legacy_ids(body: LegacyIdsIn, _worker: None = Depends(require_push_secret)) -> dict:
    from api.services.wisdom.sources import discord

    try:
        return discord.record_legacy_ids(body.channel_id, body.message_ids)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")
