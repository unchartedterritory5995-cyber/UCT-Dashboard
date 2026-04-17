"""OHLCV bar data endpoint — serves JSON bars for client-side charting (Lightweight Charts v5).

Daily/Weekly: Massive API (Polygon-compatible) via get_agg_bars()
Intraday (5/30/60 min): Massive API agg endpoint (yfinance fallback)

3-layer cache: in-memory TTLCache → persistent disk → Massive API
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Query
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

    # Layer 2: Persistent disk cache (fast — ~10ms, survives restarts)
    # For intraday, verify cached data has recent bars (not hours-old stale data)
    disk_cached = disk_cache.get(ticker_up, tf, bars)
    if disk_cached is not None:
        if tf in ("1", "5", "15", "30", "60"):
            # Intraday freshness check: only during market hours (Mon-Fri 9:30-16:00 ET)
            # Outside market hours, serve cached data (it won't change until next session)
            import time as _time
            from datetime import datetime as _dt
            from zoneinfo import ZoneInfo as _ZI
            _now_et = _dt.now(_ZI("America/New_York"))
            _is_market = (_now_et.weekday() < 5
                          and _now_et.hour >= 9 and _now_et.hour < 16
                          and not (_now_et.hour == 9 and _now_et.minute < 30))
            if _is_market:
                _max_age_min = {"5": 10, "30": 45, "60": 90}.get(tf, 60)
                cached_bars = disk_cached.get("bars", [])
                if cached_bars:
                    last_ts = cached_bars[-1].get("t", 0)
                    age_min = (_time.time() - last_ts) / 60
                    if age_min > _max_age_min:
                        disk_cached = None  # Too stale for live market — fetch fresh
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
