"""Wisdom Loop evals admin routes (stream S-E; CONTRACTS §6.5).

Every route carries Depends(require_admin): /api/admin/wisdom is not covered by
AdminGuardMiddleware, so the dependency IS the gate. An on-demand run goes to a daemon thread,
never the request path (the web pod has one shared threadpool), with a per-process overlap guard.
Nothing here returns owner-private data: wisdom_outcomes holds stated levels from closed or
hindsight records only (open-position entries live in the private store).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import require_admin
from api.services.wisdom import registry
from api.services.wisdom.core import heartbeat, ids, store, timeutil
from api.services.wisdom.evals import metrics, pipeline

router = APIRouter(prefix="/api/admin/wisdom/evals", tags=["wisdom"])

_RUN_LOCK = threading.Lock()
_STATE: dict = {"running": False, "last": None}


@router.get("/metrics")
def evals_metrics(_admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            rows = metrics.latest_metrics(conn)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")
    return {"method_version": metrics.METHOD_VERSION, "count": len(rows), "metrics": rows}


@router.get("/outcomes/{record_id}")
def evals_outcome(record_id: str, _admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            rows = [dict(r) for r in conn.execute(
                "SELECT * FROM wisdom_outcomes WHERE record_id = ? ORDER BY methodology_version", (record_id,))]
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")
    if not rows:
        raise HTTPException(status_code=404, detail="no outcome for that record")
    for row in rows:
        try:
            row["horizons"] = json.loads(row.pop("horizons_json", None) or "{}")
        except ValueError:
            row["horizons"] = {}
    return {"record_id": record_id, "outcomes": rows}


@router.post("/run")
def evals_run(dry_run: bool = Query(True), force: bool = Query(False),
              _admin: dict = Depends(require_admin)) -> dict:
    with _RUN_LOCK:
        if _STATE["running"]:
            raise HTTPException(status_code=409, detail="an evals run is already in progress in this process")
        _STATE["running"] = True
    now = timeutil.now_et()
    ctx = registry.JobContext(job_id="wisdom_evals_on_demand", now_et=now, due_key=None, force=force,
                              dry_run=dry_run, run_id=ids.sha24("wisdom_evals_on_demand", now.isoformat(),
                                                                time.time_ns()))

    def _go() -> None:
        started = timeutil.iso_et(timeutil.now_et())
        # A WRITE with no ledger row is unauditable. registry._run_job records every scheduled
        # run in wisdom_job_runs; this route calls the pipeline directly, so it records its own.
        # A dry run computes and writes nothing, so it earns no row (and must not fake one).
        ledgered = not dry_run
        if ledgered:
            try:
                with store.write() as conn:
                    conn.execute(
                        "INSERT INTO wisdom_job_runs(run_id, job_id, due_key, started_at, status, forced, dry_run) "
                        "VALUES (?, ?, NULL, ?, 'running', ?, 0)",
                        (ctx.run_id, ctx.job_id, started, int(force)))
                    heartbeat.beat(conn, ctx.job_id, "running", now_iso=started)
            except Exception:
                ledgered = False
        try:
            result = pipeline.run_daily(ctx)
            outcome = {"status": "ok", "result": result}
        except Exception as exc:
            outcome = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"[:2000]}
        finished = timeutil.iso_et(timeutil.now_et())
        if ledgered:
            try:
                with store.write() as conn:
                    conn.execute(
                        "UPDATE wisdom_job_runs SET finished_at = ?, status = ?, result_json = ?, error = ? "
                        "WHERE run_id = ?",
                        (finished, outcome["status"], json.dumps(outcome.get("result"), default=str)[:20000],
                         outcome.get("error"), ctx.run_id))
                    heartbeat.beat(conn, ctx.job_id, "ok" if outcome["status"] == "ok" else "failed",
                                   error=outcome.get("error"), now_iso=finished)
            except Exception:
                pass
        outcome.update({"run_id": ctx.run_id, "dry_run": dry_run, "force": force, "started_at": started,
                        "finished_at": finished, "ledgered": ledgered})
        with _RUN_LOCK:
            _STATE["last"] = outcome
            _STATE["running"] = False

    try:
        threading.Thread(target=_go, name="wisdom-evals-run", daemon=True).start()
    except Exception:
        with _RUN_LOCK:
            _STATE["running"] = False
        raise
    return {"started": True, "run_id": ctx.run_id, "dry_run": dry_run, "force": force}


@router.get("/run/last")
def evals_run_last(_admin: dict = Depends(require_admin)) -> dict:
    with _RUN_LOCK:
        return {"running": _STATE["running"], "last": _STATE["last"]}
