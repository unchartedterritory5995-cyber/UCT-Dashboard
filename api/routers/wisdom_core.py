"""Wisdom Loop core admin routes: job health and on-demand runs (docs/wisdom/CONTRACTS.md §2).

Every route, reads included, carries Depends(require_admin); /api/admin/wisdom is
not covered by AdminGuardMiddleware, so the dependency is the gate. On-demand
runs go to a daemon thread, never the request path (the web pod has one shared
threadpool), with a per-process overlap guard.

OWNER-PRIVATE ROUTES (D16a) carry Depends(require_owner): require_admin plus the
first ADMIN_EMAILS address, so a second admin, the smoke account and a contractor
all get 403. This module is one of the three the private-store import rail allows.
"""
from __future__ import annotations

import sqlite3
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from api.middleware.auth_middleware import require_admin
from api.services.wisdom import registry
from api.services.wisdom.core import flags, heartbeat, private, store
from api.services.wisdom.core.owner import require_owner

router = APIRouter(prefix="/api/admin/wisdom/core", tags=["wisdom"])

def _extractor_version() -> Optional[str]:
    """⚠️ Best effort: importing the prompt builds a hash over the system prompt and contract, and
    a status route must not 500 because that import is unhappy."""
    try:
        from api.services.wisdom.extract import prompt

        return prompt.extractor_version()
    except Exception:
        return None


_RUNNING: set = set()
_RUNNING_LOCK = threading.Lock()


#: R45 (2026-09-15) — the tables whose ROW COUNT the owner reads to see what the store holds.
#: ⛔ COUNTS ONLY. Never a text column, never a row: this answers "how much is in there", and the
#: only safe answer to "what is in there" is the admin review UI, which is already gated per item.
#: ⚠️ Derived-safe: a table absent on an older store reports null rather than 503ing the whole
#: route — a status endpoint that dies because one table is missing tells the owner nothing.
STATUS_COUNT_TABLES = (
    "wisdom_sources", "wisdom_segments", "wisdom_records", "wisdom_principles",
    "wisdom_principle_support", "wisdom_field_provenance", "wisdom_review_queue",
    "wisdom_eval_runs", "wisdom_extract_requests",
)


def _row_counts(conn) -> dict:
    out: dict = {}
    for table in STATUS_COUNT_TABLES:
        try:
            out[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        except sqlite3.Error:
            out[table] = None          # absent on this store; say so rather than pretend zero
    return out


def _floored_stability(conn) -> dict:
    """How the floored types are distributed across stability — the publish/block picture.

    ⛔ Counts by (record_type, stability) only. This is the number session 10 could not read for
    production because no route exposed it.
    """
    out: dict = {}
    try:
        rows = conn.execute(
            "SELECT record_type, stability, stability_runs, COUNT(*) FROM wisdom_records "
            "WHERE record_type IN ('PRINCIPLE','MARKET_SIGNAL') GROUP BY record_type, stability, "
            "stability_runs ORDER BY record_type, stability").fetchall()
    except sqlite3.Error:
        return {}
    for rtype, stability, runs, n in rows:
        key = "unscored" if stability is None else f"{stability:.4f}/{runs}"
        out.setdefault(rtype, {})[key] = n
    return out


def _records_pending(conn) -> dict:
    """R79: the PENDING count, fresh — not whatever the last nightly `score_silently` saw.
    ⚠️ Same defensive shape as `_row_counts`/`_floored_stability`: a status route must not 500
    because this one query is unhappy."""
    from api.services.wisdom.publish import floor

    try:
        return floor.records_pending_count(conn)
    except sqlite3.Error:
        return {"records_pending": None, "records_pending_by_type": {}}


@router.get("/status")
def wisdom_status(_admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            beats = {row["job_id"]: row for row in heartbeat.job_health(conn)}
            migrations = [dict(r) for r in conn.execute(
                "SELECT name, applied_at FROM wisdom_migrations ORDER BY name")]
            counts = _row_counts(conn)
            floored = _floored_stability(conn)
            pending = _records_pending(conn)
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
        # R45: what the store actually holds. Counts only — no text column is read.
        "store_counts": counts,
        "floored_stability": floored,
        # R79: unmeasured floored records — never enqueued, only counted. See floor.status().
        "records_pending": pending["records_pending"],
        "records_pending_by_type": pending["records_pending_by_type"],
        "extractor_version": _extractor_version(),
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


@router.get("/private/{record_id}")
def wisdom_private_record(record_id: str, response: Response,
                          _owner: dict = Depends(require_owner)) -> dict:
    """The owner-private fields stored for one record, decrypted. Owner only."""
    response.headers["Cache-Control"] = "no-store"
    if not private.is_configured():
        raise HTTPException(status_code=503,
                            detail="WISDOM_PRIVATE_KEY is not configured; private values cannot be read")
    try:
        fields = private.get_private(record_id, for_request=True)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom_private.db unavailable: {type(exc).__name__}")
    return {"record_id": record_id, "fields": fields, "count": len(fields)}
