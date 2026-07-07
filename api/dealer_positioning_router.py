"""
dealer_positioning_router.py — Admin endpoints for the trade-aware
dealer positioning system.

Provides three operations:
  - GET  /status         — table stats, latest date, attribution coverage
  - POST /backfill       — kick off background rebuild from existing snapshots
  - POST /compute/{date} — recompute a single date (ISO YYYY-MM-DD)

The backfill is fire-and-forget. It runs in a background thread, logging
progress as `[dealer_positioning] processing N/M  date=…`. Status can be
polled via the /status endpoint, which reports distinct date count and
total row count.

Backfill takes ~1-3 seconds per date depending on how many contracts had
flow that day. For 60 days of history with ~5K active contracts/day,
expect roughly 1-3 minutes total. Safe to run while the app serves
traffic — uses its own connection and INSERT OR REPLACE so re-runs are
idempotent.

Routing prefix is /api/dealer-positioning. Mount in main.py with:
    from api.dealer_positioning_router import router as dp_router
    app.include_router(dp_router)
"""

import threading
import logging
import sqlite3
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from api.flow_admin_auth import require_flow_admin

from api.dealer_positioning import (
    init_db,
    compute_positioning_for_date,
    backfill_all,
    DB_PATH,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dealer-positioning", tags=["dealer-positioning"])

# Module-level flag so we don't start two backfills in parallel
# (e.g. if two workers hit /backfill simultaneously). Not perfectly
# multi-worker-safe — for that you'd want the same run-state table
# pattern oi_snapshots uses — but good enough for an admin-only endpoint.
_backfill_running = False
_backfill_lock = threading.Lock()
_last_backfill_summary: Optional[dict] = None


@router.get("/status")
def status():
    """Quick stats on the dealer_positioning table.

    Returns:
      rows: total count
      distinct_dates: number of unique snap_dates covered
      latest_date: most recent snap_date present
      earliest_date: oldest snap_date present
      distinct_symbols: how many tickers we have data for
      backfill_running: whether a backfill thread is currently active
      last_backfill: summary of the most recent backfill (if any)
    """
    out = {
        "backfill_running": _backfill_running,
        "last_backfill": _last_backfill_summary,
    }
    try:
        with sqlite3.connect(DB_PATH, timeout=10.0) as c:
            c.row_factory = sqlite3.Row
            row = c.execute(
                """
                SELECT
                  COUNT(*)                       AS rows,
                  COUNT(DISTINCT snap_date)      AS distinct_dates,
                  COUNT(DISTINCT symbol)         AS distinct_symbols,
                  MIN(snap_date)                 AS earliest_date,
                  MAX(snap_date)                 AS latest_date
                FROM dealer_positioning
                """
            ).fetchone()
            out.update(dict(row) if row else {})
            # Per-symbol coverage (top 10 by row count) — useful for
            # spot-checking what we have data for.
            top = c.execute(
                """
                SELECT symbol, COUNT(*) AS n, COUNT(DISTINCT snap_date) AS days
                FROM dealer_positioning
                GROUP BY symbol
                ORDER BY n DESC
                LIMIT 10
                """
            ).fetchall()
            out["top_symbols"] = [dict(r) for r in top]
    except sqlite3.Error as e:
        out["db_error"] = str(e)
    return out


@router.post("/backfill")
def trigger_backfill(
    start: Optional[str] = Query(None, description="Optional start date ISO YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="Optional end date ISO YYYY-MM-DD"),
    _auth: dict = Depends(require_flow_admin),
):
    """Kick off backfill in a background thread. Returns immediately.

    Default range: every date present in contract_oi_snapshots.
    Pass start / end to restrict to a sub-range.

    If a backfill is already running, refuses to start a second one.
    Re-running over already-processed dates is safe (idempotent).
    """
    global _backfill_running, _last_backfill_summary

    with _backfill_lock:
        if _backfill_running:
            raise HTTPException(
                status_code=409,
                detail="backfill already running; wait or check /status",
            )
        _backfill_running = True

    def _run():
        global _backfill_running, _last_backfill_summary
        try:
            # Defensive init — backfill should be safe even if /init
            # wasn't run yet (e.g. first deploy).
            init_db()
            logger.info(
                f"[dealer_positioning] backfill thread starting "
                f"(start={start}, end={end})"
            )
            summary = backfill_all(start_iso=start, end_iso=end)
            _last_backfill_summary = {
                "finished_at": datetime.utcnow().isoformat() + "Z",
                "dates_processed": summary.get("dates_processed"),
                "start": summary.get("start"),
                "end": summary.get("end"),
                "error": summary.get("error"),
            }
            logger.info(f"[dealer_positioning] backfill done: {_last_backfill_summary}")
        except Exception as e:
            logger.exception("[dealer_positioning] backfill thread crashed")
            _last_backfill_summary = {
                "finished_at": datetime.utcnow().isoformat() + "Z",
                "error": str(e),
            }
        finally:
            _backfill_running = False

    threading.Thread(target=_run, daemon=True, name="dealer_positioning_backfill").start()
    return {
        "started": True,
        "start": start,
        "end": end,
        "message": "Backfill running in background. Poll /status for progress.",
    }


@router.post("/compute/{snap_date}")
def manual_compute(snap_date: str, _auth: dict = Depends(require_flow_admin)):
    """Recompute a single date. Format ISO (YYYY-MM-DD).

    Useful for testing changes to the attribution algorithm against a
    known day without running the full backfill. Idempotent — re-running
    the same date overwrites that day's rows.
    """
    try:
        # Validate format
        datetime.strptime(snap_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be ISO YYYY-MM-DD")

    init_db()
    summary = compute_positioning_for_date(snap_date)
    return summary


@router.get("/sample")
def sample_rows(
    symbol: str = Query(..., description="Ticker, e.g. SPY"),
    limit: int = Query(10, ge=1, le=100),
):
    """Return up to `limit` sample contract rows for a symbol.

    Useful for debugging the contract_key format — we can compare what's
    actually stored against what gex_service is looking up. Returns the
    most recent snap_date's rows ordered by oi DESC (largest contracts
    first, where mismatches matter most).
    """
    symbol = symbol.upper().strip()
    try:
        with sqlite3.connect(DB_PATH, timeout=10.0) as c:
            c.row_factory = sqlite3.Row
            rows = c.execute(
                """
                SELECT contract_key, snap_date, cp, strike, expiration, oi,
                       est_customer_net, flow_confidence
                FROM dealer_positioning
                WHERE symbol = ?
                ORDER BY snap_date DESC, oi DESC
                LIMIT ?
                """,
                (symbol, limit),
            ).fetchall()
            return {
                "symbol": symbol,
                "count": len(rows),
                "rows": [dict(r) for r in rows],
            }
    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/flow-sources")
def flow_sources(symbol: Optional[str] = Query(None, description="Optional symbol filter, e.g. SPY")):
    """Diagnostic: list distinct `source` values in the flow table with
    row counts, sample symbols, and date range per source.

    If `symbol` is provided, also reports which sources contain that
    specific symbol. Lets us figure out where SPY/QQQ live in the flow
    table when they don't appear under the default "stocks" source.

    Returns:
      sources: [{source, rows, symbols, latest_date, earliest_date, has_symbol?}]
    """
    try:
        with sqlite3.connect(DB_PATH, timeout=10.0) as c:
            c.row_factory = sqlite3.Row
            # Per-source row counts and date range
            rows = c.execute(
                """
                SELECT
                  source,
                  COUNT(*)             AS rows,
                  COUNT(DISTINCT Symbol) AS distinct_symbols,
                  MIN(CreatedDate)     AS earliest_date,
                  MAX(CreatedDate)     AS latest_date
                FROM flow
                GROUP BY source
                ORDER BY rows DESC
                """
            ).fetchall()
            sources = [dict(r) for r in rows]
            # For each source, pull a few sample symbols and (if asked)
            # check whether the specific symbol is present
            for s in sources:
                # Top 10 symbols by row count for this source
                top = c.execute(
                    """
                    SELECT Symbol, COUNT(*) AS n
                    FROM flow WHERE source = ?
                    GROUP BY Symbol ORDER BY n DESC LIMIT 10
                    """,
                    (s["source"],),
                ).fetchall()
                s["top_symbols"] = [dict(r) for r in top]
                if symbol:
                    sym = symbol.upper().strip()
                    hit = c.execute(
                        "SELECT COUNT(*) AS n FROM flow WHERE source = ? AND Symbol = ?",
                        (s["source"], sym),
                    ).fetchone()
                    s["has_" + sym] = int(hit["n"]) if hit else 0
            return {"sources": sources, "symbol_checked": symbol}
    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail=str(e))
