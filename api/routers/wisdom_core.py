"""Wisdom Loop core admin routes: job health and on-demand runs (docs/wisdom/CONTRACTS.md §2).

Every route, reads included, carries Depends(require_admin); /api/admin/wisdom is
not covered by AdminGuardMiddleware, so the dependency is the gate. On-demand
runs go to a daemon thread, never the request path (the web pod has one shared
threadpool), with a per-process overlap guard.
"""
from __future__ import annotations

import sqlite3
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import require_admin
from api.services.wisdom import registry
from api.services.wisdom.core import flags, heartbeat, store

router = APIRouter(prefix="/api/admin/wisdom/core", tags=["wisdom"])

_RUNNING: set = set()
_RUNNING_LOCK = threading.Lock()


@router.get("/status")
def wisdom_status(_admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            beats = {row["job_id"]: row for row in heartbeat.job_health(conn)}
            migrations = [dict(r) for r in conn.execute(
                "SELECT name, applied_at FROM wisdom_migrations ORDER BY name")]
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")
    jobs = []
    for spec in registry.job_specs():
        jobs.append({
            "job_id": spec.job_id,
            "trigger": spec.trigger,
            "enabled": bool(spec.enabled()),
            "trading_days_only": spec.trading_days_only,
            "expected_every_s": spec.expected_every_s,
            "catch_up_grace_s": spec.catch_up_grace_s,
            "heartbeat": beats.get(spec.job_id),
            "running_in_this_process": spec.job_id in _RUNNING,
        })
    return {
        "master_switch_on": flags.ingest_enabled(),
        "migrations": migrations,
        "jobs": jobs,
        "flags": [{"env": env, "on": reader(), "member_visible": visible} for env, reader, visible in flags.GATES],
    }


@router.get("/runs")
def wisdom_runs(job_id: Optional[str] = None, limit: int = Query(50, ge=1, le=500),
                _admin: dict = Depends(require_admin)) -> dict:
    sql = ("SELECT run_id, job_id, due_key, started_at, finished_at, status, forced, dry_run, error, "
           "substr(result_json, 1, 4000) AS result_json FROM wisdom_job_runs")
    params: list = []
    if job_id:
        sql += " WHERE job_id = ?"
        params.append(job_id)
    sql += " ORDER BY started_at DESC LIMIT ?"
    params.append(limit)
    try:
        with store.read(for_request=True) as conn:
            rows = [dict(r) for r in conn.execute(sql, params)]
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")
    return {"runs": rows, "count": len(rows)}


@router.post("/jobs/{job_id}/run")
def wisdom_run_job(job_id: str, dry_run: bool = Query(True), force: bool = Query(False),
                   _admin: dict = Depends(require_admin)) -> dict:
    if registry.find_spec(job_id) is None:
        raise HTTPException(status_code=404, detail="unknown Wisdom job")
    with _RUNNING_LOCK:
        if job_id in _RUNNING:
            raise HTTPException(status_code=409, detail="that job is already running in this process")
        _RUNNING.add(job_id)

    def _go() -> None:
        try:
            registry.run_job(job_id, force=force, dry_run=dry_run)
        finally:
            with _RUNNING_LOCK:
                _RUNNING.discard(job_id)

    threading.Thread(target=_go, name=f"wisdom-run-{job_id}", daemon=True).start()
    return {"started": True, "job_id": job_id, "dry_run": dry_run, "force": force}
