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
from api import oi_snapshots
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/oi-snapshot", tags=["oi-snapshot"])


@router.post("/run")
def run_snapshot():
    """Manually trigger today's snapshot collection.
    Long-running (can take 60-120s depending on contract count) — fire and wait."""
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
