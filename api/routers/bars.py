"""bars router — thin HTTP layer over api.services.bars_fetch.

All actual fetch/cache/dedup logic lives in bars_fetch so the worker
service can import it without dragging in FastAPI router decorators.
This file only owns route registration."""

import threading as _threading
import time as _time
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from api.services.bars_fetch import (
    # Core fetch/cache functions (used by routes below)
    _get_bars_inner,
    _get_bars_since_response,
    _fmt_sqlite_bars,
    _needs_fresh,
    _run_universe_warm,
    _run_universe_warm_multi_tf,
    _warm_state,
    _warm_state_lock,
    _check_admin_auth,
    _build_universe_ticker_list,
    _DEFAULT_WARM_TFS,
    _fetch_intraday_massive,
    _fetch_intraday_fmp,
    _fetch_intraday_yfinance,
    _session_resample_hourly,
    _is_intraday_stale,
    # Re-exported for backward compat: consumers import from api.routers.bars
    _CACHE_TTL,  # noqa: F401  — api/main.py
    warm_bars_async,  # noqa: F401  — breadth_monitor, earnings, engine_data, movers, screener, theme_performance, watchlists
)
# Re-export module for any consumer that imports `from api.routers import bars`
from api.services import bars_fetch as _bars_fetch  # noqa: F401

router = APIRouter()


@router.get("/api/bars/_debug_source/{ticker}")
def debug_source(ticker: str, tf: str = Query(default="60"), src_override: int = Query(default=0), focus_date: str = Query(default="")):
    """Diagnostic — returns which source is providing intraday data + sample bars.

    src_override: if >0, use this as the bars-to-fetch count instead of default 1000.
    focus_date: if set (YYYY-MM-DD), include all 30-min bars for that ET date and
                show what the resample produces for it.
    """
    if tf not in ("1", "5", "15", "30", "60"):
        return {"error": "intraday only"}
    src = src_override if src_override > 0 else (1000 if tf == "60" else 200)
    out = {"ticker": ticker.upper(), "tf": tf, "src_bars_requested": src}
    try:
        massive_bars = _fetch_intraday_massive(ticker, "30" if tf == "60" else tf, src)
        out["massive"] = {"count": len(massive_bars) if massive_bars else 0,
                          "stale": _is_intraday_stale(massive_bars) if massive_bars else None,
                          "first": massive_bars[0] if massive_bars else None,
                          "last": massive_bars[-1] if massive_bars else None}
    except Exception as e:
        out["massive"] = {"error": str(e)[:200]}
    try:
        fmp_bars = _fetch_intraday_fmp(ticker, "30" if tf == "60" else tf, src)
        out["fmp"] = {"count": len(fmp_bars) if fmp_bars else 0,
                      "stale": _is_intraday_stale(fmp_bars) if fmp_bars else None,
                      "last": fmp_bars[-1] if fmp_bars else None}
    except Exception as e:
        out["fmp"] = {"error": str(e)[:200]}
    try:
        yf_bars = _fetch_intraday_yfinance(ticker, "30" if tf == "60" else tf, src)
        out["yfinance"] = {"count": len(yf_bars) if yf_bars else 0,
                           "last": yf_bars[-1] if yf_bars else None}
    except Exception as e:
        out["yfinance"] = {"error": str(e)[:200]}
    if tf == "60" and out.get("massive", {}).get("count"):
        try:
            resampled = _session_resample_hourly(massive_bars)
            out["resampled_from_massive"] = {"count": len(resampled), "last5": resampled[-5:] if resampled else []}
        except Exception as e:
            out["resampled_from_massive"] = {"error": str(e)[:200]}

    # Optional: dump 30-min bars for a specific ET date so we can see exactly
    # what the resample sees vs what comes back. Useful when the OHLC/volume
    # of a hourly bar doesn't match the 30-min source.
    if focus_date and out.get("massive", {}).get("count"):
        try:
            import zoneinfo
            ET = zoneinfo.ZoneInfo("America/New_York")
            day_bars = []
            for b in massive_bars:
                dt = datetime.fromtimestamp(b["t"], tz=ET)
                if dt.strftime("%Y-%m-%d") == focus_date:
                    day_bars.append({"et": dt.strftime("%H:%M"), **b})
            # Also bucket-stamp them per resample logic
            from collections import defaultdict
            by_bucket = defaultdict(list)
            for b in massive_bars:
                dt = datetime.fromtimestamp(b["t"], tz=ET)
                if dt.strftime("%Y-%m-%d") != focus_date:
                    continue
                h, m = dt.hour, dt.minute
                if h == 9 and m >= 30:
                    bkt = int(datetime(dt.year, dt.month, dt.day, 9, 30, tzinfo=ET).timestamp())
                else:
                    bkt = int(datetime(dt.year, dt.month, dt.day, h, 0, tzinfo=ET).timestamp())
                bkt_label = datetime.fromtimestamp(bkt, tz=ET).strftime("%H:%M")
                by_bucket[bkt_label].append({"et": dt.strftime("%H:%M"), "v": b["v"], "o": b["o"], "c": b["c"]})
            out["focus_date"] = {
                "date": focus_date,
                "raw_30m_bars": day_bars,
                "bars_per_bucket": dict(by_bucket),
            }
        except Exception as e:
            out["focus_date"] = {"error": str(e)[:200]}

    return out


@router.get("/api/bars/{ticker}")
def get_bars(
    ticker: str,
    tf: str = Query(default="D", description="Timeframe: 1, 5, 15, 30, 60, D, W, M"),
    bars: int = Query(default=200, ge=1, le=10000, description="Max bars to return"),
    since: str = Query(default="", description="Return only bars with t > since (browser delta sync)"),
):
    """Return OHLCV bars for client-side charting (Lightweight Charts v5).

    Cache hierarchy: memory → SQLite (delta-updated) → disk fallback → Massive API.

    When `since` is provided (browser already has bars up to that timestamp),
    only newer bars are returned — drastically smaller payloads on repeat visits.
    """
    try:
        if since:
            return _get_bars_since_response(ticker, tf, bars, since)
        return _get_bars_inner(ticker, tf, bars)
    except Exception as e:
        import logging, traceback
        logging.getLogger(__name__).error(f"[bars] CRASH {ticker} tf={tf}: {e}\n{traceback.format_exc()}")
        return JSONResponse(content={"ticker": ticker.upper(), "tf": tf, "bars": []})


@router.post("/api/admin/warm-universe")
def warm_universe(request: Request, tf: str = None, bars: int = 5000, tfs: str = None):
    """Kick off a background warm of the full ticker universe.

    Query params:
        tf:    legacy single-TF mode (e.g. tf=D). Used if tfs is not given.
        tfs:   comma-separated list of timeframes to warm in order
               (e.g. tfs=D,W,M,60,30,15,5,1). Defaults to all 8.
        bars:  bar count per ticker (default 5000)

    Returns immediately. Poll /api/admin/warm-universe-status for progress.

    Auth: Bearer PUSH_SECRET. Idempotent — rejects with 409 if a warm is
    already in progress.
    """
    _check_admin_auth(request)

    # Resolve TF list
    if tfs:
        tf_list = [t.strip() for t in tfs.split(",") if t.strip()]
    elif tf:
        tf_list = [tf]
    else:
        tf_list = list(_DEFAULT_WARM_TFS)

    with _warm_state_lock:
        if _warm_state["running"]:
            return JSONResponse(
                status_code=409,
                content={
                    "status": "already-running",
                    "started_iso": _warm_state["started_iso"],
                    "total": _warm_state["total"],
                    "done": _warm_state["done"],
                },
            )

    tickers = _build_universe_ticker_list()
    if not tickers:
        raise HTTPException(status_code=503, detail="Universe ticker list empty — breadth_monitor.db or cap_universe.json missing?")

    _threading.Thread(
        target=_run_universe_warm_multi_tf,
        args=(tickers, tf_list, bars),
        daemon=True,
        name="warm-universe-runner",
    ).start()

    total_jobs = len(tickers) * len(tf_list)
    return {
        "status": "started",
        "tfs": tf_list,
        "bars": bars,
        "total_tickers": len(tickers),
        "total_jobs": total_jobs,
        "estimated_minutes": int(total_jobs * 5 / 4 / 60),
        "poll": "/api/admin/warm-universe-status",
    }


@router.post("/api/admin/warm-universe-stop")
def warm_universe_stop(request: Request):
    """Cancel an in-flight universe warm. Auth: Bearer PUSH_SECRET.

    Shuts down the bars-warm thread pool (cancelling pending tasks), then
    re-creates it so future warms can start cleanly. In-flight HTTP calls
    that have already been dispatched will finish — Python ThreadPoolExecutor
    can't interrupt them — but no new tasks will be picked up.
    """
    _check_admin_auth(request)
    try:
        _bars_fetch._bars_warm_pool.shutdown(wait=False, cancel_futures=True)
    except Exception:
        pass
    with _warm_state_lock:
        was_running = _warm_state.get("running", False)
        if was_running:
            _warm_state["running"] = False
            _warm_state["completed_iso"] = datetime.utcnow().isoformat() + "Z"
    # Recreate the pool so the next /api/admin/warm-universe call works
    _bars_fetch._bars_warm_pool = _bars_fetch._BarsWarmExecutor(max_workers=4, thread_name_prefix="bars-warm")
    return {"status": "stopped", "was_running": was_running}


@router.get("/api/admin/warm-universe-status")
def warm_universe_status():
    """Return current progress of the universe warmer (no auth — read-only)."""
    with _warm_state_lock:
        snap = dict(_warm_state)
    if snap["started_at"]:
        elapsed = (_time.time() - snap["started_at"]) if snap["running"] else None
        snap["elapsed_seconds"] = elapsed
        if snap["done"] > 0 and snap["total"] > 0 and snap["running"]:
            rate = snap["done"] / (_time.time() - snap["started_at"])
            remaining = (snap["total"] - snap["done"]) / max(rate, 0.001)
            snap["eta_seconds"] = int(remaining)
    return snap


@router.get("/api/admin/audit-bars/{ticker}")
def audit_bars_endpoint(
    ticker: str,
    request: Request,
    tf: str = Query(default="30"),
    bars: int = Query(default=200, ge=1, le=2000),
):
    """Diff a ticker's cached bars against Polygon canonical.

    The Phase 2C verification keystone: ad-hoc proof that any chart
    matches authoritative source-of-truth. Returns a structured diff
    (per-bar field deltas, missing-from-cache list, missing-from-
    canonical list, pass rate) so an operator can answer "is this
    chart correct, and if not, where does it diverge?".

    Auth: Bearer PUSH_SECRET (same pattern as warm-universe). Read-only
    operation but Polygon API calls aren't free, so we gate it.
    """
    _check_admin_auth(request)
    from api.services.audit import audit_ticker
    result = audit_ticker(ticker, tf, bars)
    return result.to_dict()
