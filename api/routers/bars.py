"""OHLCV bar data endpoint — serves JSON bars for client-side charting (Lightweight Charts v5).

8 timeframes: 1min, 5min, 15min, 30min, 60min, Daily, Weekly, Monthly
Intraday: Massive API primary → FMP fallback → yfinance fallback
Daily/Weekly: Massive API via get_agg_bars()
Monthly: Massive daily bars resampled to monthly

Cache hierarchy:
  1. In-memory TTLCache     (<1 ms  — hot path)
  2. SQLite bar store       (<5 ms  — persistent across redeploys, delta-updated)
  3. Disk cache             (<20 ms — legacy fallback during SQLite cold-start)
  4. Massive API delta      (<1 s   — only new bars since last stored ts)
  5. Massive API full       (4-8 s  — first-ever fetch for a ticker)

Request deduplication: if N concurrent requests arrive for the same
(ticker, tf, bars) while a Massive call is in-flight, all waiters
share the result of a single API call instead of stampeding.
"""
import json as _json
import os as _os
import threading as _threading
import time as _time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo as _ZI
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from api.services.cache import cache
from api.services import bars_disk_cache as disk_cache
from api.services import bars_sqlite as _sqlite
from api.services.massive import _get_client, _REST_BASE

# ── In-flight deduplication ───────────────────────────────────────────────────
# Prevents N concurrent requests for the same key from each making a separate
# Massive API call.  The first thread that arrives becomes the "fetcher" and
# sets the result into cache; all others wait on an Event and read from cache.
_inflight: dict[str, _threading.Event] = {}
_inflight_lock = _threading.Lock()


def _is_market_open() -> bool:
    now = datetime.now(_ZI("America/New_York"))
    if now.weekday() >= 5:
        return False
    hm = now.hour * 100 + now.minute
    return 930 <= hm < 1600


def _last_weekday_yyyymmdd() -> int:
    """Return the most recent weekday as YYYYMMDD (rolls Sat → Fri, Sun → Fri)."""
    d = datetime.utcnow()
    wd = d.weekday()  # 0=Mon … 5=Sat, 6=Sun
    if wd == 5:
        d -= timedelta(days=1)
    elif wd == 6:
        d -= timedelta(days=2)
    return int(d.strftime("%Y%m%d"))


def _needs_fresh(last_ts: int | None, tf: str) -> bool:
    """True if SQLite data is stale enough to warrant a delta fetch."""
    if last_ts is None:
        return True
    if tf in ("D", "W", "M"):
        return last_ts < _last_weekday_yyyymmdd()
    # Intraday: skip refresh outside market hours UNLESS data is from a prior session
    if not _is_market_open():
        # Force refresh if last bar is older than 30 hours (previous session / missed day)
        return (_time.time() - last_ts) > 30 * 3600
    thresholds = {"1": 90, "5": 300, "15": 900, "30": 1800, "60": 3600}
    return (_time.time() - last_ts) > thresholds.get(tf, 300)


def _fmt_sqlite_bars(rows: list[tuple], tf: str) -> list[dict]:
    """Convert SQLite (ts, o, h, l, c, v) tuples to LightweightCharts format."""
    date_tf = tf in ("D", "W", "M")
    out = []
    for ts, o, h, l, c, v in rows:
        if date_tf:
            s = str(ts)
            t_val = f"{s[:4]}-{s[4:6]}-{s[6:]}"
        else:
            t_val = ts
        out.append({"t": t_val, "o": o, "h": h, "l": l, "c": c, "v": v})
    return out

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
        with urllib.request.urlopen(req, timeout=8) as resp:
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

    tf='60' is special: internally uses 30-min bars resampled to session-aligned
    hourly (9:30-10:00 first candle, then 10:00-11:00 ... 15:00-16:00) so the
    chart matches TC2000 / ThinkorSwim behaviour in RTH mode.
    """
    import logging as _log
    _logger = _log.getLogger(__name__)
    if tf == "60":
        # Need ~2× 30-min bars to produce max_bars session-aligned hourly bars
        src = max_bars * 2
        bars_30m = _fetch_intraday_massive(ticker, "30", src)
        n_mass = len(bars_30m) if bars_30m else 0
        is_stale_mass = _is_intraday_stale(bars_30m) if bars_30m else True
        _logger.warning(f"[bars-resample] {ticker} tf=60 src={src} massive_30m={n_mass} stale={is_stale_mass}")
        if bars_30m and not is_stale_mass:
            out = _session_resample_hourly(bars_30m)[-max_bars:]
            _logger.warning(f"[bars-resample] {ticker} tf=60 source=MASSIVE resampled_to={len(out)}")
            return out
        fmp_30m = _fetch_intraday_fmp(ticker, "30", src)
        n_fmp = len(fmp_30m) if fmp_30m else 0
        is_stale_fmp = _is_intraday_stale(fmp_30m) if fmp_30m else True
        _logger.warning(f"[bars-resample] {ticker} tf=60 fmp_30m={n_fmp} stale={is_stale_fmp}")
        if fmp_30m and not is_stale_fmp:
            out = _session_resample_hourly(fmp_30m)[-max_bars:]
            _logger.warning(f"[bars-resample] {ticker} tf=60 source=FMP resampled_to={len(out)}")
            return out
        yf_30m = _fetch_intraday_yfinance(ticker, "30", src)
        n_yf = len(yf_30m) if yf_30m else 0
        _logger.warning(f"[bars-resample] {ticker} tf=60 yf_30m={n_yf}")
        if yf_30m:
            out = _session_resample_hourly(yf_30m)[-max_bars:]
            _logger.warning(f"[bars-resample] {ticker} tf=60 source=YFINANCE resampled_to={len(out)}")
            return out
        _logger.warning(f"[bars-resample] {ticker} tf=60 source=NONE bars_30m_was={n_mass}")
        return _session_resample_hourly(bars_30m)[-max_bars:] if bars_30m else []

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


# ── Delta-fetch helpers (tiny payloads — only new bars since last stored ts) ──

def _delta_daily(ticker: str, last_ts: int) -> list[dict]:
    """Fetch only daily bars newer than last_ts (YYYYMMDD int)."""
    from api.services.massive import get_agg_bars
    from_date = (datetime.utcnow() - timedelta(days=10)).strftime("%Y-%m-%d")
    to_date   = datetime.utcnow().strftime("%Y-%m-%d")
    new = []
    for bar in get_agg_bars(ticker, from_date, to_date):
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        ts = int(dt.strftime("%Y%m%d"))
        if ts > last_ts:
            new.append({
                "t": dt.strftime("%Y-%m-%d"),
                "o": round(bar["o"], 2), "h": round(bar["h"], 2),
                "l": round(bar["l"], 2), "c": round(bar["c"], 2),
                "v": int(bar.get("v", 0)),
            })
    return new


def _delta_weekly(ticker: str, last_ts: int) -> list[dict]:
    """Fetch daily bars for the last 14 days, resample, return new weekly bars."""
    from api.services.massive import get_agg_bars
    from_date = (datetime.utcnow() - timedelta(days=14)).strftime("%Y-%m-%d")
    to_date   = datetime.utcnow().strftime("%Y-%m-%d")
    daily = []
    for bar in get_agg_bars(ticker, from_date, to_date):
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        daily.append({
            "t": dt.strftime("%Y-%m-%d"),
            "o": round(bar["o"], 2), "h": round(bar["h"], 2),
            "l": round(bar["l"], 2), "c": round(bar["c"], 2),
            "v": int(bar.get("v", 0)),
        })
    return [b for b in _resample_weekly_iso(daily) if int(b["t"].replace("-", "")) > last_ts]


def _delta_monthly(ticker: str, last_ts: int) -> list[dict]:
    """Fetch daily bars for the last 60 days, resample, return new monthly bars."""
    from api.services.massive import get_agg_bars
    from_date = (datetime.utcnow() - timedelta(days=60)).strftime("%Y-%m-%d")
    to_date   = datetime.utcnow().strftime("%Y-%m-%d")
    daily = []
    for bar in get_agg_bars(ticker, from_date, to_date):
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        daily.append({
            "t": dt.strftime("%Y-%m-%d"),
            "o": round(bar["o"], 2), "h": round(bar["h"], 2),
            "l": round(bar["l"], 2), "c": round(bar["c"], 2),
            "v": int(bar.get("v", 0)),
        })
    return [b for b in _resample_monthly_iso(daily) if int(b["t"].replace("-", "")) > last_ts]


def _session_resample_hourly(bars_30m: list[dict]) -> list[dict]:
    """Resample 30-min bars to session-aligned 60-min bars.

    Regular session (9:30-16:00 ET):
      - First bar: 9:30-10:00 (30-min only — clean open candle)
      - Remaining: 10:00-11:00, 11:00-12:00, ..., 15:00-16:00
    Extended hours: clock-aligned 60-min groupings.
    """
    try:
        import zoneinfo
        ET = zoneinfo.ZoneInfo("America/New_York")
    except ImportError:
        from datetime import timezone, timedelta as _td
        ET = timezone(_td(hours=-4))

    def _bucket(t_utc: int) -> int:
        dt = datetime.fromtimestamp(t_utc, tz=ET)
        h, m = dt.hour, dt.minute
        # 9:30-9:59: first RTH bar — its own 30-min bucket starting at 9:30
        if h == 9 and m >= 30:
            return int(datetime(dt.year, dt.month, dt.day, 9, 30, tzinfo=ET).timestamp())
        # All other hours (RTH 10-15 + extended): floor to clock-hour in ET
        return int(datetime(dt.year, dt.month, dt.day, h, 0, tzinfo=ET).timestamp())

    groups: dict[int, list[dict]] = {}
    for bar in bars_30m:
        bkt = _bucket(bar["t"])
        groups.setdefault(bkt, []).append(bar)

    result = []
    for bkt_t in sorted(groups):
        grp = sorted(groups[bkt_t], key=lambda b: b["t"])
        result.append({
            "t": bkt_t,
            "o": grp[0]["o"],
            "h": max(b["h"] for b in grp),
            "l": min(b["l"] for b in grp),
            "c": grp[-1]["c"],
            "v": sum(b["v"] for b in grp),
        })
    return result


def _delta_intraday(ticker: str, tf: str, last_ts: int) -> list[dict]:
    """Fetch only intraday bars newer than last_ts (unix seconds)."""
    gap_days = max(2, int((_time.time() - last_ts) / 86400) + 2)
    from_date = (datetime.utcnow() - timedelta(days=gap_days)).strftime("%Y-%m-%d")
    to_date   = datetime.utcnow().strftime("%Y-%m-%d")

    # 60-min: fetch 30-min delta and resample to session-aligned hourly
    if tf == "60":
        try:
            client = _get_client()
            url = (
                f"{_REST_BASE}/v2/aggs/ticker/{ticker.upper()}/range/30/minute"
                f"/{from_date}/{to_date}"
                f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
            )
            data = client._get(url)
            bars_30m = [
                {"t": int(b["t"] / 1000), "o": round(b["o"], 2), "h": round(b["h"], 2),
                 "l": round(b["l"], 2), "c": round(b["c"], 2), "v": int(b.get("v", 0))}
                for b in (data.get("results") or [])
            ]
            return [b for b in _session_resample_hourly(bars_30m) if b["t"] > last_ts]
        except Exception:
            return []

    multiplier = int(tf)
    # Scale lookback to cover the full gap since last stored bar + 2-day buffer.
    # A fixed 2-day window misses bars when a user hasn't opened the app in days.
    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{ticker.upper()}/range/{multiplier}/minute"
            f"/{from_date}/{to_date}"
            f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        data = client._get(url)
        new = []
        for bar in (data.get("results") or []):
            ts = int(bar["t"] / 1000)
            if ts > last_ts:
                new.append({
                    "t": ts,
                    "o": round(bar["o"], 2), "h": round(bar["h"], 2),
                    "l": round(bar["l"], 2), "c": round(bar["c"], 2),
                    "v": int(bar.get("v", 0)),
                })
        return new
    except Exception:
        return []


def _fetch_daily_yf(ticker: str) -> list[dict]:
    """Fetch daily bars from yfinance period='max' for deep history.
    Returns bars in our normalized format (t = ISO date string).
    Used during nightly warm to get pre-2006 history that Massive lacks.
    """
    try:
        import yfinance as yf
        df = yf.Ticker(ticker.upper()).history(period='max', interval='1d', auto_adjust=False, raise_errors=False)
        if df is None or df.empty:
            return []
        out = []
        for ts, row in df.iterrows():
            try:
                dt_str = ts.strftime("%Y-%m-%d") if hasattr(ts, 'strftime') else str(ts)[:10]
                out.append({
                    "t": dt_str,
                    "o": round(float(row["Open"]), 2),
                    "h": round(float(row["High"]), 2),
                    "l": round(float(row["Low"]), 2),
                    "c": round(float(row["Close"]), 2),
                    "v": int(row.get("Volume", 0) or 0),
                })
            except Exception:
                continue
        return out
    except Exception as e:
        print(f"[bars] yfinance daily fetch failed for {ticker}: {e}")
        return []


def _merge_daily_bars(yf_bars: list[dict], massive_bars: list[dict]) -> list[dict]:
    """Merge yfinance (deep history) + Massive (recent, more accurate).
    Massive wins for any overlapping date range. yfinance fills the older
    pre-Massive history.
    """
    if not yf_bars:
        return massive_bars
    if not massive_bars:
        return yf_bars
    cutoff = massive_bars[0]["t"]  # ISO date string sorts lexically
    older_yf = [b for b in yf_bars if b["t"] < cutoff]
    return older_yf + massive_bars


def _fetch_daily(ticker: str, max_bars: int, deep: bool = False) -> list[dict]:
    """Fetch daily bars from Massive API. If deep=True, also pull yfinance
    period='max' and merge for full pre-2006 history. The deep path is only
    invoked by the nightly universe warmer — live user requests never call
    yfinance, ensuring zero latency impact.
    """
    from api.services.massive import get_agg_bars
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    # ~1.5 calendar days per trading day, capped at 30 years to avoid strftime crash
    lookback = min(int(max_bars * 1.5) + 30, 10950)
    from_date = (datetime.utcnow() - timedelta(days=lookback)).strftime("%Y-%m-%d")
    raw = get_agg_bars(ticker.upper(), from_date, to_date)
    massive_bars = []
    for bar in raw:
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        massive_bars.append({
            "t": dt.strftime("%Y-%m-%d"),  # BusinessDay format for LW Charts
            "o": round(bar["o"], 2),
            "h": round(bar["h"], 2),
            "l": round(bar["l"], 2),
            "c": round(bar["c"], 2),
            "v": int(bar.get("v", 0)),
        })

    if deep:
        # Only nightly warmer asks for deep history — pulls yfinance and merges.
        yf_bars = _fetch_daily_yf(ticker)
        merged = _merge_daily_bars(yf_bars, massive_bars)
        return merged[-max_bars:]

    return massive_bars[-max_bars:]


def _fetch_weekly(ticker: str, max_bars: int, deep: bool = False) -> list[dict]:
    """Fetch weekly bars — daily from Massive (+ yfinance if deep), resampled."""
    if deep:
        # Build deep daily series first, then resample. Need enough daily bars
        # to cover max_bars weeks: ~5 trading days/week + buffer.
        daily = _fetch_daily(ticker, max_bars * 7, deep=True)
        weekly = _resample_weekly_iso(daily)
        return weekly[-max_bars:]
    # Fast path: Massive only, original logic
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



def _fetch_monthly(ticker: str, max_bars: int, deep: bool = False) -> list[dict]:
    """Fetch monthly bars — daily from Massive (+ yfinance if deep), resampled."""
    if deep:
        daily = _fetch_daily(ticker, max_bars * 25, deep=True)  # ~21 trading days/month
        monthly = _resample_monthly_iso(daily)
        return monthly[-max_bars:]
    # Fast path: Massive only
    from api.services.massive import get_agg_bars
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    lookback = min(max_bars * 35, 10950)  # ~35 calendar days per month
    from_date = (datetime.utcnow() - timedelta(days=lookback)).strftime("%Y-%m-%d")
    raw = get_agg_bars(ticker.upper(), from_date, to_date)
    monthly = _resample_monthly(raw)
    return monthly[-max_bars:]


def _resample_weekly_iso(daily_bars: list[dict]) -> list[dict]:
    """Resample our normalized daily bars (t = ISO date string) to weekly."""
    if not daily_bars:
        return []
    weeks = {}
    for bar in daily_bars:
        try:
            dt = datetime.strptime(bar["t"], "%Y-%m-%d")
        except (ValueError, TypeError):
            continue
        key = dt.isocalendar()[:2]
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
            w["v"] += bar.get("v", 0)
    return [
        {
            "t": w["dt"].strftime("%Y-%m-%d"),
            "o": w["o"], "h": w["h"], "l": w["l"], "c": w["c"], "v": w["v"],
        }
        for w in sorted(weeks.values(), key=lambda x: x["dt"])
    ]


def _resample_monthly_iso(daily_bars: list[dict]) -> list[dict]:
    """Resample our normalized daily bars (t = ISO date string) to monthly."""
    if not daily_bars:
        return []
    months = {}
    for bar in daily_bars:
        try:
            dt = datetime.strptime(bar["t"], "%Y-%m-%d")
        except (ValueError, TypeError):
            continue
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
            m["v"] += bar.get("v", 0)
    return [
        {
            "t": m["dt"].strftime("%Y-%m-%d"),
            "o": m["o"], "h": m["h"], "l": m["l"], "c": m["c"], "v": m["v"],
        }
        for m in sorted(months.values(), key=lambda x: x["dt"])
    ]


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


def _get_bars_since_response(ticker: str, tf: str, bars: int, since_str: str) -> JSONResponse:
    """Return only bars newer than `since_str` for the browser's delta sync.

    Triggers a delta fetch from Massive if SQLite data is stale, then returns
    only the new rows — typically 0-5 bars, so payload is ~500 bytes vs 50 KB.
    """
    ticker_up = ticker.upper()
    date_tf   = tf in ("D", "W", "M")

    # Parse `since` → SQLite ts int
    try:
        if date_tf:
            since_ts = int(str(since_str).replace("-", "")[:8])
        else:
            since_ts = int(float(since_str))
    except (ValueError, TypeError):
        since_ts = 0

    # Trigger delta update if data is stale (non-blocking for callers that
    # already have the bulk of history; this just fills in the latest bars)
    last_ts = _sqlite.get_last_ts(ticker_up, tf)
    if _needs_fresh(last_ts, tf) and last_ts:
        try:
            if tf == "D":
                new = _delta_daily(ticker_up, last_ts)
            elif tf == "W":
                new = _delta_weekly(ticker_up, last_ts)
            elif tf == "M":
                new = _delta_monthly(ticker_up, last_ts)
            else:
                new = _delta_intraday(ticker_up, tf, last_ts)
            if new:
                _sqlite.put_bars(ticker_up, tf, new, date_tf=date_tf)
        except Exception:
            pass

    rows  = _sqlite.get_bars_since(ticker_up, tf, since_ts)
    delta = _fmt_sqlite_bars(rows, tf)
    return JSONResponse(
        content={"ticker": ticker_up, "tf": tf, "bars": delta, "delta": True},
        headers={"Cache-Control": "public, max-age=5"},
    )


# Background cache warmer — used by other routers to pre-populate /api/bars
# cache before the client requests it (e.g. when a breadth drill list is
# fetched, warm the top tickers' Daily bars so chart loads are instant).
from concurrent.futures import ThreadPoolExecutor as _BarsWarmExecutor
_bars_warm_pool = _BarsWarmExecutor(max_workers=4, thread_name_prefix="bars-warm")


def warm_bars_async(tickers: list[str], tf: str = "D", bars: int = 8000) -> None:
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
        is_deep_tf = tf in ("D", "W", "M")
        for sym in tickers:
            # For D/W/M we always re-warm because users may have already
            # populated the cache with Massive-only data via a normal /api/bars
            # request. Skipping would leave us with shallow history forever.
            if not is_deep_tf:
                try:
                    if disk_cache.get(sym, tf, bars_count) is not None:
                        with _warm_state_lock:
                            _warm_state["skipped"] += 1
                            _warm_state["done"] += 1
                        continue
                except Exception:
                    pass

            def _task(s=sym, t=tf, deep=is_deep_tf):
                try:
                    if deep:
                        # Deep warm: Massive + yfinance merged for full history.
                        # Writes directly to disk + memory cache so subsequent
                        # /api/bars reads see the deep history.
                        if t == 'D':
                            data = _fetch_daily(s, bars_count, deep=True)
                        elif t == 'W':
                            data = _fetch_weekly(s, bars_count, deep=True)
                        elif t == 'M':
                            data = _fetch_monthly(s, bars_count, deep=True)
                        else:
                            data = []
                        if data:
                            ticker_up = s.upper()
                            payload = {"ticker": ticker_up, "tf": t, "bars": data}
                            try:
                                disk_cache.put(ticker_up, t, bars_count, payload)
                                cache.set(f"bars_{ticker_up}_{t}_{bars_count}", payload, ttl=_CACHE_TTL.get(t, 300))
                            except Exception:
                                pass
                            return True
                        return False
                    # Intraday: standard cache fill via _get_bars_inner
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


@router.post("/api/admin/warm-universe-stop")
def warm_universe_stop(request: Request):
    """Cancel an in-flight universe warm. Auth: Bearer PUSH_SECRET.

    Shuts down the bars-warm thread pool (cancelling pending tasks), then
    re-creates it so future warms can start cleanly. In-flight HTTP calls
    that have already been dispatched will finish — Python ThreadPoolExecutor
    can't interrupt them — but no new tasks will be picked up.
    """
    _check_admin_auth(request)
    global _bars_warm_pool
    try:
        _bars_warm_pool.shutdown(wait=False, cancel_futures=True)
    except Exception:
        pass
    with _warm_state_lock:
        was_running = _warm_state.get("running", False)
        if was_running:
            _warm_state["running"] = False
            _warm_state["completed_iso"] = datetime.utcnow().isoformat() + "Z"
    # Recreate the pool so the next /api/admin/warm-universe call works
    _bars_warm_pool = _BarsWarmExecutor(max_workers=4, thread_name_prefix="bars-warm")
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


def _get_bars_inner(ticker: str, tf: str, bars: int):  # noqa: C901
    ticker_up = ticker.upper()
    cache_key = f"bars_{ticker_up}_{tf}_{bars}"
    date_tf   = tf in ("D", "W", "M")

    # ── Layer 1: In-memory TTL cache (<1 ms) ─────────────────────────────────
    cached = cache.get(cache_key)
    if cached is not None:
        return JSONResponse(
            content=cached,
            headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
        )

    # ── Layer 2: SQLite persistent store (<5 ms) ──────────────────────────────
    last_ts     = _sqlite.get_last_ts(ticker_up, tf)
    stored_rows = _sqlite.get_bars(ticker_up, tf, bars) if last_ts is not None else []

    if stored_rows and not _needs_fresh(last_ts, tf):
        # SQLite has enough fresh data — serve immediately, no API call.
        payload = {"ticker": ticker_up, "tf": tf, "bars": _fmt_sqlite_bars(stored_rows, tf)}
        cache.set(cache_key, payload, ttl=_CACHE_TTL.get(tf, 300))
        return JSONResponse(
            content=payload,
            headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
        )

    if stored_rows and last_ts:
        # Stale-while-revalidate: SQLite has data but it needs updating.
        # Serve the stale data immediately (no spinner) and refresh in the background.
        # The browser's SWR will revalidate after a short TTL and pick up fresh data.
        stale_payload = {"ticker": ticker_up, "tf": tf, "bars": _fmt_sqlite_bars(stored_rows, tf)}
        cache.set(cache_key, stale_payload, ttl=12)  # short TTL so next poll gets fresh

        with _inflight_lock:
            if cache_key not in _inflight:
                _bg_ev = _threading.Event()
                _inflight[cache_key] = _bg_ev

                def _bg_delta(
                    _key=cache_key, _sym=ticker_up, _tf=tf, _bars=bars,
                    _last_ts=last_ts, _stored=stored_rows, _ev=_bg_ev, _dtf=date_tf,
                ):
                    try:
                        if _tf == "D":
                            new = _delta_daily(_sym, _last_ts)
                        elif _tf == "W":
                            new = _delta_weekly(_sym, _last_ts)
                        elif _tf == "M":
                            new = _delta_monthly(_sym, _last_ts)
                        else:
                            new = _delta_intraday(_sym, _tf, _last_ts)
                        if new:
                            _sqlite.put_bars(_sym, _tf, new, date_tf=_dtf)
                        fresh_rows = _sqlite.get_bars(_sym, _tf, _bars)
                        fresh_payload = {
                            "ticker": _sym, "tf": _tf,
                            "bars": _fmt_sqlite_bars(fresh_rows or _stored, _tf),
                        }
                        cache.set(_key, fresh_payload, ttl=_CACHE_TTL.get(_tf, 300))
                    except Exception:
                        pass
                    finally:
                        with _inflight_lock:
                            _inflight.pop(_key, None)
                        _ev.set()

                _threading.Thread(target=_bg_delta, daemon=True,
                                  name=f"bars-bg-{ticker_up}-{tf}").start()

        return JSONResponse(
            content=stale_payload,
            headers={"Cache-Control": "public, max-age=5"},
        )

    # ── Layer 3: Legacy disk cache fallback (transition period) ──────────────
    # Serves existing warm disk-cache entries during the SQLite cold-start.
    # Once SQLite is populated for a ticker, this branch is never reached.
    if not stored_rows:
        disk_cached = disk_cache.get(ticker_up, tf, bars)
        if disk_cached and disk_cached.get("bars"):
            payload = disk_cached
            cache.set(cache_key, payload, ttl=_CACHE_TTL.get(tf, 300))
            return JSONResponse(
                content=payload,
                headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
            )

    # ── Layer 4: API fetch (delta or full) — with deduplication ──────────────
    # Prevent a stampede: only one thread fetches per cache_key; the rest wait.
    with _inflight_lock:
        if cache_key in _inflight:
            waiter_ev  = _inflight[cache_key]
            i_am_fetcher = False
        else:
            waiter_ev  = _threading.Event()
            _inflight[cache_key] = waiter_ev
            i_am_fetcher = True

    if not i_am_fetcher:
        # Wait up to 12 s for the fetcher to finish, then read from cache.
        waiter_ev.wait(timeout=12)
        hit = cache.get(cache_key)
        if hit is not None:
            return JSONResponse(
                content=hit,
                headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
            )
        # Fetcher may have failed — return stale SQLite data or empty
        stale = _fmt_sqlite_bars(stored_rows, tf) if stored_rows else []
        return JSONResponse(
            content={"ticker": ticker_up, "tf": tf, "bars": stale},
            headers={"Cache-Control": "public, max-age=5"},
        )

    # We are the designated fetcher for this key.
    import logging as _log
    _logger = _log.getLogger(__name__)
    result_bars: list[dict] = []
    ttl = _CACHE_TTL.get(tf, 300)
    # Pre-initialise payload so finally block always has something to cache
    payload: dict = {"ticker": ticker_up, "tf": tf, "bars": []}

    try:
        if stored_rows and last_ts:
            # ── Delta fetch: only new bars since last stored ts (fast) ────────
            try:
                if tf == "D":
                    new_bars = _delta_daily(ticker_up, last_ts)
                elif tf == "W":
                    new_bars = _delta_weekly(ticker_up, last_ts)
                elif tf == "M":
                    new_bars = _delta_monthly(ticker_up, last_ts)
                else:  # intraday
                    new_bars = _delta_intraday(ticker_up, tf, last_ts)

                if new_bars:
                    _sqlite.put_bars(ticker_up, tf, new_bars, date_tf=date_tf)

                # Read fresh rows from SQLite (includes the new bars)
                fresh_rows = _sqlite.get_bars(ticker_up, tf, bars)
                result_bars = _fmt_sqlite_bars(fresh_rows or stored_rows, tf)

            except Exception as e:
                _logger.warning(f"[bars] delta failed {ticker_up} tf={tf}: {e}")
                result_bars = _fmt_sqlite_bars(stored_rows, tf)

        else:
            # ── Full fetch: first time we see this ticker/tf ──────────────────
            try:
                if tf in ("1", "5", "15", "30", "60"):
                    raw = _fetch_intraday(ticker_up, tf, bars)
                elif tf == "W":
                    raw = _fetch_weekly(ticker_up, bars)
                elif tf == "M":
                    raw = _fetch_monthly(ticker_up, bars)
                else:
                    raw = _fetch_daily(ticker_up, bars)

                if raw:
                    # Don't persist stale intraday fallback data to SQLite — it would
                    # be served as fresh on subsequent requests since _needs_fresh
                    # checks last_ts age, not data age.
                    if date_tf or not _is_intraday_stale(raw):
                        _sqlite.put_bars(ticker_up, tf, raw, date_tf=date_tf)
                result_bars = raw

            except Exception as e:
                _logger.error(f"[bars] full fetch failed {ticker_up} tf={tf}: {e}")
                result_bars = []

        # Build payload and write to cache BEFORE releasing waiters, so that
        # concurrent waiters that wake in the finally block read fresh data.
        payload = {"ticker": ticker_up, "tf": tf, "bars": result_bars}
        cache.set(cache_key, payload, ttl=ttl if result_bars else 5)

    finally:
        # Always release waiters — cache is already populated above.
        with _inflight_lock:
            _inflight.pop(cache_key, None)
        waiter_ev.set()

    return JSONResponse(
        content=payload,
        headers={"Cache-Control": f"public, max-age={ttl}"},
    )
