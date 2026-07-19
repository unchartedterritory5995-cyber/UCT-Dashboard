"""bars router — thin HTTP layer over api.services.bars_fetch.

All actual fetch/cache/dedup logic lives in bars_fetch so the worker
service can import it without dragging in FastAPI router decorators.
This file only owns route registration."""

import os
import threading as _threading
import time as _time
from datetime import datetime

from fastapi import APIRouter, Body, HTTPException, Query, Request
# ORJSONResponse: ~7-8x faster serialize than stdlib on the shared event loop +
# NaN/Inf -> null (stdlib emits invalid `NaN` tokens that crash client JSON.parse).
# Aliased as JSONResponse so the index-bars response and the 503 error paths below
# upgrade with no call-site change. Matches api/services/bars_fetch.py.
from fastapi.responses import ORJSONResponse as JSONResponse

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

# Cash-settled indexes (SPX, NDX, VIX, RUT, DJX, XSP, XND) — Schwab's
# /pricehistory silently returns empty for these, so route through yfinance.
# See api/index_bars.py for the symbol map and divisor logic.
from api.index_bars import is_index, fetch_index_bars

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
    bars: int = Query(default=200, ge=1, le=60000, description="Max bars to return"),
    since: str = Query(default="", description="Return only bars with t > since (browser delta sync)"),
):
    """Return OHLCV bars for client-side charting (Lightweight Charts v5).

    Cache hierarchy: memory → SQLite (delta-updated) → disk fallback → Massive API.

    When `since` is provided (browser already has bars up to that timestamp),
    only newer bars are returned — drastically smaller payloads on repeat visits.
    """
    import logging
    import time as _time
    import traceback
    from api.services.bars_fetch import get_serve_layer
    _log = logging.getLogger(__name__)
    _t0 = _time.perf_counter()
    response = None
    try:
        try:
            # Schwab /pricehistory doesn't serve cash-settled indexes — silently
            # returns empty bar arrays for SPX/NDX/VIX/RUT/DJX/XSP/XND. Route
            # these through yfinance instead (SPX → ^GSPC, etc.). Equity and ETF
            # tickers (SPY, TSLA, AAPL, ...) fall through to the existing Schwab
            # path unchanged.
            if is_index(ticker):
                since_int = None
                if since:
                    try:
                        s = int(since)
                        # /api/bars accepts `since` in both seconds and ms across
                        # call sites; index_bars normalizes to seconds. Threshold
                        # at 10^10 (≈ year 2286 in seconds, but Jan 1971 in ms).
                        since_int = s // 1000 if s > 10_000_000_000 else s
                    except ValueError:
                        since_int = None
                data = fetch_index_bars(ticker, tf, bars, since_int)
                response = JSONResponse(content=data)
            elif since:
                response = _get_bars_since_response(ticker, tf, bars, since)
            else:
                response = _get_bars_inner(ticker, tf, bars)
        except Exception as e:
            _log.error(f"[bars] CRASH {ticker} tf={tf}: {e}\n{traceback.format_exc()}")
            # Return 503 (not 200 + empty bars) so the frontend treats the failure
            # as transient and retries with backoff, keeping any last-known IDB
            # bars on screen instead of blanking the chart. The dominant cause is
            # the SQLite inode swap during data_sync.force_resync (R2 snapshot
            # pull at startup if PRAGMA integrity_check fails) — every read for
            # 30s+ throws until the epoch bump lands. Empty payloads previously
            # poisoned every chart with `bars=[]`, indistinguishable from "no
            # data exists." 503 + Retry-After preserves the distinction.
            response = JSONResponse(
                status_code=503,
                content={"ticker": ticker.upper(), "tf": tf, "bars": [], "error": "transient"},
            )
            response.headers["Retry-After"] = "5"

        # Bars data must never be served from a stale browser/CDN cache. Server-side
        # caching (memory + SQLite + disk) handles correctness; HTTP-layer caching
        # would re-introduce phantom OHLC bars after a corruption fix ships.
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        # Server-Timing: expose server-compute ms + which cache tier served, so
        # cold vs warm (and cold-fetch vs inflight-wait vs disk) is observable in
        # prod devtools / curl — the cold path was previously unmeasured. Cheap:
        # one perf_counter diff + a thread-local read. `dur` is milliseconds.
        try:
            _dur_ms = (_time.perf_counter() - _t0) * 1000.0
            response.headers["Server-Timing"] = (
                f'bars;desc="{get_serve_layer()}";dur={_dur_ms:.1f}'
            )
        except Exception:
            pass
        return response
    except Exception as outer_e:
        # Belt-and-suspenders: ensure no exception ever leaks past this handler
        # as a bare Starlette "Internal Server Error" 500. A leak here means
        # the inner except itself failed (e.g. JSONResponse construction race,
        # response.headers assignment on a partially-built object) — the SWR
        # retry path treats 5xx as transient, but 500 with plain-text body
        # was indistinguishable to operators from a real backend bug. 503 +
        # Retry-After keeps the recovery path the same as the inner except.
        _log.error(
            f"[bars] OUTER-CRASH {ticker} tf={tf}: "
            f"{type(outer_e).__name__}: {outer_e}\n{traceback.format_exc()}"
        )
        fallback = JSONResponse(
            status_code=503,
            content={"ticker": ticker.upper(), "tf": tf, "bars": [], "error": "transient"},
        )
        fallback.headers["Retry-After"] = "5"
        fallback.headers["Cache-Control"] = "no-store, must-revalidate"
        return fallback


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


@router.get("/api/admin/reconciliation-status")
def reconciliation_status():
    """Return current state of the bars-reconciliation worker (no auth — read-only).

    Shows cycles completed, audits run, drift detected, rows auto-healed, plus
    the rolling ring buffer of the last 30 drift events. Use this to verify
    the safety net is alive AND to see at a glance which tickers/timeframes
    have been drifting (a cluster of failures on one tf is a signal to investigate
    that code path)."""
    from api.services import bars_reconciliation
    return bars_reconciliation.get_state()


@router.get("/api/admin/bars-stream-status")
def bars_stream_status():
    """Push-feed (Phase C) health (no auth — read-only). The ONLY way to answer, without an
    SSH: is the Massive WS connected, how many (sym,tf) are fanning out, is anyone subscribed,
    and — the key signal — is it actually EMITTING (bars_emitted_total climbing / last_emit_age
    small) vs silently dead while users invisibly fell back to Finnhub. `bars_dropped_total` > 0
    = slow-consumer data loss. `enabled=false` = the whole rail is off (STREAM_BARS_ENABLED)."""
    enabled = os.environ.get("STREAM_BARS_ENABLED") == "1"
    out = {"enabled": enabled}
    if not enabled:
        return out
    try:
        from api.services.bar_broadcaster import get_broadcaster
        out["broadcaster"] = get_broadcaster().get_status()
    except Exception as e:  # noqa: BLE001
        out["broadcaster_error"] = str(e)[:200]
    try:
        from api.services import bar_stream
        out["websocket"] = bar_stream.get_status()
    except Exception as e:  # noqa: BLE001
        out["websocket_error"] = str(e)[:200]
    return out


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


@router.post("/api/admin/ticker-liveness")
def ticker_liveness_endpoint(request: Request, payload: dict = Body(...)):
    """Return {sym: bool} — is each ticker still trading, per Massive?

    The reliable liveness oracle for the theme-curation tool: it splits a theme
    holding that is absent from cap_universe into 'delisted' (drop/remap) vs
    'live but cap_universe just lacks it' (add to cap_universe). Local data
    sources (Finnhub /quote, yfinance, Finviz) are unreliable at scale — Massive
    is the dashboard's authoritative feed but its key is Railway-only, so this
    thin endpoint exposes the check.

    A ticker is 'live' when Massive's rich snapshot returns it with price > 0
    (day close, last trade, or — weekend-safe — prev-day close). Genuinely
    delisted names are absent from the current-market snapshot entirely.

    Body: {"tickers": ["AAPL", "AYX", ...]} (app/hyphen form).
    Returns: {"live": {"AAPL": true, "AYX": false, ...}, "checked": N}.
    Auth: Bearer PUSH_SECRET. Read-only, but Massive calls aren't free, so gated.
    """
    _check_admin_auth(request)
    syms = payload.get("tickers") if isinstance(payload, dict) else None
    if not isinstance(syms, list):
        raise HTTPException(status_code=400, detail='body must be {"tickers": [...]}')
    from api.services import massive
    uniq = list(dict.fromkeys(s.upper() for s in syms if isinstance(s, str) and s))
    live: dict[str, bool] = {s: False for s in uniq}
    client = massive._get_client()
    BATCH = 100
    for i in range(0, len(uniq), BATCH):
        window = uniq[i:i + BATCH]
        to_app = {massive.to_polygon_symbol(s): s for s in window}   # massive(dot) -> app
        try:
            snap = client.get_batch_rich_snapshots(list(to_app)) or {}
        except Exception:
            continue
        for msym, row in snap.items():
            app = to_app.get(str(msym).upper())
            if not app:
                continue
            price = (row or {}).get("price")
            try:
                if price and float(price) > 0:
                    live[app] = True
            except (TypeError, ValueError):
                pass
    return {"live": live, "checked": len(uniq)}


@router.post("/api/admin/refresh-bars-all")
def refresh_bars_all_endpoint(
    request: Request,
    tf: str | None = Query(default=None,
        description="Optional timeframe to limit the wipe; omit for ALL timeframes"),
    confirm: str = Query(default="",
        description='Required confirmation token. Pass confirm="WIPE_EVERYTHING" to proceed.'),
):
    """Nuclear option: wipe ALL cached bars across the entire universe.

    Used after a systemic cache corruption event (e.g., today's incident
    where the >= fix is shipped but existing cache still contains stale
    pre-fix data). Clears every (ticker, tf) row from SQLite + every
    bars_cache JSON file + every in-memory cache key. Next user request
    on each chart triggers a fresh fetch from upstream which populates
    correctly under the new code paths.

    Cost: cache rebuild takes ~30 minutes as users browse, with each
    chart's first load slow. Acceptable trade for systemic clean state
    when the alternative is per-ticker manual refresh across hundreds
    of affected charts.

    Auth: Bearer PUSH_SECRET. Plus a confirm=WIPE_EVERYTHING query
    parameter as a second-factor against fat-fingering — this endpoint
    will trash an active production cache, the friction is intentional.
    """
    _check_admin_auth(request)
    if confirm != "WIPE_EVERYTHING":
        raise HTTPException(
            status_code=400,
            detail=(
                "Refusing to wipe without confirmation. Pass "
                "?confirm=WIPE_EVERYTHING to proceed. This is destructive."
            ),
        )

    from api.services import bars_sqlite as _bs
    from api.services.cache import cache as _mem
    import logging as _log
    import os as _os
    _logger = _log.getLogger(__name__)

    # Each layer is wrapped in its own try/except so a failure in one
    # doesn't sink the whole operation. The most common failure mode is
    # SQLite lock contention under heavy concurrent reads from chart
    # loads — we report what succeeded vs what didn't and let the
    # operator retry the failed parts.
    result = {
        "tf": tf or "ALL",
        "sqlite_rows_deleted": None,
        "sqlite_error": None,
        "disk_files_deleted": 0,
        "disk_error": None,
        "memory_keys_deleted": 0,
        "memory_error": None,
    }

    # SQLite — wipe via DROP/recreate on a one-off connection so we're
    # not bound by the thread-local connection's busy_timeout. DROP is
    # also dramatically faster than DELETE on a large ohlcv table (it
    # frees the pages instead of scanning + per-row deleting them).
    try:
        import sqlite3 as _sqlite3
        db_path = _os.path.join(_os.environ.get("DATA_DIR", "/data"), "bars.db")
        c = _sqlite3.connect(db_path, timeout=30)
        try:
            c.execute("PRAGMA busy_timeout=30000")  # 30s for this one op
            if tf is None:
                # Drop and recreate from scratch (fastest)
                row = c.execute("SELECT COUNT(*) FROM ohlcv").fetchone()
                row_count = row[0] if row else 0
                c.execute("DROP TABLE IF EXISTS ohlcv")
                c.commit()
                result["sqlite_rows_deleted"] = row_count
            else:
                # Targeted delete by tf
                cur = c.execute("DELETE FROM ohlcv WHERE tf=?", (tf,))
                c.commit()
                result["sqlite_rows_deleted"] = cur.rowcount
        finally:
            c.close()
        # Re-init so fresh connections see the table on next request.
        try:
            _bs.init_db()
        except Exception as _e:
            _logger.exception(f"[refresh-all] init_db after wipe failed: {_e}")
        # Bump epoch so all thread-local connections refresh against the
        # newly-recreated table on next use (otherwise they'd hold stale
        # handles to the dropped one).
        try:
            _bs.bump_db_epoch()
        except Exception:
            pass
    except Exception as e:
        _logger.exception(f"[refresh-all] sqlite wipe failed: {e}")
        result["sqlite_error"] = f"{type(e).__name__}: {e}"

    # Disk cache: walk the bars_cache directory, remove every JSON file.
    try:
        cache_dir = _os.path.join(_os.environ.get("DATA_DIR", "/data"), "bars_cache")
        if _os.path.isdir(cache_dir):
            for name in _os.listdir(cache_dir):
                if not name.endswith(".json"):
                    continue
                if tf is not None:
                    parts = name[:-5].split("_")
                    if len(parts) < 3 or parts[1] != tf:
                        continue
                try:
                    _os.remove(_os.path.join(cache_dir, name))
                    result["disk_files_deleted"] += 1
                except OSError:
                    pass
    except Exception as e:
        _logger.exception(f"[refresh-all] disk wipe failed: {e}")
        result["disk_error"] = f"{type(e).__name__}: {e}"

    # In-memory cache.
    try:
        result["memory_keys_deleted"] = _mem.delete_prefix("bars_")
        # Clear deep-history "complete" markers too — otherwise a wiped ticker
        # would serve its (now empty) SQLite rows as if they were full history.
        _mem.delete_prefix("histfull_")
    except Exception as e:
        result["memory_error"] = f"{type(e).__name__}: {e}"

    result["next_steps"] = (
        "Cache wiped. Next user requests trigger fresh fetches from "
        "upstream (Polygon canonical via Massive). Expect 30+ minute "
        "rebuild as charts are visited; first-loads are slow during "
        "that window. Re-run any chart that still looks wrong."
    )
    return result


@router.post("/api/admin/refresh-bars/{ticker}")
def refresh_bars_endpoint(
    ticker: str,
    request: Request,
    tf: str | None = Query(default=None,
        description="Optional timeframe; omit to wipe ALL timeframes for the ticker"),
):
    """Surgical refresh: wipe a ticker's cached bars across all three
    cache layers (SQLite, disk JSON, in-memory) so the next user request
    triggers a clean re-fetch from upstream.

    This is the operator hammer for "this chart is wrong, fix it now."
    The audit endpoint tells you what's broken; this endpoint fixes it.
    Pair them in a workflow:
      1. ``GET  /api/admin/audit-bars/SMCI?tf=30`` → confirms drift
      2. ``POST /api/admin/refresh-bars/SMCI?tf=30`` → wipes the cache
      3. user reloads chart → fetch path repopulates from canonical
      4. ``GET  /api/admin/audit-bars/SMCI?tf=30`` → confirms clean

    Auth: Bearer PUSH_SECRET. Idempotent — calling twice is fine, second
    call just deletes nothing.

    Returns a per-layer count of what was wiped, so an operator can
    verify the refresh actually had something to clean up."""
    _check_admin_auth(request)
    from api.services import bars_sqlite as _bs
    from api.services import bars_disk_cache as _disk
    from api.services.cache import cache as _mem

    sqlite_deleted = _bs.delete_bars(ticker=ticker, tf=tf)
    disk_deleted = _disk.delete(ticker=ticker, tf=tf)

    # In-memory cache keys: ``bars_{TICKER}_{tf}_{bars_count}``. We don't
    # know which bar-counts were cached, so wipe by prefix. If tf is
    # omitted, wipe every tf for the ticker (prefix is short enough).
    ticker_up = ticker.upper()
    mem_prefix = f"bars_{ticker_up}_{tf}_" if tf else f"bars_{ticker_up}_"
    mem_deleted = _mem.delete_prefix(mem_prefix)
    # Also clear the deep-history "complete" marker so a re-fetch actually
    # re-pulls full history instead of trusting the now-wiped SQLite rows.
    _mem.delete_prefix(f"histfull_{ticker_up}_{tf}" if tf else f"histfull_{ticker_up}_")

    return {
        "ticker": ticker_up,
        "tf": tf or "ALL",
        "sqlite_rows_deleted": sqlite_deleted,
        "disk_files_deleted": disk_deleted,
        "memory_keys_deleted": mem_deleted,
        "next_steps": (
            "Reload the chart (or call /api/bars/{ticker} directly) to "
            "trigger fresh fetch from upstream. Verify with "
            f"GET /api/admin/audit-bars/{ticker_up}"
        ),
    }
