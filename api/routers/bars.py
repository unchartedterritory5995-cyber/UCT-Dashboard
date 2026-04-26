"""OHLCV bar data endpoint — serves JSON bars for client-side charting (Lightweight Charts v5).

8 timeframes: 1min, 5min, 15min, 30min, 60min, Daily, Weekly, Monthly
Intraday: Massive API primary → FMP fallback → yfinance fallback
Daily/Weekly: Massive API via get_agg_bars()
Monthly: Massive daily bars resampled to monthly

Cache hierarchy: in-memory TTLCache → deep cache (S3 minute resampled) → disk cache → API
"""
import json as _json
import os as _os
import threading as _threading
import time as _time
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from api.services.cache import cache
from api.services import bars_disk_cache as disk_cache
from api.services.massive import _get_client, _REST_BASE

router = APIRouter()

# yfinance period/interval config — Yahoo limits: 1m=7d, 5m=60d, 15m=60d, 30m=60d, 60m=730d
_YF_CONFIG = {
    '1':  {'period': '7d',   'interval': '1m'},
    '5':  {'period': '60d',  'interval': '5m'},
    '15': {'period': '60d',  'interval': '15m'},
    '30': {'period': '60d',  'interval': '30m'},
    '60': {'period': '730d', 'interval': '60m'},
}

# Ticker overrides for yfinance
_YF_TICKERS = {'VIX': '^VIX', 'BTC': 'BTC-USD'}

# In-memory cache TTLs by timeframe (seconds)
# Intraday kept very short so charts stay current during market hours
_CACHE_TTL = {'1': 5, '5': 10, '15': 10, '30': 10, '60': 10, 'D': 300, 'W': 900, 'M': 900}


def _resample_weekly(daily_bars: list[dict]) -> list[dict]:
    """Resample daily bars to weekly (ISO week grouping)."""
    if not daily_bars:
        return []
    weeks = {}
    for bar in daily_bars:
        # bar["t"] is unix ms from Massive
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        key = dt.isocalendar()[:2]  # (year, week)
        if key not in weeks:
            weeks[key] = {
                "dt": dt, "o": bar["o"], "h": bar["h"],
                "l": bar["l"], "c": bar["c"], "v": bar.get("v", 0),
            }
        else:
            w = weeks[key]
            w["h"] = max(w["h"], bar["h"])
            w["l"] = min(w["l"], bar["l"])
            w["c"] = bar["c"]
            w["v"] = w["v"] + bar.get("v", 0)
    result = []
    for w in sorted(weeks.values(), key=lambda x: x["dt"]):
        result.append({
            "t": w["dt"].strftime("%Y-%m-%d"),
            "o": w["o"], "h": w["h"], "l": w["l"], "c": w["c"], "v": w["v"],
        })
    return result


def _fetch_intraday_massive(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars from Massive API agg endpoint.

    Lookback scales with max_bars to support up to 5000 intraday bars.
    5min  ~78 bars/day → 5000 bars ≈ 65 trading days → 90 calendar days
    30min ~13 bars/day → 5000 bars ≈ 385 trading days → 540 calendar days
    60min ~7 bars/day  → 5000 bars ≈ 715 trading days → 1000 calendar days
    """
    multiplier = int(tf)  # 5, 30, or 60
    # Account for extended hours (~16hr/day) to avoid oversized API responses.
    # Cap lookback to prevent oversized responses from Railway.
    # 1min: 10 days (960 bars/day), 5min: 44 days, 15min/30min/60min: up to 2 years
    bars_per_day = (16 * 60) // multiplier
    max_lookback = {1: 10, 5: 90, 15: 90}.get(multiplier, 730)
    lookback_days = min(max_lookback, max(10, int(max_bars / max(bars_per_day, 1) * 1.5) + 5))
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    from_date = (datetime.utcnow() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{ticker.upper()}/range/{multiplier}/minute"
            f"/{from_date}/{to_date}"
            f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        data = client._get(url)
        results = data.get("results") or []
        if not results:
            return []
        bars = []
        for bar in results:
            bars.append({
                "t": int(bar["t"] / 1000),  # ms → unix seconds for LW Charts UTCTimestamp
                "o": round(bar["o"], 2),
                "h": round(bar["h"], 2),
                "l": round(bar["l"], 2),
                "c": round(bar["c"], 2),
                "v": int(bar.get("v", 0)),
            })
        return bars[-max_bars:]
    except Exception:
        return []


def _fetch_intraday_fmp(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars from FMP (paid tier). Reliable, no rate limits."""
    import os, urllib.request
    fmp_key = os.environ.get("FMP_API_KEY", "")
    if not fmp_key:
        return []
    interval_map = {'1': '1min', '5': '5min', '15': '15min', '30': '30min', '60': '1hour'}
    interval = interval_map.get(tf)
    if not interval:
        return []
    try:
        url = f"https://financialmodelingprep.com/stable/historical-chart/{interval}?symbol={ticker.upper()}&apikey={fmp_key}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            import json as _json
            data = _json.loads(resp.read().decode("utf-8"))
        if not isinstance(data, list) or not data:
            return []
        bars = []
        for bar in reversed(data):  # FMP returns newest first
            try:
                dt = datetime.strptime(bar["date"], "%Y-%m-%d %H:%M:%S")
                bars.append({
                    "t": int(dt.timestamp()),
                    "o": round(float(bar["open"]), 2),
                    "h": round(float(bar["high"]), 2),
                    "l": round(float(bar["low"]), 2),
                    "c": round(float(bar["close"]), 2),
                    "v": int(bar.get("volume", 0)),
                })
            except (KeyError, ValueError):
                continue
        return bars[-max_bars:]
    except Exception:
        return []


def _fetch_intraday_yfinance(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars from yfinance (fallback). Includes premarket + after-hours."""
    import yfinance as yf
    config = _YF_CONFIG.get(tf)
    if not config:
        return []
    yf_sym = _YF_TICKERS.get(ticker.upper(), ticker.upper())
    try:
        df = yf.Ticker(yf_sym).history(
            period=config["period"], interval=config["interval"],
            prepost=True,  # Include premarket (4-9:30 AM) + after-hours (4-8 PM)
        )
        if df.empty:
            return []
        # Strip timezone
        if df.index.tzinfo is not None:
            df.index = df.index.tz_localize(None)
        bars = []
        for ts, row in df.iterrows():
            bars.append({
                "t": int(ts.timestamp()),  # unix seconds for LW Charts UTCTimestamp
                "o": round(row["Open"], 2),
                "h": round(row["High"], 2),
                "l": round(row["Low"], 2),
                "c": round(row["Close"], 2),
                "v": int(row.get("Volume", 0)),
            })
        return bars[-max_bars:]
    except Exception:
        return []


def _is_intraday_stale(bars: list[dict], max_age_days: int = 5) -> bool:
    """Check if intraday bars are stale (last bar older than max_age_days).

    Catches cases where Massive returns pre-split data that stops months/years ago.
    5-day window handles 3-day holiday weekends (Thu close → Mon = ~4 days).
    """
    if not bars:
        return True
    last_ts = bars[-1]["t"]  # unix seconds
    age_days = (datetime.utcnow().timestamp() - last_ts) / 86400
    return age_days > max_age_days


def _fetch_intraday(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars — Massive primary, FMP + yfinance fallbacks.

    All intraday TFs: Massive API → FMP → yfinance → empty.
    """
    bars = _fetch_intraday_massive(ticker, tf, max_bars)
    if bars and not _is_intraday_stale(bars):
        return bars

    # Massive failed or stale — try FMP (paid, reliable)
    fmp_bars = _fetch_intraday_fmp(ticker, tf, max_bars)
    if fmp_bars and not _is_intraday_stale(fmp_bars):
        return fmp_bars

    # FMP failed — try yfinance (split-adjusted + premarket)
    yf_bars = _fetch_intraday_yfinance(ticker, tf, max_bars)
    if yf_bars:
        return yf_bars

    # Return whatever we had (stale > nothing)
    return bars or []


def _fetch_daily(ticker: str, max_bars: int) -> list[dict]:
    """Fetch daily bars from Massive API."""
    from api.services.massive import get_agg_bars
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    # ~1.5 calendar days per trading day, capped at 30 years to avoid strftime crash
    lookback = min(int(max_bars * 1.5) + 30, 10950)
    from_date = (datetime.utcnow() - timedelta(days=lookback)).strftime("%Y-%m-%d")
    raw = get_agg_bars(ticker.upper(), from_date, to_date)
    bars = []
    for bar in raw[-max_bars:]:
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        bars.append({
            "t": dt.strftime("%Y-%m-%d"),  # BusinessDay format for LW Charts
            "o": round(bar["o"], 2),
            "h": round(bar["h"], 2),
            "l": round(bar["l"], 2),
            "c": round(bar["c"], 2),
            "v": int(bar.get("v", 0)),
        })
    return bars


def _fetch_weekly(ticker: str, max_bars: int) -> list[dict]:
    """Fetch weekly bars — daily from Massive, resampled to weekly."""
    from api.services.massive import get_agg_bars
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    lookback = min(max_bars * 8, 10950)
    from_date = (datetime.utcnow() - timedelta(days=lookback)).strftime("%Y-%m-%d")
    raw = get_agg_bars(ticker.upper(), from_date, to_date)
    weekly = _resample_weekly(raw)
    return weekly[-max_bars:]


def _resample_monthly(daily_bars: list[dict]) -> list[dict]:
    """Resample daily bars to monthly (year-month grouping)."""
    if not daily_bars:
        return []
    months = {}
    for bar in daily_bars:
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        key = (dt.year, dt.month)
        if key not in months:
            months[key] = {
                "dt": dt.replace(day=1), "o": bar["o"], "h": bar["h"],
                "l": bar["l"], "c": bar["c"], "v": bar.get("v", 0),
            }
        else:
            m = months[key]
            m["h"] = max(m["h"], bar["h"])
            m["l"] = min(m["l"], bar["l"])
            m["c"] = bar["c"]
            m["v"] = m["v"] + bar.get("v", 0)
    result = []
    for m in sorted(months.values(), key=lambda x: x["dt"]):
        result.append({
            "t": m["dt"].strftime("%Y-%m-%d"),
            "o": m["o"], "h": m["h"], "l": m["l"], "c": m["c"], "v": m["v"],
        })
    return result



def _fetch_monthly(ticker: str, max_bars: int) -> list[dict]:
    """Fetch monthly bars — daily from Massive, resampled to monthly."""
    from api.services.massive import get_agg_bars
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    lookback = min(max_bars * 35, 10950)  # ~35 calendar days per month
    from_date = (datetime.utcnow() - timedelta(days=lookback)).strftime("%Y-%m-%d")
    raw = get_agg_bars(ticker.upper(), from_date, to_date)
    monthly = _resample_monthly(raw)
    return monthly[-max_bars:]


@router.get("/api/bars/{ticker}")
def get_bars(
    ticker: str,
    tf: str = Query(default="D", description="Timeframe: 5, 30, 60, D, W"),
    bars: int = Query(default=200, ge=1, le=10000, description="Max bars"),
):
    """Return OHLCV bars for client-side charting.

    3-layer cache: memory (~5min) → disk (~4hr) → Massive API (~4-8s).
    """
    try:
        return _get_bars_inner(ticker, tf, bars)
    except Exception as e:
        import logging, traceback
        logging.getLogger(__name__).error(f"[bars] CRASH {ticker} tf={tf}: {e}\n{traceback.format_exc()}")
        return JSONResponse(content={"ticker": ticker.upper(), "tf": tf, "bars": []})


# Background cache warmer — used by other routers to pre-populate /api/bars
# cache before the client requests it (e.g. when a breadth drill list is
# fetched, warm the top tickers' Daily bars so chart loads are instant).
from concurrent.futures import ThreadPoolExecutor as _BarsWarmExecutor
_bars_warm_pool = _BarsWarmExecutor(max_workers=4, thread_name_prefix="bars-warm")


def warm_bars_async(tickers: list[str], tf: str = "D", bars: int = 5000) -> None:
    """Fire-and-forget cache warmer. Submits one task per ticker to a bounded
    thread pool and returns immediately. Errors are silenced (best-effort).

    Caller should pass a SHORT list (≤30) to avoid swamping the upstream API.
    """
    if not tickers:
        return

    def _warm_one(t: str) -> None:
        try:
            _get_bars_inner(t, tf, bars)
        except Exception:
            pass  # warming is best-effort; don't poison the executor

    seen: set[str] = set()
    for t in tickers:
        if not t or t in seen:
            continue
        seen.add(t)
        try:
            _bars_warm_pool.submit(_warm_one, t)
        except RuntimeError:
            # Executor shut down (app stopping) — drop silently
            return


# ─── Universe warm: scheduled bulk pre-cache ──────────────────────────────────
# State for the long-running universe warm. Tracked in module globals so the
# admin endpoint can return live progress and prevent overlapping runs.
_warm_state = {
    "running": False,
    "started_at": None,
    "total": 0,
    "done": 0,
    "skipped": 0,
    "errors": 0,
    "tf": None,
    "started_iso": None,
    "completed_iso": None,
}
_warm_state_lock = _threading.Lock()


def _build_universe_ticker_list() -> list[str]:
    """Build the combined ticker list to warm: priority + breadth-list + cap-universe."""
    PRIORITY = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'NVDA', 'MSFT', 'TSLA',
                'AMZN', 'META', 'GOOGL', 'AMD', 'AVGO', 'SMCI', 'PLTR', 'ARM',
                'COIN', 'MSTR', 'HOOD', 'ANET', 'NFLX', 'CRM', 'ORCL', 'UBER']
    seen: set[str] = set()
    out: list[str] = []
    for t in PRIORITY:
        if t not in seen:
            seen.add(t)
            out.append(t)

    # Breadth-list tickers next (most-likely to be drilled today)
    try:
        from api.services import breadth_monitor as _bm
        latest = _bm.get_latest()
        if latest:
            for k, v in latest.items():
                if not k.endswith('_list') or not isinstance(v, list):
                    continue
                for item in v:
                    if isinstance(item, dict):
                        sym = item.get('t')
                        if sym and sym.upper() not in seen:
                            seen.add(sym.upper())
                            out.append(sym.upper())
    except Exception:
        pass

    # Full $300M+ cap universe last
    try:
        cap_path = _os.path.join(
            _os.path.dirname(_os.path.dirname(__file__)),
            "data", "cap_universe.json",
        )
        if _os.path.exists(cap_path):
            with open(cap_path) as f:
                cap_tickers = _json.load(f)
            for t in cap_tickers:
                if t and t.upper() not in seen:
                    seen.add(t.upper())
                    out.append(t.upper())
    except Exception:
        pass

    return out


def _run_universe_warm(tickers: list[str], tf: str, bars_count: int) -> None:
    """Warm the disk cache for `tickers`. Runs in a daemon thread; updates
    _warm_state as it progresses so /api/admin/warm-universe-status can report.

    Already-cached tickers are skipped (no Massive call). Cold tickers are
    submitted to the bars-warm pool (4 workers) so live API requests aren't
    blocked. This typically completes in 1-3 hours for ~3,700 tickers.
    """
    from concurrent.futures import as_completed
    with _warm_state_lock:
        _warm_state.update({
            "running": True,
            "started_at": _time.time(),
            "started_iso": datetime.utcnow().isoformat() + "Z",
            "completed_iso": None,
            "total": len(tickers),
            "done": 0,
            "skipped": 0,
            "errors": 0,
            "tf": tf,
        })

    futures = []
    for sym in tickers:
        # Quick path: skip if disk cache already has it.
        try:
            if disk_cache.get(sym, tf, bars_count) is not None:
                with _warm_state_lock:
                    _warm_state["skipped"] += 1
                    _warm_state["done"] += 1
                continue
        except Exception:
            pass

        def _task(s=sym):
            try:
                _get_bars_inner(s, tf, bars_count)
                return True
            except Exception:
                return False

        try:
            futures.append(_bars_warm_pool.submit(_task))
        except RuntimeError:
            break  # pool shutting down

    for fut in as_completed(futures):
        try:
            ok = fut.result()
        except Exception:
            ok = False
        with _warm_state_lock:
            _warm_state["done"] += 1
            if not ok:
                _warm_state["errors"] += 1

    with _warm_state_lock:
        _warm_state["running"] = False
        _warm_state["completed_iso"] = datetime.utcnow().isoformat() + "Z"


def _check_admin_auth(request: Request) -> None:
    secret = _os.environ.get("PUSH_SECRET", "")
    if not secret:
        raise HTTPException(status_code=500, detail="PUSH_SECRET not configured")
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def _run_universe_warm_multi_tf(tickers: list[str], tfs: list[str], bars_count: int) -> None:
    """Run _run_universe_warm sequentially across multiple TFs.

    TFs are processed in priority order (Daily first, then Weekly, then
    intraday) so the most-viewed TF is hot earliest. Aggregate progress is
    reported in _warm_state.
    """
    from concurrent.futures import as_completed
    total_jobs = len(tickers) * len(tfs)
    with _warm_state_lock:
        _warm_state.update({
            "running": True,
            "started_at": _time.time(),
            "started_iso": datetime.utcnow().isoformat() + "Z",
            "completed_iso": None,
            "total": total_jobs,
            "done": 0,
            "skipped": 0,
            "errors": 0,
            "tf": ",".join(tfs),
        })

    for tf in tfs:
        futures = []
        for sym in tickers:
            try:
                if disk_cache.get(sym, tf, bars_count) is not None:
                    with _warm_state_lock:
                        _warm_state["skipped"] += 1
                        _warm_state["done"] += 1
                    continue
            except Exception:
                pass

            def _task(s=sym, t=tf):
                try:
                    _get_bars_inner(s, t, bars_count)
                    return True
                except Exception:
                    return False

            try:
                futures.append(_bars_warm_pool.submit(_task))
            except RuntimeError:
                break

        for fut in as_completed(futures):
            try:
                ok = fut.result()
            except Exception:
                ok = False
            with _warm_state_lock:
                _warm_state["done"] += 1
                if not ok:
                    _warm_state["errors"] += 1

    with _warm_state_lock:
        _warm_state["running"] = False
        _warm_state["completed_iso"] = datetime.utcnow().isoformat() + "Z"


# Default warm set: Daily first (dominant scan TF), then Weekly/Monthly for
# context, then intraday in descending order. Caller can override with ?tfs=.
_DEFAULT_WARM_TFS = ["D", "W", "M", "60", "30", "15", "5", "1"]


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


def _get_bars_inner(ticker: str, tf: str, bars: int):
    ticker_up = ticker.upper()
    cache_key = f"bars_{ticker_up}_{tf}_{bars}"

    # Layer 1: In-memory TTL cache (fastest — <1ms)
    cached = cache.get(cache_key)
    if cached is not None:
        return JSONResponse(
            content=cached,
            headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
        )

    # Layer 2: Deep cache + fresh merge for 15/30/60min
    # Deep cache has 3,400-5,000 historical bars from S3, but may be missing today.
    # Merge with fresh REST data to get full history + current session candles.
    # Layer 2: Deep cache for 15/30/60min (S3 minute data, 3,400-5,000 bars)
    if tf in ("15", "30", "60"):
        deep = disk_cache.get_deep(ticker_up, tf, bars)
        if deep is not None:
            deep_bars = deep.get("bars", [])
            last_deep_ts = deep_bars[-1]["t"] if deep_bars else 0
            # Check if deep cache is missing recent data (>4 hours old)
            import time as _time
            if (_time.time() - last_deep_ts) > 14400:
                # Fetch fresh bars from REST to cover the gap
                try:
                    fresh = _fetch_intraday(ticker_up, tf, 500)
                    if fresh:
                        # Merge: keep deep history, append fresh bars newer than deep's last
                        merged = deep_bars + [b for b in fresh if b["t"] > last_deep_ts]
                        merged = merged[-bars:]  # Trim to requested count
                        payload = {"ticker": ticker_up, "tf": tf, "bars": merged}
                        cache.set(cache_key, payload, ttl=_CACHE_TTL.get(tf, 300))
                        return JSONResponse(
                            content=payload,
                            headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
                        )
                except Exception:
                    pass
            # Deep cache is fresh enough or merge failed — serve as-is
            cache.set(cache_key, deep, ttl=_CACHE_TTL.get(tf, 300))
            return JSONResponse(
                content=deep,
                headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
            )

    # Layer 2b: Regular disk cache (for TFs without deep cache: 1min, 5min, D, W, M)
    disk_cached = disk_cache.get(ticker_up, tf, bars)
    if disk_cached is not None:
        if tf in ("1", "5", "15", "30", "60"):
            import time as _time
            from datetime import datetime as _dt
            from zoneinfo import ZoneInfo as _ZI
            _now_et = _dt.now(_ZI("America/New_York"))
            _is_market = (_now_et.weekday() < 5
                          and _now_et.hour >= 9 and _now_et.hour < 16
                          and not (_now_et.hour == 9 and _now_et.minute < 30))
            if _is_market:
                _max_age_min = {"1": 5, "5": 10, "15": 30, "30": 45, "60": 90}.get(tf, 60)
                cached_bars = disk_cached.get("bars", [])
                if cached_bars:
                    last_ts = cached_bars[-1].get("t", 0)
                    age_min = (_time.time() - last_ts) / 60
                    if age_min > _max_age_min:
                        disk_cached = None
        if disk_cached is not None:
            cache.set(cache_key, disk_cached, ttl=_CACHE_TTL.get(tf, 300))
            return JSONResponse(
                content=disk_cached,
                headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
            )

    # Layer 3: Fetch from Massive API (slow — 4-8s from Railway)
    try:
        if tf in ("1", "5", "15", "30", "60"):
            result_bars = _fetch_intraday(ticker_up, tf, bars)
        elif tf == "W":
            result_bars = _fetch_weekly(ticker_up, bars)
        elif tf == "M":
            result_bars = _fetch_monthly(ticker_up, bars)
        else:
            result_bars = _fetch_daily(ticker_up, bars)
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"[bars] Fetch failed {ticker_up} tf={tf}: {e}")
        result_bars = []

    payload = {"ticker": ticker_up, "tf": tf, "bars": result_bars}

    # Persist to both cache layers — but NEVER cache empty results
    # (empty = API error or missing data, should retry on next request)
    if result_bars:
        cache.set(cache_key, payload, ttl=_CACHE_TTL.get(tf, 300))
        disk_cache.put(ticker_up, tf, bars, payload)
    else:
        # Cache empty for only 5 seconds so retries happen quickly
        cache.set(cache_key, payload, ttl=5)

    return JSONResponse(
        content=payload,
        headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
    )
