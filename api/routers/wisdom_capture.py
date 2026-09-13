"""Wisdom Loop capture admin routes: per-dataset health, run history, on-demand capture.

Every route, reads included, carries ``Depends(require_admin)``; /api/admin/wisdom
is not covered by AdminGuardMiddleware, so the dependency is the gate. An
on-demand capture runs on a daemon thread, never on the request path (the web
pod has one shared threadpool), with a per-process overlap guard (409). The
default is a dry run, which reads and sizes everything and writes nothing.
"""
from __future__ import annotations

import datetime as dt
import sqlite3
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import require_admin
from api.services.wisdom.capture import families, health, runner
from api.services.wisdom.core import store

router = APIRouter(prefix="/api/admin/wisdom/capture", tags=["wisdom"])

_RUNNING: set = set()
_RUNNING_LOCK = threading.Lock()


@router.get("/health")
def capture_health(days: int = Query(10, ge=1, le=90), _admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            table = health.health_table(conn, days=days)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")
    return {
        "days": days,
        "thresholds": {"low_fraction": health.LOW_FRACTION, "median_sessions": health.MEDIAN_SESSIONS,
                       "min_median_samples": health.MIN_MEDIAN_SAMPLES},
        "datasets": table,
        "running_in_this_process": sorted(_RUNNING),
    }


@router.get("/runs")
def capture_runs(dataset: Optional[str] = None, limit: int = Query(50, ge=1, le=500),
                 _admin: dict = Depends(require_admin)) -> dict:
    sql = ("SELECT run_id, dataset, session_date, started_at, finished_at, status, row_count, bytes, r2_key, "
           "trailing_median, health, error FROM wisdom_capture_runs")
    params: list = []
    if dataset:
        sql += " WHERE dataset = ?"
        params.append(dataset)
    sql += " ORDER BY started_at DESC LIMIT ?"
    params.append(limit)
    try:
        with store.read(for_request=True) as conn:
            rows = [dict(r) for r in conn.execute(sql, params)]
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")
    return {"runs": rows, "count": len(rows)}


@router.post("/run-family/{family}")
def capture_run_family(family: str, dry_run: bool = Query(True), as_of: Optional[str] = Query(None),
                       _admin: dict = Depends(require_admin)) -> dict:
    if families.by_name(family) is None:
        raise HTTPException(status_code=404, detail="unknown capture dataset")
    if as_of is not None:
        try:
            dt.date.fromisoformat(as_of)
        except ValueError:
            raise HTTPException(status_code=422, detail="as_of must be YYYY-MM-DD")
    with _RUNNING_LOCK:
        if family in _RUNNING:
            raise HTTPException(status_code=409, detail="that dataset is already being captured in this process")
        _RUNNING.add(family)

    def _go() -> None:
        try:
            runner.run_family(family, as_of=as_of, dry_run=dry_run)
        finally:
            with _RUNNING_LOCK:
                _RUNNING.discard(family)

    threading.Thread(target=_go, name=f"wisdom-capture-{family}", daemon=True).start()
    return {"started": True, "family": family, "dry_run": dry_run, "as_of": as_of}
