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
from api.services.wisdom.core import flags, store, timeutil

router = APIRouter(prefix="/api/admin/wisdom/capture", tags=["wisdom"])

_RUNNING: set = set()
_RUNNING_LOCK = threading.Lock()

# ── as_of is a bounded input (CONTRACTS §8c.1.1) ─────────────────────────────
# ⚰️ It was validated only by dt.date.fromisoformat, which accepts the year 2999.
# `as_of` is not a display string: three datasets turn it into a WATERMARK and
# every dataset turns it into an immutable R2 key. One admin call with a future
# date moved a watermark 273 days forward, after which every nightly run read
# `lo >= hi`, captured nothing, and paged P1 — for `detection_outcomes` and
# `vision` SILENTLY, because both declare pages=_PAGE_MISSING and `zero` never
# pages. There is no repair route; recovery is a hand-written UPDATE.
#
# ⛔ The bound is on BOTH sides. A future date is refused outright (the ruling).
# A date older than the backfill horizon is refused too: an ancient as_of walks
# the dataset's `last_as_of` / `last_r2_key` pointer backwards, and for a
# hash_on_change dataset that pointer is the only way a consumer finds the
# CURRENT object.
_MAX_BACKFILL_DAYS = 400


def _validated_as_of(as_of: Optional[str]) -> Optional[dt.date]:
    if as_of is None:
        return None
    try:
        requested = dt.date.fromisoformat(as_of)
    except ValueError:
        raise HTTPException(status_code=422, detail="as_of must be YYYY-MM-DD")
    today = timeutil.now_et().date()
    if requested > today:
        raise HTTPException(
            status_code=422,
            detail=f"as_of {as_of} is in the future (ET today is {today.isoformat()}); "
                   f"a future as_of would advance a watermark past every future run's window")
    if (today - requested).days > _MAX_BACKFILL_DAYS:
        raise HTTPException(
            status_code=422,
            detail=f"as_of {as_of} is more than {_MAX_BACKFILL_DAYS} days old; "
                   f"use tools/wisdom/capture_backfill.py for deep history")
    return requested


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
                       confirm: Optional[str] = Query(None),
                       _admin: dict = Depends(require_admin)) -> dict:
    """Capture one dataset. A DRY RUN reads and sizes everything and writes nothing.

    ⛔ The write variant is gated more tightly than the read (CONTRACTS §8c.1.1), because
    the two are not the same act behind one gate: a read is recoverable and a write to an
    immutable key is not.
      * `dry_run=false` additionally requires WISDOM_CAPTURE_ENABLED — the same flag the
        scheduled path honours. ⚰️ The admin route consulted NO flag at all, so "every
        WISDOM_* variable is unset" read as "nothing can write" while this route wrote R2
        objects and run rows.
      * a BACKDATED write must also carry `confirm=<as_of>`. A stray or mistyped date is
        the whole hazard class; making the caller type it twice is the cheapest possible
        second factor, and it costs an intentional backfill one extra parameter.
    """
    if families.by_name(family) is None:
        raise HTTPException(status_code=404, detail="unknown capture dataset")
    requested = _validated_as_of(as_of)
    if not dry_run:
        if not flags.capture_enabled():
            raise HTTPException(
                status_code=409,
                detail="capture writes are disabled (WISDOM_CAPTURE_ENABLED); dry_run=true still reads")
        if requested is not None and requested != timeutil.now_et().date():
            if confirm != as_of:
                raise HTTPException(
                    status_code=428,
                    detail=f"a backdated write must be confirmed: pass confirm={as_of}")
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
