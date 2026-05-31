"""
oi_snapshot_router.py — FastAPI router for OI snapshot operations.

Endpoints:
    POST /api/oi-snapshot/run         — Manually trigger today's snapshot run
    GET  /api/oi-snapshot/status      — How many snapshots captured per day (last N)
    GET  /api/oi-snapshot/lookup      — Get OI for a specific (contract, date)
    GET  /api/oi-snapshot/history     — Full OI trajectory for one contract
    POST /api/oi-snapshot/confirm     — Apply confirmation logic to a list of B-side trades

Integration in main.py:
    from api.oi_snapshot_router import router as oi_snapshot_router
    app.include_router(oi_snapshot_router)
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import date
import threading
import datetime as _dt
import logging
from api import oi_snapshots

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/oi-snapshot", tags=["oi-snapshot"])

# Track in-flight runs so we don't queue duplicates if user clicks again.
# Module-level state lives for the lifetime of the worker process.
_run_state = {"running": False, "started_at": None, "last_result": None}
_run_lock = threading.Lock()


def _run_snapshot_background():
    """Background worker. Runs the job, stashes result, clears running flag."""
    try:
        result = oi_snapshots.daily_snapshot_job()
        with _run_lock:
            _run_state["last_result"] = result
    except Exception as e:
        logger.exception("OI snapshot background run failed")
        with _run_lock:
            _run_state["last_result"] = {"error": str(e)}
    finally:
        with _run_lock:
            _run_state["running"] = False


@router.post("/run")
def run_snapshot():
    """Kick off today's snapshot in the background and return immediately.
    Long jobs (60-180s) would exceed Cloudflare's 100s edge timeout if we
    waited inline. Poll /run-status to see when it finishes."""
    with _run_lock:
        if _run_state["running"]:
            return {
                "status": "already_running",
                "started_at": _run_state["started_at"],
            }
        _run_state["running"] = True
        _run_state["started_at"] = _dt.datetime.utcnow().isoformat() + "Z"
        _run_state["last_result"] = None

    # Fire and forget — daemon thread so it doesn't block shutdown
    threading.Thread(target=_run_snapshot_background, daemon=True).start()

    return {
        "status": "started",
        "started_at": _run_state["started_at"],
        "message": "Snapshot running in background. Poll /api/oi-snapshot/run-status in ~2-3 min.",
    }


@router.get("/run-status")
def run_status():
    """Check whether the background snapshot is still running and inspect
    the result from its most recent completion."""
    with _run_lock:
        return {
            "running": _run_state["running"],
            "started_at": _run_state["started_at"],
            "last_result": _run_state["last_result"],
        }


@router.post("/run-sync")
def run_snapshot_sync():
    """Synchronous version — blocks until job finishes. Use only when called
    from inside the network (admin server-to-server, not via Cloudflare)."""
    try:
        result = oi_snapshots.daily_snapshot_job()
        return result
    except Exception as e:
        logger.exception("OI snapshot run failed")
        raise HTTPException(500, f"Snapshot job failed: {e}")


@router.get("/status")
def status(days: int = Query(7, ge=1, le=90)):
    """Snapshot counts per day for last N days."""
    return {"recent": oi_snapshots.get_status(days)}


@router.get("/lookup")
def lookup(
    sym: str,
    cp: str,
    strike: float,
    exp: str,
    snap_date: Optional[str] = None,
):
    """Look up OI for a contract on a specific date.
    If snap_date omitted, uses today."""
    if not snap_date:
        snap_date = date.today().isoformat()
    ck = oi_snapshots.make_key(sym, cp, strike, exp)
    result = oi_snapshots.get_snapshot(ck, snap_date)
    if not result:
        return {"found": False, "contract_key": ck, "date": snap_date}
    return {
        "found": True,
        "contract_key": ck,
        "date": snap_date,
        "oi": result[0],
        "source": result[1],
    }


@router.get("/history")
def history(
    sym: str,
    cp: str,
    strike: float,
    exp: str,
    days: int = Query(30, ge=1, le=180),
):
    """OI evolution for one contract over the past N days."""
    ck = oi_snapshots.make_key(sym, cp, strike, exp)
    return {"contract_key": ck, "history": oi_snapshots.get_history(ck, days)}


class ConfirmRequest(BaseModel):
    """One B-side trade to confirm."""
    trade_date: str           # 'YYYY-MM-DD'
    sym: str
    cp: str                   # 'C' / 'P' or 'CALL' / 'PUT'
    strike: float
    exp: str                  # original expiration string, e.g. '6/18/2026'
    volume: int
    side: str                 # 'B' or 'BB'
    color: str                # 'YELLOW' or 'MAGENTA'
    next_trading_day: Optional[str] = None  # optional override


class ConfirmResponse(BaseModel):
    inferred_direction: Optional[str]  # 'BULL' / 'BEAR' or None


@router.post("/confirm", response_model=List[ConfirmResponse])
def confirm_trades(trades: List[ConfirmRequest]):
    """Apply confirmation logic to a batch of B-side trades. Returns inferred
    direction for each (or None if not yet confirmable)."""
    out = []
    for t in trades:
        ck = oi_snapshots.make_key(t.sym, t.cp, t.strike, t.exp)
        d = oi_snapshots.confirm_trade_direction(
            trade_date=t.trade_date,
            contract_key=ck,
            volume=t.volume,
            side=t.side,
            color=t.color,
            cp=t.cp,
            next_trading_day=t.next_trading_day,
        )
        out.append(ConfirmResponse(inferred_direction=d))
    return out
