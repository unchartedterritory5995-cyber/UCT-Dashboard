"""OHLCV bar fetch/cache helpers — shared by the bars router and the worker service.

All actual fetch/cache/dedup logic lives here so the upcoming worker service
(api/worker_main.py) can import it without dragging in FastAPI router decorators.

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
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from api.services.cache import cache
from api.services import bars_disk_cache as disk_cache
from api.services import bars_sqlite as _sqlite
from api.services.massive import _get_client, _REST_BASE, to_polygon_symbol

# ── In-flight deduplication ───────────────────────────────────────────────────
# Prevents N concurrent requests for the same key from each making a separate
# Massive API call.  The first thread that arrives becomes the "fetcher" and
# sets the result into cache; all others wait on an Event and read from cache.
_inflight: dict[str, _threading.Event] = {}
_inflight_lock = _threading.Lock()

# ── Usage-driven intraday hot-set ─────────────────────────────────────────────
# The prewarmer only refreshes intraday for a static ticker_list[:200].
# Anything outside that 200 was frozen until a user happened to view it
# twice — the universe-freeze bug. We record every ticker whose intraday
# bars are actually requested so the prewarmer can keep THOSE warm on its
# 5-min cadence (the charts the user is actually flipping through), no
# matter where they fall in the universe ordering.
_recent_intraday: dict[str, float] = {}          # TICKER -> last requested epoch
_recent_intraday_lock = _threading.Lock()
_RECENT_INTRADAY_MAX = 800


def _record_intraday_request(ticker: str, tf: str) -> None:
    """Note that (ticker) had an intraday request. O(1) common path;
    prunes oldest entries when over capacity. Never raises."""
    if tf not in ("1", "5", "15", "30", "60"):
        return
    try:
        key = ticker.upper()
        with _recent_intraday_lock:
            _recent_intraday[key] = _time.time()
            if len(_recent_intraday) > _RECENT_INTRADAY_MAX:
                # Drop the oldest ~20% so this prune is amortized, not per-call.
                cut = sorted(_recent_intraday.items(), key=lambda kv: kv[1])
                for k, _ in cut[: max(1, len(cut) // 5)]:
                    _recent_intraday.pop(k, None)
    except Exception:
        pass


def get_hot_intraday_tickers(max_n: int = 500) -> list[str]:
    """Most-recently-requested intraday tickers, newest first. Consumed by
    the prewarmer to keep user-viewed charts fresh regardless of the
    static universe-ordering cap."""
    with _recent_intraday_lock:
        items = sorted(_recent_intraday.items(), key=lambda kv: kv[1], reverse=True)
    return [k for k, _ in items[:max_n]]


# NYSE full-day closures. WITHOUT this, every market holiday looks like a
# missed trading session to the cold-stale / freshness predicates: cache
# carries Friday's last bar, code expects a "Monday" session, so every
# intraday chart open fires a synchronous Massive delta fetch returning
# nothing — and the prewarmer keeps retrying the same empty fetch every
# cycle, saturating the shared API key. Memorial Day 2026 (this set's
# trigger) reproduced exactly that. Keep this list ahead of `today` by at
# least one calendar year; refresh annually from nyse.com/markets/hours-calendars.
_NYSE_HOLIDAYS_YYYYMMDD: frozenset[int] = frozenset({
    # 2025
    20250101, 20250109, 20250120, 20250217, 20250418, 20250526, 20250619,
    20250704, 20250901, 20251127, 20251225,
    # 2026
    20260101, 20260119, 20260216, 20260403, 20260525, 20260619, 20260703,
    20260907, 20261126, 20261225,
    # 2027
    20270101, 20270118, 20270215, 20270326, 20270531, 20270618, 20270705,
    20270906, 20271125, 20271224,
})


def _is_nyse_holiday(yyyymmdd: int) -> bool:
    """True if the given ET calendar date (YYYYMMDD int) is a NYSE full
    closure. Half-day closes (1pm ET early closes) intentionally NOT
    included — those are still trading sessions and produce intraday
    bars normally."""
    return yyyymmdd in _NYSE_HOLIDAYS_YYYYMMDD


def _is_market_open() -> bool:
    now = datetime.now(_ZI("America/New_York"))
    if now.weekday() >= 5:
        return False
    if _is_nyse_holiday(int(now.strftime("%Y%m%d"))):
        return False
    hm = now.hour * 100 + now.minute
    return 930 <= hm < 1600


def _last_weekday_yyyymmdd() -> int:
    """Return the most recent NYSE trading day as YYYYMMDD (rolls Sat → Fri,
    Sun → Fri, AND walks back past any NYSE-closed holiday). Drives
    `_needs_fresh` for D/W/M: if last_ts equals this date, the bar is
    considered fresh — so on a holiday, Friday's cache no longer triggers
    a useless empty refresh fetch."""
    d = datetime.utcnow()
    wd = d.weekday()  # 0=Mon … 5=Sat, 6=Sun
    if wd == 5:
        d -= timedelta(days=1)
    elif wd == 6:
        d -= timedelta(days=2)
    # Walk back through holidays (and any weekend the holiday rolls onto).
    # Capped at 14 days as a safety belt — NYSE never has a 2-week closure.
    for _ in range(14):
        ymd = int(d.strftime("%Y%m%d"))
        if not _is_nyse_holiday(ymd) and d.weekday() < 5:
            return ymd
        d -= timedelta(days=1)
    return int(d.strftime("%Y%m%d"))


_INTRADAY_FRESHNESS_THRESHOLDS = {"1": 90, "5": 300, "15": 900, "30": 1800, "60": 3600}


def _needs_fresh(last_ts: int | None, tf: str) -> bool:
    """True if SQLite data is stale enough to warrant a delta fetch."""
    if last_ts is None:
        return True
    if tf in ("D", "W", "M"):
        # Refresh if cached bar is from before today's session, OR if it IS
        # today's bar (which keeps evolving — open is fixed at 9:30 ET but
        # high/low/close drift throughout the session and into extended
        # hours). Strict `<` would freeze today's daily/weekly/monthly bar
        # at whatever values were first cached (typically just-after-open
        # values when the first request hit). Combined with the in-memory
        # cache's 5-minute TTL, this triggers at most one fetch per 5min
        # per ticker per tf — fine for Polygon rate limits, and ensures
        # today's evolving close updates instead of freezing.
        return last_ts <= _last_weekday_yyyymmdd()

    threshold = _INTRADAY_FRESHNESS_THRESHOLDS.get(tf, 300)
    age = _time.time() - last_ts

    if _is_market_open():
        return age > threshold

    # Off-market refinements (the bug being fixed here):
    # The prior code returned `age > 30h` for ALL off-market times, which
    # meant a chart opened at 17:00 ET on a trading day where the cache
    # only had data through 12:00 ET would NOT trigger a top-up — the 5h
    # diff is well under 30h, so the user saw a chart pinned at noon even
    # though Polygon had the full RTH session available. New rule:
    #
    # - Weekday extended-hours window (4 AM – 8 PM ET): use the standard
    #   tf threshold so post-market and pre-market top-ups happen normally.
    #   Polygon delivers RTH-close prints + after-hours moves + early-bird
    #   pre-market in that window; we should pick them up.
    # - Overnight (8 PM – 4 AM ET) and weekends: nothing new arrives, so
    #   the conservative 30h "is the data ancient?" gate still applies.
    try:
        et = _ZI("America/New_York")
        now_dt = datetime.now(et)
        hour_min = now_dt.hour * 60 + now_dt.minute
        # 4:00 AM ET (240) through 8:00 PM ET (1200) on a TRADING weekday
        # is the window where extended-hours and RTH coexist. NYSE holidays
        # produce no bars at any hour, so the aggressive 'needs fresh'
        # threshold must NOT apply — otherwise prewarmer + on-demand both
        # refetch empty all day and saturate the shared Massive API key
        # (the Memorial-Day-2026 incident).
        is_holiday = _is_nyse_holiday(int(now_dt.strftime("%Y%m%d")))
        in_extended_today = (
            now_dt.weekday() < 5 and not is_holiday and 240 <= hour_min < 1200
        )
    except Exception:
        # If zoneinfo fails for any reason, fall back to the old conservative
        # behavior — better to under-fetch than over-fetch on an edge case.
        in_extended_today = False

    if in_extended_today:
        return age > threshold
    # Off-market (overnight/weekend/holiday). The original 30h gate was a
    # blunt "is the data ancient?" guard, but on weekends and especially
    # 3-day holiday weekends it false-positives: Friday-close data is ~64h
    # old by Sunday and ~88h by Tuesday-after-Memorial-Day, both > 30h, so
    # the prewarmer would fire 14k+ refresh calls per cycle that return
    # nothing — contending for the shared Massive API key against any
    # cold user fetch happening at the same time (the 12s AEHR symptom).
    # Cold-stale is the authoritative "are we missing a trading session?"
    # predicate, and it's already holiday-aware. Reuse it: if the cache
    # covers the most-recent trading session, the entry is fresh enough
    # off-market regardless of wall-clock age. If a session IS missing,
    # the 30h gate still kicks in to make sure we don't sit on truly
    # ancient data.
    if tf in ("1", "5", "15", "30", "60") and not _is_cold_stale_intraday(tf, last_ts):
        return False
    return age > 30 * 3600


def _expected_latest_session_yyyymmdd(now=None) -> int:
    """ET date (YYYYMMDD int) of the most recent trading session that
    should have intraday bars available.

    Weekends roll to Friday; weekday pre-open (before ~09:35 ET) rolls to
    the prior trading day; NYSE-closed holidays also roll back (added
    2026-05-25 after Memorial-Day saturation: previously ALL intraday
    cache entries fired cold-stale on holidays because the prior weekday's
    cache looked "older than today's expected session," sending every chart
    open down the synchronous Massive-fetch path while the prewarmer
    hammered the same empty-result loop).

    False positives still cost only ~1s of latency once; false negatives
    are the universe-freeze bug, so we keep biasing toward fetching for
    everything OTHER than the well-known holiday set.
    """
    et = _ZI("America/New_York")
    now = now or datetime.now(et)
    wd = now.weekday()  # 0=Mon … 5=Sat, 6=Sun
    if wd == 5:
        d = now - timedelta(days=1)
    elif wd == 6:
        d = now - timedelta(days=2)
    else:
        if now.hour * 100 + now.minute < 935:
            d = now - timedelta(days=1)
            if d.weekday() == 5:
                d -= timedelta(days=1)
            elif d.weekday() == 6:
                d -= timedelta(days=2)
        else:
            d = now
    # Walk back past any NYSE holiday (and any weekend the holiday rolls
    # onto) so a closed Monday correctly resolves to Friday's session, not
    # to itself. 14-day cap is a safety belt — NYSE never has a 2-week run.
    for _ in range(14):
        ymd = int(d.strftime("%Y%m%d"))
        if d.weekday() < 5 and not _is_nyse_holiday(ymd):
            return ymd
        d -= timedelta(days=1)
    return int(d.strftime("%Y%m%d"))


def _is_cold_stale_intraday(tf: str, last_ts: int | None, now=None) -> bool:
    """True when the newest cached intraday bar predates the most recent
    session that should have data — i.e. the cache is missing >=1 whole
    trading session, not merely a same-session top-up.

    Cold-stale entries MUST be fetched synchronously so the FIRST chart
    paint is correct, instead of being served stale-while-revalidate (the
    root cause of the universe-wide May-8 freeze: charts fetch once per
    mount, so they never picked up the background heal). Same-session
    staleness still uses the fast SWR path — that's a legit "serve
    instantly, top up the developing bar in the background" case.
    """
    if tf not in ("1", "5", "15", "30", "60") or last_ts is None:
        return False
    try:
        et = _ZI("America/New_York")
        last_date = int(datetime.fromtimestamp(last_ts, et).strftime("%Y%m%d"))
    except Exception:
        return False
    return last_date < _expected_latest_session_yyyymmdd(now)


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
    """Fetch intraday bars from Massive API agg endpoint with pagination.

    Massive (Polygon) silently truncates large single-page responses — verified
    empirically that asking for >1000 bars in one call returns data that ends
    weeks or months before today (e.g. src=5000 → last bar 5 months stale).
    The endpoint paginates via a `next_url` field; we follow it until either
    the response stops returning a next_url or we hit the safety page cap.
    """
    multiplier = int(tf)  # 1, 5, 15, 30, 60
    # Lookback scales with max_bars. 16hr/day to account for extended hours.
    # Caps: 1min keep tight (huge data), 5/15min ~3mo, 30/60min ~2yr.
    bars_per_day = (16 * 60) // multiplier
    max_lookback = {1: 10, 5: 90, 15: 90}.get(multiplier, 730)
    lookback_days = min(max_lookback, max(10, int(max_bars / max(bars_per_day, 1) * 1.5) + 5))
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    from_date = (datetime.utcnow() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{to_polygon_symbol(ticker)}/range/{multiplier}/minute"
            f"/{from_date}/{to_date}"
            f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        all_results: list[dict] = []
        # Safety cap: 20 pages × 50000 bars = 1M bars — way more than we'd ever
        # use, but bounds the worst case if Polygon changes pagination behavior.
        for _page in range(20):
            data = client._get(url)
            page_results = data.get("results") or []
            all_results.extend(page_results)
            next_url = data.get("next_url")
            if not next_url:
                break
            # next_url comes back without the apiKey — append it.
            sep = "&" if "?" in next_url else "?"
            url = f"{next_url}{sep}apiKey={client._api_key}"

        if not all_results:
            return []
        bars = []
        for bar in all_results:
            bars.append({
                "t": int(bar["t"] / 1000),  # ms → unix seconds for LW Charts UTCTimestamp
                "o": round(bar["o"], 2),
                "h": round(bar["h"], 2),
                "l": round(bar["l"], 2),
                "c": round(bar["c"], 2),
                "v": int(bar.get("v", 0)),
            })
        # Return ALL paginated bars (the entire lookback window), not just
        # max_bars. The caller stores them in SQLite — limiting here means a
        # small `bars=10` call would store 10 rows, then a later `bars=200`
        # request reads those 10 rows from SQLite and never fetches more
        # history. The caller is responsible for slicing the response.
        return bars
    except Exception as _e:
        import logging as _log
        _log.getLogger(__name__).error(
            f"[bars] _fetch_intraday_massive {ticker} tf={tf} failed: {type(_e).__name__}: {_e}"
        )
        return []


def _paginate_massive_aggs(client, url: str) -> list[dict]:
    """Follow Massive/Polygon ``next_url`` pagination, returning ALL raw
    result dicts across pages.

    Single-page responses silently truncate large windows (documented in
    _fetch_intraday_massive). The delta path needs the SAME loop or
    multi-day / multi-month gaps never fully backfill — the asymmetry
    that let cold-stale intraday entries appear "stuck" weeks back.
    """
    out: list[dict] = []
    for _page in range(20):  # 20 × 50000 safety cap, same as full-fetch
        data = client._get(url)
        out.extend(data.get("results") or [])
        nxt = data.get("next_url")
        if not nxt:
            break
        sep = "&" if "?" in nxt else "?"
        url = f"{nxt}{sep}apiKey={client._api_key}"
    return out


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
        # CRITICAL: FMP's `date` field is Eastern Time text ("2026-05-22 15:30:00"
        # = 3:30 PM ET), NOT UTC. The prior code did a naive strptime + .timestamp(),
        # which on a UTC-clock container (Railway default) interprets the wall-clock
        # as UTC and shifts every bar by the full ET-UTC offset (4h EDT / 5h EST).
        # Net effect when FMP fired as a fallback: the entire RTH session landed
        # in the wrong hourly buckets, the afternoon (13-16 ET) ended up labelled
        # as morning (09-12 ET), and the real afternoon timestamps held either
        # nothing or stale data — chart visibly "cut off at noon" on most stocks.
        # Anchor to ET explicitly so `.timestamp()` produces the correct UTC unix.
        _ET_FMP = _ZI("America/New_York")
        bars = []
        for bar in reversed(data):  # FMP returns newest first
            try:
                dt = datetime.strptime(bar["date"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=_ET_FMP)
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
    except Exception as _e:
        import logging as _log
        _log.getLogger(__name__).warning(
            f"[bars] _fetch_intraday_fmp {ticker} tf={tf} failed: {type(_e).__name__}: {_e}"
        )
        return []


def _fetch_intraday_yfinance(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars from yfinance (fallback). Includes premarket + after-hours."""
    from api.services.yfinance_pool import fetch_history as _yf_fetch
    from concurrent.futures import TimeoutError as _YfTimeout
    config = _YF_CONFIG.get(tf)
    if not config:
        return []
    yf_sym = _YF_TICKERS.get(ticker.upper(), ticker.upper())
    try:
        # Bounded pool + hard timeout. A hung yfinance call would otherwise
        # hold the calling thread for minutes; the pool caps damage at
        # YFINANCE_POOL_WORKERS leaked threads max, and the timeout makes
        # this fetch_intraday_yfinance call return promptly so the caller's
        # fallback chain (Massive → FMP → yfinance) stays responsive.
        df = _yf_fetch(
            yf_sym,
            period=config["period"], interval=config["interval"],
            prepost=True,  # Include premarket (4-9:30 AM) + after-hours (4-8 PM)
        )
        if df is None or df.empty:
            return []
        # Do NOT strip the timezone — it's the same trap that bit FMP.
        # A naive Timestamp.timestamp() interprets wall-clock in the host's
        # local TZ; on Railway (UTC) that shifts every bar by the full ET
        # offset. For tz-aware Timestamps, .timestamp() returns the proper
        # UTC unix-seconds regardless of host TZ. If yfinance ever returns
        # naive data (some edge tickers), assume ET — that matches Yahoo's
        # documented intraday convention for US equities.
        _ET_YF = _ZI("America/New_York")
        bars = []
        for ts, row in df.iterrows():
            if getattr(ts, "tzinfo", None) is None:
                # pandas Timestamp lacks `.replace`; use tz_localize on the value
                ts = ts.tz_localize(_ET_YF)
            bars.append({
                "t": int(ts.timestamp()),  # unix seconds (UTC), tz-correct
                "o": round(row["Open"], 2),
                "h": round(row["High"], 2),
                "l": round(row["Low"], 2),
                "c": round(row["Close"], 2),
                "v": int(row.get("Volume", 0)),
            })
        return bars[-max_bars:]
    except Exception as _e:
        import logging as _log
        _log.getLogger(__name__).warning(
            f"[bars] _fetch_intraday_yfinance {ticker} tf={tf} failed: {type(_e).__name__}: {_e}"
        )
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


def _last_known_close(ticker: str, tf: str) -> float | None:
    """Return the most recent close stored in SQLite for (ticker, tf), or None.

    Used as the seeding ``prior_close`` for ``fetch_with_validation`` so the
    very first bar of a fresh fetch can be sanity-checked against history.
    Defensive: any failure (table missing, locked DB, etc.) returns None.
    """
    try:
        rows = _sqlite.get_bars(ticker.upper(), tf, 1)
        if rows:
            # rows = [(ts, o, h, l, c, v)] — index 4 is close.
            return float(rows[0][4])
    except Exception:
        pass
    return None


def _fetch_intraday(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars — routes the Massive → FMP → yfinance source chain
    through ``fetch_with_validation`` so corrupt primary payloads automatically
    fall through to the next source instead of being persisted.

    tf='60' is special: internally uses 30-min bars resampled to session-aligned
    hourly (9:30-10:00 first candle, then 10:00-11:00 ... 15:00-16:00) so the
    chart matches TC2000 / ThinkorSwim behaviour in RTH mode. We still resample
    here, but the underlying 30-min fetch goes through fetch_with_validation
    (which itself iterates Massive → FMP → yfinance with per-bar validation).
    """
    import logging as _log
    _logger = _log.getLogger(__name__)
    prior_close = _last_known_close(ticker, tf)

    if tf == "60":
        # Need ~2× 30-min bars to produce max_bars session-aligned hourly bars.
        src = max_bars * 2
        # fetch_with_validation handles the Massive → FMP → yfinance chain
        # for the 30-min source, applying per-bar validation at each hop.
        bars_30m = fetch_with_validation(ticker, "30", src, prior_close=prior_close)
        if bars_30m and not _is_intraday_stale(bars_30m):
            out = _session_resample_hourly(bars_30m)[-max_bars:]
            _logger.warning(
                f"[bars-resample] {ticker} tf=60 src={src} validated_30m={len(bars_30m)} resampled_to={len(out)}"
            )
            return out
        # Validation pipeline returned None or stale data. Do NOT fall back
        # to raw Massive — that would re-admit the exact corrupt payload
        # Plan 1's validation gate was built to reject (e.g. QQQ 6.55
        # phantom bars). Staleness checks last-bar age, not OHLC validity,
        # so corrupt-but-recent bars would silently get persisted to SQLite
        # and the in-memory cache. Return empty instead.
        _logger.warning(
            "[bars] %s 30m: all sources failed validation, returning empty", ticker
        )
        return []

    # 1/5/15/30-min: validating fetch chain
    validated = fetch_with_validation(ticker, tf, max_bars, prior_close=prior_close)
    if validated and not _is_intraday_stale(validated):
        return validated

    # All clean sources rejected — do NOT fall back to raw Massive. That
    # would re-admit the exact corrupt payload Plan 1's validation gate was
    # built to reject (e.g. QQQ 6.55 phantom bars). Staleness checks
    # last-bar age, not OHLC validity, so a corrupt-but-recent payload
    # would silently get persisted to SQLite and the in-memory cache.
    # Return empty so the cache is not poisoned.
    _logger.warning(
        "[bars] %s tf=%s: all sources failed validation, returning empty", ticker, tf
    )
    return []


# ── Delta-fetch helpers (tiny payloads — only new bars since last stored ts) ──

def _delta_daily(ticker: str, last_ts: int) -> list[dict]:
    """Fetch daily bars from the last 10 days. Uses ``>=`` so today's
    still-evolving bar (whose close + high/low keep updating intraday)
    gets re-fetched and INSERT OR REPLACE-d into the cache on every
    call.

    Earlier I tried `>` to avoid a flicker observed on SANM Daily, but
    that left today's bar cached at the OPEN print value with no later
    update — user-visible as wrong close prices on D/W/M. The flicker
    concern is mitigated by the bg_delta TTL fix (commit 8517729): the
    SWR layer caches the response for 5 minutes between bg fetches, so
    intra-session the user sees ONE update every 5min, not constant
    oscillation. That's correct gradual update, not flicker.
    """
    from api.services.massive import get_agg_bars
    from_date = (datetime.utcnow() - timedelta(days=10)).strftime("%Y-%m-%d")
    to_date   = datetime.utcnow().strftime("%Y-%m-%d")
    new = []
    for bar in get_agg_bars(ticker, from_date, to_date):
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        ts = int(dt.strftime("%Y%m%d"))
        if ts >= last_ts:
            new.append({
                "t": dt.strftime("%Y-%m-%d"),
                "o": round(bar["o"], 2), "h": round(bar["h"], 2),
                "l": round(bar["l"], 2), "c": round(bar["c"], 2),
                "v": int(bar.get("v", 0)),
            })
    return new


def _delta_weekly(ticker: str, last_ts: int) -> list[dict]:
    """Fetch daily bars for the last 14 days, resample, return at-or-newer
    weekly bars (>=). The in-progress weekly bar (week-to-date OHLC)
    keeps updating as the week progresses; without >= the cached W bar
    freezes at first-fetch values and shows yesterday's close instead
    of today's."""
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
    return [b for b in _resample_weekly_iso(daily) if int(b["t"].replace("-", "")) >= last_ts]


def _delta_monthly(ticker: str, last_ts: int) -> list[dict]:
    """Fetch daily bars for the last 60 days, resample, return at-or-newer
    monthly bars (>=). Current month's bar keeps evolving as the month
    progresses; without >= the cached M bar freezes at first-fetch."""
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
    return [b for b in _resample_monthly_iso(daily) if int(b["t"].replace("-", "")) >= last_ts]


def bucket_60_et_unix_seconds(t_utc: int) -> int:
    """Canonical ET-anchored 60-min bucket function. Returns the unix-seconds
    timestamp of the hourly bucket that contains ``t_utc``.

    Public + top-level on purpose: BOTH the REST resample path here AND the
    WebSocket rollup path in ``api/services/bar_rollup.py`` must produce
    bit-identical bucket timestamps for the same minute. Sharing one function
    eliminates the drift-class bug that would otherwise plant duplicate
    candles in SQLite at neighboring ``ts`` values (the same shape as the
    FMP timezone bug — different primary keys, ``INSERT OR REPLACE`` can't
    heal it, chart breaks until a manual wipe).

    Bucket rules:
      - 9:30-9:59 ET: anchor at 9:30 ET (the special "clean open" 30-min bar)
      - All other times (RTH 10-15 ET + extended pre/post): floor to clock-hour ET

    DST is handled transparently via ``ZoneInfo("America/New_York")``.
    """
    et = _ZI("America/New_York")
    dt = datetime.fromtimestamp(t_utc, tz=et)
    h, m = dt.hour, dt.minute
    if h == 9 and m >= 30:
        return int(datetime(dt.year, dt.month, dt.day, 9, 30, tzinfo=et).timestamp())
    return int(datetime(dt.year, dt.month, dt.day, h, 0, tzinfo=et).timestamp())


def _session_resample_hourly(bars_30m: list[dict]) -> list[dict]:
    """Resample 30-min bars to session-aligned 60-min bars.

    Regular session (9:30-16:00 ET):
      - First bar: 9:30-10:00 (30-min only — clean open candle)
      - Remaining: 10:00-11:00, 11:00-12:00, ..., 15:00-16:00
    Extended hours: clock-aligned 60-min groupings.
    """
    _bucket = bucket_60_et_unix_seconds  # use the canonical function

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
                f"{_REST_BASE}/v2/aggs/ticker/{to_polygon_symbol(ticker)}/range/30/minute"
                f"/{from_date}/{to_date}"
                f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
            )
            bars_30m = [
                {"t": int(b["t"] / 1000), "o": round(b["o"], 2), "h": round(b["h"], 2),
                 "l": round(b["l"], 2), "c": round(b["c"], 2), "v": int(b.get("v", 0))}
                for b in _paginate_massive_aggs(client, url)
            ]
            # Filter shifted from strict > to >= on 2026-05-23. Original concern
            # was REST stepping on the WS-painted live bar; that's now mooted by
            # Phase 4's bar_broadcaster owning the developing-bar timeline AND
            # the canonical ET-anchored bucket function shared between REST +
            # WS (Step 3 / commit 595edc2). With >=, the boundary hourly bucket
            # gets RE-AGGREGATED and overwritten on every delta — heals the
            # "stored partial in-progress bar" bug where a chart loaded mid-hour
            # froze the bucket at half-bar values that the prior > filter could
            # never update (Step 4).
            return [b for b in _session_resample_hourly(bars_30m) if b["t"] >= last_ts]
        except Exception as _e:
            import logging as _log
            _log.getLogger(__name__).error(
                f"[bars] _delta_intraday(60-min) {ticker} failed: {type(_e).__name__}: {_e}"
            )
            return []

    multiplier = int(tf)
    # Scale lookback to cover the full gap since last stored bar + 2-day buffer.
    # A fixed 2-day window misses bars when a user hasn't opened the app in days.
    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{to_polygon_symbol(ticker)}/range/{multiplier}/minute"
            f"/{from_date}/{to_date}"
            f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        new = []
        for bar in _paginate_massive_aggs(client, url):
            ts = int(bar["t"] / 1000)
            # `>=` (was strict `>`) so the most recent stored bar gets
            # re-fetched and updated with Massive's authoritative values.
            # This heals the "partial in-progress bar got stored, then
            # strict-> filter prevented updates" bug for 1/5/15/30 min too.
            # WS still wins on display via the per-minute AM broadcaster;
            # REST's update only changes the persisted SQLite row, which
            # bar_broadcaster doesn't compete on for in-progress data.
            if ts >= last_ts:
                new.append({
                    "t": ts,
                    "o": round(bar["o"], 2), "h": round(bar["h"], 2),
                    "l": round(bar["l"], 2), "c": round(bar["c"], 2),
                    "v": int(bar.get("v", 0)),
                })
        return new
    except Exception as _e:
        import logging as _log
        _log.getLogger(__name__).error(
            f"[bars] _delta_intraday {ticker} tf={tf} failed: {type(_e).__name__}: {_e}"
        )
        return []


def _fetch_daily_yf(ticker: str) -> list[dict]:
    """Fetch daily bars from yfinance period='max' for deep history.
    Returns bars in our normalized format (t = ISO date string).
    Used during nightly warm to get pre-2006 history that Massive lacks.
    """
    try:
        from api.services.yfinance_pool import fetch_history as _yf_fetch
        # period='max' on a wide universe is a known yfinance slow-path
        # (multi-second on cold tickers). Use a longer timeout than the
        # intraday fast-path because this is invoked from the nightly
        # warm, not user requests, and the deeper data is worth the wait.
        df = _yf_fetch(
            ticker.upper(),
            timeout=20.0,
            period='max', interval='1d',
            auto_adjust=False, raise_errors=False,
        )
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


def _normalize_since_param(since_str: str, date_tf: bool):
    """Parse the `?since=` query value into a comparable threshold.

    Handles three input shapes:
      - ISO date string (`"2024-01-15"`) for daily/weekly/monthly timeframes:
        passed through unchanged for string comparison
      - Unix seconds integer (`"1714579200"`) for intraday: parsed as int
      - Unix MILLISECONDS integer (`"1714579200000"`) for intraday: detected
        by magnitude and downscaled to seconds

    The millisecond case fires from the Phase 4 chart's gap-backfill
    (StockChart.jsx onRealtimeReconnect) which tracks the last live bar
    time in milliseconds (the WebSocket emit shape) and forwards that
    value verbatim as `since=${sinceMs}`. Without the auto-downscale,
    `b["t"] > since_val` is e.g. ``1714579200 > 1714579200000`` — always
    False — so EVERY WebSocket reconnect returns zero bars for the
    disconnect window, leaving a permanent gap on the chart. Across
    multiple reconnects per session this accumulates into the "gaps and
    weird construction" symptom the user reported.

    Returns the parsed threshold. Returns 0 (or "" for date_tf) on parse
    failure to match the historical default-empty behavior.
    """
    try:
        if date_tf:
            return since_str  # ISO date string comparison
        v = int(since_str)
        # Stored bar `t` values are unix seconds (~1.7e9 in 2024-2030).
        # Anything >= 1e11 is unambiguously milliseconds (year 5138+ in
        # seconds). Downscale to bring it back into the seconds domain
        # so the `>` comparison against bar["t"] is meaningful.
        if v >= 100_000_000_000:
            v //= 1000
        return v
    except (ValueError, TypeError):
        return "" if date_tf else 0


def _get_bars_since_response(ticker: str, tf: str, bars: int, since_str: str) -> JSONResponse:
    """Return only bars newer than `since_str` for the browser's delta sync.

    Triggers a delta fetch from Massive if SQLite data is stale, then returns
    only the new rows — typically 0-5 bars, so payload is ~500 bytes vs 50 KB.
    """
    ticker_up = ticker.upper()
    _record_intraday_request(ticker_up, tf)
    cache_key = f"bars_{ticker_up}_{tf}_{bars}"
    date_tf = tf in ("D", "W", "M")

    # Parse the since threshold (auto-detects ms vs seconds for intraday)
    since_val = _normalize_since_param(since_str, date_tf)

    # Refresh SQLite if stale (same logic as _get_bars_inner)
    last_ts = _sqlite.get_last_ts(ticker_up, tf)
    if _needs_fresh(last_ts, tf):
        try:
            if tf == "D":
                new = _delta_daily(ticker_up, last_ts or 0)
            elif tf == "W":
                new = _delta_weekly(ticker_up, last_ts or 0)
            elif tf == "M":
                new = _delta_monthly(ticker_up, last_ts or 0)
            else:
                new = _delta_intraday(ticker_up, tf, last_ts or 0)
            if new:
                _sqlite.put_bars(ticker_up, tf, new, date_tf=date_tf)
                last_ts = _sqlite.get_last_ts(ticker_up, tf)
        except Exception:
            pass

    # Read ALL stored rows and filter to > since
    all_rows = _sqlite.get_bars(ticker_up, tf, bars)
    formatted = _fmt_sqlite_bars(all_rows, tf) if all_rows else []

    if date_tf:
        delta = [b for b in formatted if b["t"] > since_val]
    else:
        delta = [b for b in formatted if b["t"] > since_val]

    # Invalidate the full cache so the next non-delta request picks up fresh data
    cache.invalidate(cache_key)

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
                        # MUST write to SQLite (the audit's source of truth and
                        # _get_bars_inner's Layer 2). Earlier revisions wrote
                        # only to disk_cache + memory; that left SQLite empty
                        # for any ticker that hadn't been organically browsed,
                        # so audits showed bars_compared:0 and SWR delta-fetches
                        # had no last_ts to delta from. Persist to SQLite first
                        # then write the disk + memory layers as serving caches.
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
                            try:
                                _sqlite.put_bars(ticker_up, t, data, date_tf=True)
                            except Exception as _e:
                                # Persistence is the load-bearing write; if it
                                # fails the warm hasn't actually happened. Mark
                                # this ticker as failed instead of pretending
                                # success on the back of the disk_cache write.
                                import logging as _log_w
                                _log_w.getLogger(__name__).error(
                                    f"[warm] sqlite put_bars failed {ticker_up} tf={t}: "
                                    f"{type(_e).__name__}: {_e}"
                                )
                                return False
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


def _get_bars_inner(ticker: str, tf: str, bars: int):  # noqa: C901
    ticker_up = ticker.upper()
    _record_intraday_request(ticker_up, tf)
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

    # SQLite has fresh data AND enough rows for this request count.
    # The "len(stored_rows) >= bars * 0.9" check catches the case where SQLite
    # was previously populated with fewer bars than the user is now asking for
    # (e.g., a small bars=10 admin call populated SQLite with 10 rows, then a
    # chart asks for bars=300 — without this check the endpoint would happily
    # serve 10 rows because they're "fresh", leaving a huge gap on the chart).
    # Fall through to the stale-while-revalidate path when we have data but
    # less than requested — bg fetch will populate the missing depth.
    if stored_rows and not _needs_fresh(last_ts, tf) and len(stored_rows) >= bars * 0.9:
        # SQLite has enough fresh data — serve immediately, no API call.
        payload = {"ticker": ticker_up, "tf": tf, "bars": _fmt_sqlite_bars(stored_rows, tf)}
        cache.set(cache_key, payload, ttl=_CACHE_TTL.get(tf, 300))
        return JSONResponse(
            content=payload,
            headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
        )

    # Cold-stale intraday (missing >=1 whole session) must NOT be served
    # stale-while-revalidate — charts fetch once per mount, so they'd pin
    # the frozen first paint and never pick up the bg heal (the May-8
    # universe-freeze bug). Fall through to Layer 4's synchronous,
    # de-duplicated delta fetch so the FIRST paint is already correct.
    # Same-session staleness still uses fast SWR below (serve instantly,
    # top up the developing bar in the background).
    if stored_rows and last_ts and not _is_cold_stale_intraday(tf, last_ts):
        # Partial cache: SQLite has SOME rows but fewer than the chart asked
        # for. The block above ("len(stored_rows) >= bars * 0.9") falls
        # through here on purpose so the bg path can populate the missing
        # historical depth — but a delta-only refresh fetches AFTER last_ts,
        # which is "today," so it returns nothing and the chart is stuck at
        # the truncated row count forever. Promote partial-cache bg fetches
        # to a full fetch so put_bars (INSERT OR REPLACE) actually fills the
        # gap. Symptom this fixes: warm-universe completed but NVDA/AAPL
        # only had 6 of 200 bars cached and never recovered.
        is_partial = len(stored_rows) < bars * 0.9

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
                    _partial=is_partial,
                ):
                    try:
                        if _partial:
                            # Full fetch — cache is missing historical depth.
                            # put_bars uses INSERT OR REPLACE so this merges
                            # with any existing rows instead of duplicating.
                            if _tf in ("1", "5", "15", "30", "60"):
                                new = _fetch_intraday(_sym, _tf, _bars)
                            elif _tf == "W":
                                new = _fetch_weekly(_sym, _bars)
                            elif _tf == "M":
                                new = _fetch_monthly(_sym, _bars)
                            else:
                                new = _fetch_daily(_sym, _bars)
                            # Mirror cold-fetch guard: don't persist stale
                            # intraday fallback (yfinance returning hours-old
                            # data) since it'd be served as fresh next time.
                            if new and (_dtf or not _is_intraday_stale(new)):
                                _sqlite.put_bars(_sym, _tf, new, date_tf=_dtf)
                        else:
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
                        # Only cache with the full TF TTL when the bg fetch
                        # actually advanced the data. When `new` is empty, the
                        # delta-fetch either silently failed (httpx pool
                        # exhaustion, network blip, Polygon hiccup) or returned
                        # no new bars. Caching the unchanged stale payload
                        # with a 5-minute TTL traps the chart in stale state
                        # for that whole window — every subsequent request
                        # within 5min hits Layer 1 cache and skips the SWR
                        # path that would otherwise retry the bg fetch.
                        # Use a short retry TTL so we re-attempt soon.
                        if new:
                            cache.set(_key, fresh_payload, ttl=_CACHE_TTL.get(_tf, 300))
                        else:
                            cache.set(_key, fresh_payload, ttl=15)
                    except Exception as _bg_e:
                        import logging as _log_bg
                        _log_bg.getLogger(__name__).error(
                            f"[bars] bg_delta {_sym} tf={_tf} partial={_partial}: "
                            f"{type(_bg_e).__name__}: {_bg_e}"
                        )
                    finally:
                        with _inflight_lock:
                            _inflight.pop(_key, None)
                        _ev.set()

                _threading.Thread(
                    target=_bg_delta, daemon=True,
                    name=f"bars-bg-{ticker_up}-{tf}{'-partial' if is_partial else ''}",
                ).start()

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
                # Slice to the requested count for the response. We stored ALL
                # fetched bars in SQLite above (so future larger requests don't
                # have to refetch), but the caller only needs `bars` count back.
                result_bars = raw[-bars:] if raw else []

            except Exception as e:
                import traceback as _tb
                _logger.error(
                    f"[bars] full fetch failed {ticker_up} tf={tf}: {e}\n{_tb.format_exc()}"
                )
                result_bars = []

        # Build payload and write to cache BEFORE releasing waiters, so that
        # concurrent waiters that wake in the finally block read fresh data.
        payload = {"ticker": ticker_up, "tf": tf, "bars": result_bars}
        # Don't cache empty results — let the next request retry immediately.
        # Caching empty for 5s creates a "poisoned" window where every concurrent
        # client gets bars=[] even if the upstream API would now succeed.
        if result_bars:
            cache.set(cache_key, payload, ttl=ttl)

    finally:
        # Always release waiters — cache is already populated above.
        with _inflight_lock:
            _inflight.pop(cache_key, None)
        waiter_ev.set()

    return JSONResponse(
        content=payload,
        headers={"Cache-Control": f"public, max-age={ttl}"},
    )


# ── Multi-source retry on validation failure ────────────────────────────────
# Public wrapper that fetches from the configured intraday source chain
# (Massive → FMP → yfinance) and retries the next source whenever the
# returned payload fails bar-level validation.  Existing callers continue to
# use _fetch_intraday() directly; routes that opt in to this stricter path
# (Plan 3) call fetch_with_validation() instead.
from api.services import bar_validation as _bar_validation


def _extract_bars(result):
    """Normalize a fetch result into an iterable of bar dicts.

    The internal _fetch_intraday_* helpers return ``list[dict]``. Test
    doubles and future call sites may return a payload-shaped dict
    ``{"bars": [...], "source": "..."}``. Accept both.
    """
    if not result:
        return None
    if isinstance(result, dict):
        return result.get("bars")
    if isinstance(result, list):
        return result
    return None


_PARTIAL_VALIDATION_THRESHOLD = 0.5  # accept payload if ≥50% of bars validate


def _payload_passes_validation(result, prior_close=None) -> bool:
    """Return True if the payload exists and at least 50% of its bars validate.

    Per-bar validation + quarantine still happens at cache write — the bad
    bars are filtered there. This function only decides whether to fall
    through to an alternate source. A few invalid bars (earnings gaps,
    splits, halts) shouldn't force a 5s+ alt-source fetch.

    ``prior_close`` seeds the first bar's chained-context check; on subsequent
    bars, ``pc`` only advances when the bar validates so a corrupt bar can't
    drag the reference close (matches what bars_disk_cache.put() does).
    Non-dict elements are skipped (defensive against sentinels in legacy
    payloads).
    """
    bars = _extract_bars(result)
    if not bars:
        return False
    pc = prior_close
    valid = 0
    total = 0
    for bar in bars:
        if not isinstance(bar, dict):
            continue  # skip sentinels
        total += 1
        ok, _ = _bar_validation.validate_bar(bar, prior_close=pc)
        if ok:
            valid += 1
            pc = bar.get("c", pc)
    if total == 0:
        return False
    return (valid / total) >= _PARTIAL_VALIDATION_THRESHOLD


def fetch_with_validation(
    ticker: str,
    tf: str,
    bars: int,
    prior_close: float | None = None,
):
    """Fetch from primary; if it fails validation, fall back through alternates.

    Order: Massive → FMP (intraday only) → yfinance.  Returns the first
    payload whose every bar passes validation, or ``None`` if every source
    yielded corrupt or empty data.  The return shape mirrors whatever the
    underlying fetch helper returned (typically ``list[dict]``).

    Per-source circuit breaker (Plan 3 Task 3): each source is gated on its
    rolling 1-hour pass-rate.  When a source has been silently producing
    corrupt or empty payloads, it gets marked ``degraded`` and skipped here
    so the next source in the chain takes over.  Auto-recovers when the
    rolling window shows 95%+ pass rate again.
    """
    from api.services import source_circuit_breaker as _scb

    # Primary: Massive
    if _scb.is_ok("massive"):
        try:
            payload = _fetch_intraday_massive(ticker, tf, bars)
            valid = _payload_passes_validation(payload, prior_close)
            _scb.record_attempt("massive", success=valid)
            if valid:
                return payload
        except Exception:
            _scb.record_attempt("massive", success=False)

    # FMP — intraday timeframes only
    if tf in ("1", "5", "15", "30", "60") and _scb.is_ok("fmp"):
        try:
            payload = _fetch_intraday_fmp(ticker, tf, bars)
            valid = _payload_passes_validation(payload, prior_close)
            _scb.record_attempt("fmp", success=valid)
            if valid:
                return payload
        except Exception:
            _scb.record_attempt("fmp", success=False)

    # yfinance fallback (split-adjusted, includes premarket)
    if _scb.is_ok("yfinance"):
        try:
            payload = _fetch_intraday_yfinance(ticker, tf, bars)
            valid = _payload_passes_validation(payload, prior_close)
            _scb.record_attempt("yfinance", success=valid)
            if valid:
                return payload
        except Exception:
            _scb.record_attempt("yfinance", success=False)

    return None


def fetch_minute_snapshot(ticker: str, minute_ts: int) -> dict | None:
    """Fetch the 1m bar for the given minute timestamp from Massive (primary).

    Used by candle_reconcile at minute boundaries to compare WS-built bars
    against an authoritative REST snapshot.

    Returns the bar dict or None if unavailable.
    """
    try:
        # Fetch a small window around the target minute (5 bars covers ~5 min)
        bars = _fetch_intraday_massive(ticker, "1", 5)
        if not bars:
            return None
        for b in bars:
            if isinstance(b, dict) and b.get("t") == minute_ts:
                return b
    except Exception:
        return None
    return None


# Public API for router + worker consumers.
__all__ = [
    "_get_bars_inner",
    "_get_bars_since_response",
    "_fmt_sqlite_bars",
    "_needs_fresh",
    "_run_universe_warm",
    "_run_universe_warm_multi_tf",
    "_warm_state",
    "_warm_state_lock",
    "_CACHE_TTL",
    "_inflight",
    "_inflight_lock",
    "warm_bars_async",
    "_check_admin_auth",
    "_build_universe_ticker_list",
    "_DEFAULT_WARM_TFS",
    "_bars_warm_pool",
    "_BarsWarmExecutor",
    "fetch_with_validation",
    "fetch_minute_snapshot",
]
