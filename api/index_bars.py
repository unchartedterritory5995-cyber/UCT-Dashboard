"""
index_bars.py — cache-backed bars for cash-settled indexes that the old Schwab
/pricehistory doesn't serve (SPX, NDX, VIX, RUT, DJX, XSP, XND).

WHY THIS EXISTS
  Schwab (retired 2026-11-17) served /pricehistory for ETFs but returned {"bars": []} for cash indexes.
  We source those from yfinance (^GSPC for SPX, ^NDX for NDX, …).

⭐ INSTANT-CHARTS REWRITE (2026-08-31)
  The old version hit yfinance SYNCHRONOUSLY on EVERY request — including every 30s
  intraday poll and 300s daily poll from every open chart — with ZERO caching, and
  intraday did up to FOUR sequential yfinance downloads (index bars + two proxy-ratio
  downloads + ETF bars). That was the multi-second index latency.

  Now indices ride the same "read is never a provider call" principle as stocks, but
  in their OWN isolated store (NOT bars.db — index bars have unix-second timestamps,
  non-Friday weekly keys and divisors that would trip bars.db's weekly-Friday purge,
  reconciliation and split-sanitize). Layers, fastest first:
    1. In-process TTL cache (the shared `cache`)              — <1ms
    2. Disk snapshot  <DATA_DIR>/index_bars_cache/{SYM}_{tf}.json
    3. yfinance fetch (cold miss OR the background warm loop) — the only slow tier
       + the intraday HOLE REPAIR (2026-11-18, `repair_rth_holes`): a settled session Yahoo
         answers incompletely is filled from FMP's own bars, never invented; sidecar
         <DATA_DIR>/index_bars_cache/{YAHOO}_{tf}.repair.json
  STALE-WHILE-REVALIDATE: if we have ANY cached series it is served IMMEDIATELY and a
  refresh is kicked to a bounded background pool — a request never blocks on yfinance
  when we already have data, EXCEPT the two intraday copies `_cached_series` refreshes in the
  request (one over an hour old; one whose newest bar has ended since it was stored, 2026-11-20).
  The proxy ratio is cached (it drifts ~quarterly), so the
  intraday proxy no longer pays 2 extra downloads per request.

  A warm loop (`start_index_warm`) keeps all 7 indices hot in the disk store so even the
  first request after a deploy is a cache hit. Only 7 symbols, so warming is negligible
  (unlike the full equity universe, which is worker-only).

  ⛔ IT RUNS ON BOTH POD TYPES THAT SERVE THIS MODULE, BECAUSE EACH HAS ITS OWN STORE.
  `<DATA_DIR>/index_bars_cache` is per volume. The web pod warms every timeframe; the
  bars-api tier, which is where the Cloudflare Worker sends a member's `/api/bars/<sym>`
  (edge/bars-edge-router), warms `SERVING_TIER_WARM_TFS`. ⚰️ Until 2026-11-17 only web ran
  the loop: the tier's daily copies were refreshed only when a read kicked them, so RUT,
  DJX and XSP answered a 2026-10-22 tail and XND a 10-28 one (smoke@, 19:30Z) while web's
  own store was fresh and its warm passes logged `failed: 0`.
  A refresh that gets nothing leaves the stored copy in place (never deleted), is logged
  by name (`refresh FAILED <SYM> <tf>`), and every answer says how current it is:
  `refreshed_at` and `refresh_state` (`fetch_index_bars`).

Output shape is unchanged: {"ticker", "tf", "bars":[{t,o,h,l,c,v}...]} with t = unix
seconds for ALL timeframes (the client's _dateToMs handles numeric t).
"""

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, List, Dict, Any

from api.services import yf_util

logger = logging.getLogger("index_bars")

# (Yahoo symbol, divisor to convert index level → option-strike scale)
INDEX_MAP = {
    "SPX": ("^GSPC", 1.0),
    "NDX": ("^NDX",  1.0),
    "VIX": ("^VIX",  1.0),
    "RUT": ("^RUT",  1.0),
    "DJX": ("^DJI",  100.0),   # DJX = Dow Jones / 100
    "XSP": ("^GSPC", 10.0),    # XSP = SPX / 10
    "XND": ("^NDX",  100.0),   # XND = NDX / 100
}
INDEX_TICKERS = frozenset(INDEX_MAP.keys())

# ETF proxy — used when the index symbol returns sparse intraday.
#   ratio = latest_daily_close(target_yahoo) / latest_daily_close(etf)
ETF_PROXY = {
    "SPX": ("SPY", "^GSPC"),
    "XSP": ("SPY", "^GSPC"),
    "NDX": ("QQQ", "^NDX"),
    "XND": ("QQQ", "^NDX"),
    "RUT": ("IWM", "^RUT"),
    "DJX": ("DIA", "^DJI"),
}

TF_MAP = {
    "1":  "1m",  "5":  "5m",  "15": "15m",
    "30": "30m", "60": "60m", "1h": "60m",
    "D":  "1d",  "W":  "1wk", "M":  "1mo",
    "d":  "1d",  "w":  "1wk", "m":  "1mo",
}
PERIOD_MAP = {
    "1m":  "7d",
    "2m":  "60d", "5m":  "60d", "15m": "60d", "30m": "60d",
    # ⭐ RS RATING L12 (2026-11-18): yfinance serves 730 days of 60m bars (^GSPC: 5,077 from 2023-12-20, read
    # 2026-11-18); asking 60 days gave an hourly chart of an index, and Fred RS's RS line on any 1h chart
    # (SP:SPX at the chart's own period), only its last 60 sessions. The finer intervals stay at yfinance's own
    # 60-day cap.
    "60m": "730d", "90m": "60d",
    # ⭐ RS RATING L9: daily reads the FULL period and is cut at `_daily_window_start`, the
    # same span the FMP primary reads, so primary and fallback answer alike (it was "5y").
    "1d":  "max", "5d":  "5y",  "1wk": "10y", "1mo": "max", "3mo": "max",
}
INTRADAY_SPARSE_THRESHOLD = 10
INTRADAY_INTERVALS = frozenset({"1m", "2m", "5m", "15m", "30m", "60m", "90m"})

# Freshness / cache TTLs by UI tf (seconds). Older than this ⇒ served stale + a
# background refresh is kicked (never blocks). Daily updates once/day; intraday fast.
_TTL = {"D": 21600, "W": 86400, "M": 86400,
        "60": 300, "30": 300, "15": 300, "5": 300, "1": 120}
_PROXY_RATIO_TTL = 3600   # ratio drifts ~quarterly; 1h is plenty and kills the 2 downloads

_DATA_DIR = os.environ.get("DATA_DIR", "/data")
_DISK_DIR = os.environ.get("INDEX_BARS_CACHE_DIR", os.path.join(_DATA_DIR, "index_bars_cache"))

# Bounded background pool for stale-while-revalidate refreshes (dedup by key).
_bg_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="index-bars-refresh")
_bg_inflight: set[str] = set()
_bg_lock = threading.Lock()
#: "SYM_tf" -> set when the refresh holding that key in `_bg_inflight` finishes, so a request that finds the
#: refresh running can wait for it (`_await_refresh`) instead of answering the copy it is replacing.
_inflight_done: Dict[str, threading.Event] = {}


def _claim_locked(key: str) -> None:
    """Mark `key` refreshing. The caller holds `_bg_lock`."""
    _bg_inflight.add(key)
    _inflight_done[key] = threading.Event()


def _release(key: str) -> None:
    """The refresh holding `key` is done (stored, empty or failed): free the key and wake its waiters."""
    with _bg_lock:
        _bg_inflight.discard(key)
        done = _inflight_done.pop(key, None)
    if done is not None:
        done.set()


def is_index(ticker: str) -> bool:
    """True if the ticker should route through yfinance (the index path)."""
    return (ticker or "").upper().strip() in INDEX_TICKERS


def index_symbols() -> list[str]:
    return sorted(INDEX_TICKERS)


# ── yfinance fetch (the only slow tier) ──────────────────────────────────────
def _quote(v) -> float:
    """A yfinance price as its 2-decimal quote (yfinance carries float32-wide values: 7340.6298828125)."""
    return round(float(v), 2)


def _fetch_yf(yahoo_sym: str, interval: str, period: str,
              divisor: float) -> List[Dict[str, Any]]:
    """Pull the FULL available series from yfinance → [{t,o,h,l,c,v}] (unix-sec t,
    price ÷ divisor). [] on any failure. No slice / no since-filter here — the cache
    stores the whole series and the serve fn slices."""
    try:
        import yfinance as yf
    except ImportError:
        logger.error("[index_bars] yfinance not installed")
        return []
    try:
        df = yf_util.bounded_call(
            lambda: yf.download(yahoo_sym, period=period, interval=interval,
                                auto_adjust=False, prepost=False, progress=False,
                                threads=False),
            None,
        )
    except Exception as e:
        logger.error(f"[index_bars] yfinance.download failed {yahoo_sym} {interval} {period}: {e}")
        return []
    if df is None or df.empty:
        return []
    if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
        df.columns = df.columns.get_level_values(0)
    out: List[Dict[str, Any]] = []
    for idx, row in df.iterrows():
        try:
            t = int(idx.timestamp())
            # ⭐ RS RATING L12 (2026-11-18): yfinance hands an index level as a float32-wide value (7340.6298828125 for
            # the 7340.63 print), ~1e-7 off the quote TradingView reads; Fred RS's RS line on a 5m chart then differed
            # from TradingView's on every bar (4,677 of 4,680 equal once rounded). Rounded to the source's own quote
            # (cents: every yfinance symbol here, the indices and the ETF proxies, quotes 2 decimals) BEFORE the divisor,
            # so DJX (^DJI / 100) and XSP (^GSPC / 10) keep their extra digits.
            o = _quote(row["Open"]) / divisor
            h = _quote(row["High"]) / divisor
            l = _quote(row["Low"]) / divisor
            c = _quote(row["Close"]) / divisor
            v_raw = row.get("Volume", 0)
            v = int(v_raw) if v_raw == v_raw else 0
        except (KeyError, ValueError, TypeError, AttributeError):
            continue
        if any(x != x for x in (o, h, l, c)):
            continue
        out.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v})
    return out


def _proxy_ratio(target_yahoo: str, etf_sym: str) -> Optional[float]:
    """index_level / etf_price from the latest daily close, CACHED (drifts slowly)."""
    from api.services.cache import cache
    ck = f"idxratio_{target_yahoo}_{etf_sym}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    try:
        import yfinance as yf

        def _daily(sym):
            return yf_util.bounded_call(
                lambda: yf.download(sym, period="5d", interval="1d",
                                    auto_adjust=False, progress=False, threads=False),
                None,
            )
        idx_df = _daily(target_yahoo)
        etf_df = _daily(etf_sym)
        if idx_df is None or idx_df.empty or etf_df is None or etf_df.empty:
            return None
        if hasattr(idx_df.columns, "nlevels") and idx_df.columns.nlevels > 1:
            idx_df.columns = idx_df.columns.get_level_values(0)
        if hasattr(etf_df.columns, "nlevels") and etf_df.columns.nlevels > 1:
            etf_df.columns = etf_df.columns.get_level_values(0)
        idx_close = float(idx_df["Close"].iloc[-1])
        etf_close = float(etf_df["Close"].iloc[-1])
        if etf_close <= 0:
            return None
        ratio = idx_close / etf_close
        cache.set(ck, ratio, ttl=_PROXY_RATIO_TTL)
        return ratio
    except Exception as e:
        logger.warning(f"[index_bars] proxy ratio fetch failed ({target_yahoo}/{etf_sym}): {e}")
        return None


#: ⭐ RS RATING L9 (docs/pine/RS-RATING-TRANSFER.md): daily index history reaches back to
#: here. It was 5 years (`365*5+2` days, yfinance `period="5y"`), so a script reading SPX on a
#: chart deeper than that drew `na` before the served SPX began (NVDA: TradingView's RS line
#: runs 6997 bars, ours was `na` before 2021-11-15). The owner asked for at least 1990.
INDEX_DAILY_HISTORY_START = "1990-01-01"
#: `INDEX_FMP_LOOKBACK_DAYS` (calendar days back from today), when set to a positive integer,
#: still decides the span, for the FMP primary AND the yfinance fallback alike.
LOOKBACK_ENV = "INDEX_FMP_LOOKBACK_DAYS"
#: The span of ONE FMP call. FMP may cap how much history one call returns, so the read is
#: paged; `INDEX_FMP_PAGE_DAYS` overrides it.
FMP_PAGE_DAYS = 365 * 5
#: The widest calendar gap between two consecutive sessions a served series may hold. The
#: longest US closure since 1990 (9/11-9/14/2001) leaves 7 days; anything wider is a hole in
#: the vendor's answer (a page it truncated or dropped), so the FMP read is not served.
_MAX_SESSION_GAP_DAYS = 10


def _daily_window_start(today):
    """The oldest session date a daily index series holds: `INDEX_FMP_LOOKBACK_DAYS` days
    before `today` when that env is a positive integer, else `INDEX_DAILY_HISTORY_START`.
    Read per call, so an env edit needs no restart."""
    import datetime as _dt
    raw = os.environ.get(LOOKBACK_ENV, "").strip()
    try:
        days = int(raw) if raw else 0
    except ValueError:
        days = 0
    if days > 0:
        return today - _dt.timedelta(days=days)
    return _dt.date.fromisoformat(INDEX_DAILY_HISTORY_START)


def _page_days() -> int:
    try:
        n = int(os.environ.get("INDEX_FMP_PAGE_DAYS", "") or FMP_PAGE_DAYS)
    except ValueError:
        n = FMP_PAGE_DAYS
    return n if n > 0 else FMP_PAGE_DAYS


def _utc_midnight(d) -> int:
    import datetime as _dt
    return int(_dt.datetime(d.year, d.month, d.day, tzinfo=_dt.timezone.utc).timestamp())


def _fetch_fmp_daily(index_symbol: str, divisor: float, today=None) -> List[Dict[str, Any]]:
    """Daily bars from FMP → [{t,o,h,l,c,v}] oldest first, `t` the UTC midnight of the
    session date: the same key `_fetch_yf` produces for a daily index bar (yfinance's
    daily index is a tz-naive date, which `.timestamp()` reads as UTC). [] on any
    failure, so the caller falls back to yfinance.

    ⭐ PRIMARY for daily bars by owner ruling 2026-11-14 (FMP top plan, Yahoo the
    fallback; docs/pine/RS-RATING-TRANSFER.md). ⛔ A row that does not parse completely is
    dropped, never repaired.

    ⭐ RS RATING L9 — PAGED, OLDEST PAGE FIRST, from `_daily_window_start` to today, in
    windows of `_page_days()` that tile the span; rows are deduplicated by session date (a
    later page wins). ⛔ NEVER A SERIES WITH A HOLE: a page that errors, a page FMP reports
    as empty after the history has begun, or two consecutive sessions more than
    `_MAX_SESSION_GAP_DAYS` apart, and the whole read is `[]` (the caller falls back). Only
    the pages BEFORE the index's first row may be empty."""
    import datetime as _dt
    try:
        from api.services import fmp_client
    except Exception as e:                        # noqa: BLE001 — the caller falls back
        logger.warning(f"[index_bars] FMP client unavailable: {e}")
        return []
    to_d = today or _dt.date.today()
    page = _dt.timedelta(days=_page_days())
    one = _dt.timedelta(days=1)
    by_date: Dict[Any, Dict[str, Any]] = {}
    start = _daily_window_start(to_d)
    f = start
    while f <= to_d:
        t_end = min(to_d, f + page - one)
        try:
            raw = fmp_client.get_index_history_eod_full(index_symbol, f.isoformat(),
                                                        t_end.isoformat()).value
        except fmp_client.FMPNotFound:
            if by_date:
                logger.warning(f"[index_bars] FMP daily {index_symbol}: no rows for "
                               f"{f}..{t_end} after the history began, a hole: not served")
                return []
            raw = []
        except Exception as e:                    # noqa: BLE001 — the caller falls back
            logger.warning(f"[index_bars] FMP daily {index_symbol} {f}..{t_end} failed: {e}")
            return []
        if not isinstance(raw, list):
            logger.warning(f"[index_bars] FMP daily {index_symbol} {f}..{t_end}: no list")
            return []
        for r in raw:
            try:
                d = _dt.date.fromisoformat(str(r["date"])[:10])
                o, h, l, c = (float(r[k]) / divisor for k in ("open", "high", "low", "close"))
                v_raw = r.get("volume") or 0
                v = int(v_raw) if v_raw == v_raw else 0
            except (KeyError, ValueError, TypeError):
                continue
            if any(x != x for x in (o, h, l, c)) or not (start <= d <= to_d):
                continue                          # unparseable, or outside the span asked
            by_date[d] = {"t": _utc_midnight(d), "o": o, "h": h, "l": l, "c": c, "v": v}
        f = t_end + one
    dates = sorted(by_date)
    for a, b in zip(dates, dates[1:]):
        if (b - a).days > _MAX_SESSION_GAP_DAYS:
            logger.warning(f"[index_bars] FMP daily {index_symbol}: {a} -> {b} is a hole, not served")
            return []
    return [by_date[d] for d in dates]


def _fetch_yf_daily(yahoo_sym: str, divisor: float) -> List[Dict[str, Any]]:
    """The yfinance FALLBACK for daily index bars: the full period, cut at the same
    `_daily_window_start` the FMP primary reads, so the two answer the same span."""
    import datetime as _dt
    start = _utc_midnight(_daily_window_start(_dt.date.today()))
    return [b for b in _fetch_yf(yahoo_sym, "1d", PERIOD_MAP["1d"], divisor) if b["t"] >= start]


def _fetch_full_series(sym: str, tf: str, info: Optional[dict] = None) -> List[Dict[str, Any]]:
    """Fetch the full available index series for (sym, tf): daily from FMP first
    (owner ruling 2026-11-14), everything else and every FMP miss from yfinance, with
    the intraday ETF-proxy fallback (ratio cached). `info`, when given, is told whether
    the answer is that proxy (`info["proxy"]`): an ETF scaled to the index's level, not
    the index's own bars (`todays_index_daily_bar` never builds from one)."""
    if info is not None:
        info["proxy"] = False
    yahoo_sym, divisor = INDEX_MAP[sym]
    interval = TF_MAP.get(tf)
    if not interval:
        return []
    if interval == "1d":
        out = _fetch_fmp_daily(yahoo_sym, divisor)
        if out:
            return out
        return _fetch_yf_daily(yahoo_sym, divisor)
    period = PERIOD_MAP.get(interval, "60d")
    out = _fetch_yf(yahoo_sym, interval, period, divisor)
    is_proxy = False
    if (interval in INTRADAY_INTERVALS and len(out) < INTRADAY_SPARSE_THRESHOLD
            and sym in ETF_PROXY):
        etf_sym, ratio_target = ETF_PROXY[sym]
        ratio = _proxy_ratio(ratio_target, etf_sym)
        if ratio is not None:
            proxy_out = _fetch_yf(etf_sym, interval, period, divisor / ratio)
            if len(proxy_out) > len(out):
                out = proxy_out
                is_proxy = True
                if info is not None:
                    info["proxy"] = True
    # ⛔ The ETF proxy is an ETF scaled to the index's level, never the index's own bars: it is
    # never "repaired" from the index, and nothing is filled from it.
    if out and interval in INTRADAY_INTERVALS and not is_proxy:
        out, repair = repair_rth_holes(sym, tf, out)
        # ⭐ DEEP SETTLED HISTORY (2026-11-21): FMP's settled sessions before Yahoo's first day, behind the seam
        # check; only on a series the repair could judge (on the exchange grid).
        if repair is not None:
            out, deep = _merge_deep(sym, tf, out)
            if deep is not None:
                repair = dict(repair, deep=deep)
                if deep.get("joined") and deep.get("sessions") and deep.get("rev"):
                    repair["history_rev"] = max(int(repair.get("history_rev") or 0), int(deep["rev"]))
        if info is not None and repair is not None:
            info["repair"] = repair
    return out


# ── ⭐ INTRADAY HOLE REPAIR, FROM A SECOND REAL VENDOR (2026-11-18) ─────────────────────────
# ⚰️ Measured on production 2026-11-18/19: /api/bars/SPX?tf=60 (Yahoo ^GSPC 60m, 730 days) had NO
# bar from 2026-01-30 11:30 to 2026-02-02 12:30 ET (9 buckets) and no 12:30 bar on any 13:00
# half-day (6 more), and the bars at the hole's edges were partial (01-30 10:30: about 8% of an
# hour's volume; 02-02 13:30: opening about 70 points above the session's open). Every way of
# asking Yahoo returns the same hole, on ^GSPC, ^NDX, ^DJI and ^RUT and in its SPY and QQQ too:
# the series this module stored was Yahoo's answer byte for byte. Fred RS refused its run by name
# ("SPX has no bar on 1770044400"); an RS line through the partial edge bars was silently wrong.
#
# So a SETTLED session Yahoo answers incompletely is asked of FMP (`fmp_client.get_index_intraday`,
# the daily primary's vendor and licensing row):
#   - the expected buckets are `intraday_gap_audit.expected_rth_buckets`, the ONE authority
#     (`_expected` only memoizes its answer per session shape);
#   - FMP's 1/5-minute bars become a bucket only when EVERY source bar of that bucket is present;
#   - FMP covers the whole session -> the whole Yahoo day is replaced (which also replaces the
#     partial bars at a hole's edges); otherwise FMP's buckets go into the slots Yahoo lacks and
#     nothing else changes;
#   - never interpolated, never carried forward, never the ETF proxy: a slot no vendor has stays
#     absent and is NAMED in the answer (`holes`), with the sessions repaired (`repaired`);
#   - FMP's answer per session is kept in a sidecar beside the series (`_repair_path`, one per
#     Yahoo symbol and tf, so SPX/XSP and NDX/XND share it): a complete session is never asked
#     again, an empty or partial one after REPAIR_NEGATIVE_TTL_S, a failed call after
#     REPAIR_ERROR_RETRY_S; at most REPAIR_MAX_FETCHES calls per refresh, and NONE on a request
#     thread (`_on_request_thread`: that refresh applies what the sidecar holds, and a background
#     refresh is kicked to ask the vendor);
#   - a series that is not on the authority's grid (Yahoo's ^VIX: clock hours across its extended
#     session) is left exactly as it is, and its answer carries no repair fields.
REPAIR_SOURCE = "fmp"
#: A session is judged (and asked of FMP) only once it closed this long ago: a vendor's minutes
#: settle after the close, and a sidecar entry for a complete session is kept for good.
REPAIR_SETTLE_S = 30 * 60
#: Vendor calls one refresh may make (newest sessions first); the rest wait for the next refresh.
REPAIR_MAX_FETCHES = 4
#: An empty or partial FMP answer for a session is asked again after this long.
REPAIR_NEGATIVE_TTL_S = 24 * 3600
#: A failed FMP call (refused, rate-limited, timed out) is retried after this long.
REPAIR_ERROR_RETRY_S = 3600
REPAIR_FMP_TIMEOUT_S = 10
#: `holes` lists at most this many (the newest); `holes_total` then says how many there are.
REPAIR_HOLES_MAX = 500
_REPAIR_TFS = {"1": "1", "5": "5", "15": "15", "30": "30", "60": "60", "1h": "60"}
#: The FMP interval each tf is rolled up from, and its step: the finest documented index
#: interval that divides every bucket (the 60m grid's 30-minute last bar included).
_REPAIR_SRC = {"1": ("1min", 60), "5": ("5min", 300), "15": ("5min", 300),
               "30": ("5min", 300), "60": ("5min", 300)}
_REPAIR_ZONE = "America/New_York"
_repair_tls = threading.local()
_repair_locks: Dict[str, threading.Lock] = {}
_repair_locks_guard = threading.Lock()
#: (tf, close minute, ET midnight's UTC offset) -> bucket offsets from ET midnight.
_expected_shapes: Dict[tuple, tuple] = {}


class _on_request_thread:
    """Marks a refresh that runs on a member's request: it applies what the sidecar already
    holds and never calls the repair vendor (the edge aborts a request at 8 s)."""

    def __enter__(self):
        self._prev = getattr(_repair_tls, "request_thread", False)
        _repair_tls.request_thread = True
        return self

    def __exit__(self, *exc):
        _repair_tls.request_thread = self._prev
        return False


def _vendor_repair_allowed() -> bool:
    return not getattr(_repair_tls, "request_thread", False)


def _et_midnight(d) -> int:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return int(datetime(d.year, d.month, d.day, tzinfo=ZoneInfo(_REPAIR_ZONE)).timestamp())


def _et_date(t):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.fromtimestamp(float(t), ZoneInfo(_REPAIR_ZONE)).date()


def _close_ts(d) -> int:
    from api.services import intraday_gap_audit as _gap
    return _et_midnight(d) + _gap._close_minutes(d) * 60


def _expected(tf: str, d) -> List[int]:
    """`intraday_gap_audit.expected_rth_buckets(tf, d)`: every regular-session bucket of session
    `d` (the sessions judged here have all closed). The authority computes the 60m grid minute by
    minute (~7 ms a session, 5 s for the 730 sessions a 60m series holds), so its answer is kept
    per session SHAPE (tf, close minute, ET midnight's UTC offset) as offsets from ET midnight and
    reused for every session of that shape. `tests/test_index_bars_gap_repair.py` holds this equal
    to the authority over every session of a 60m series."""
    from api.services import intraday_gap_audit as _gap
    if not _gap._is_session(d):
        return []
    mid = _et_midnight(d)
    key = (tf, _gap._close_minutes(d), mid % 86400)
    offs = _expected_shapes.get(key)
    if offs is None:
        offs = tuple(t - mid for t in _gap.expected_rth_buckets(tf, d))
        _expected_shapes[key] = offs
    return [mid + o for o in offs]


def _repair_path(yahoo_sym: str, tf: str) -> str:
    return os.path.join(_DISK_DIR, f"{yahoo_sym.lstrip('^')}_{tf}.repair.json")


def _repair_lock(path: str) -> threading.Lock:
    with _repair_locks_guard:
        return _repair_locks.setdefault(path, threading.Lock())


def _load_repair(path: str) -> dict:
    """The sidecar `{"days": {iso: {"state", "asked_at", "bars"}}, "changed_at"}`; an empty one
    when there is none or it cannot be read (it is a cache of vendor answers, never the only copy)."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        data = None
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[index_bars] repair sidecar unreadable {os.path.basename(path)}: {e}")
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("days"), dict):
        return {"days": {}, "changed_at": None}
    return data


def _save_repair(path: str, data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"))
        os.replace(tmp, path)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[index_bars] repair sidecar save failed {os.path.basename(path)}: {e}")


def _parse_fmp_intraday(rows, d) -> Dict[int, dict]:
    """FMP's rows of session `d`, keyed by bar start (unix s). `date` is the bar's START in ET wall
    clock; prices go to their quote (cents) as Yahoo's do (`_quote`). A row that is not a usable bar
    (a missing or non-finite price, a low above the high, a price <= 0) is dropped, never mended."""
    import math
    from datetime import datetime
    from zoneinfo import ZoneInfo
    zone = ZoneInfo(_REPAIR_ZONE)
    out: Dict[int, dict] = {}
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        try:
            when = datetime.strptime(str(r["date"]), "%Y-%m-%d %H:%M:%S").replace(tzinfo=zone)
            o, h, l, c = (_quote(r[k]) for k in ("open", "high", "low", "close"))
        except (KeyError, TypeError, ValueError):
            continue
        if when.date() != d or not all(math.isfinite(x) and x > 0 for x in (o, h, l, c)) or l > h:
            continue
        try:
            v = int(r.get("volume") or 0)
        except (TypeError, ValueError, OverflowError):
            v = 0
        t = int(when.timestamp())
        out[t] = {"t": t, "o": o, "h": h, "l": l, "c": c, "v": max(v, 0)}
    return out


def _roll_into_buckets(tf: str, d, src: Dict[int, dict], step_s: int) -> Dict[int, dict]:
    """The expected buckets of session `d` that `src` covers COMPLETELY (every `step_s` bar from the
    bucket's start to its end, the next bucket's start or the close). A bucket missing any source
    bar is left out: rolling up part of an hour is how Yahoo's partial edge bars were made."""
    exp = _expected(tf, d)
    if not exp:
        return {}
    ends = exp[1:] + [_close_ts(d)]
    out: Dict[int, dict] = {}
    for s, e in zip(exp, ends):
        parts = [src.get(t) for t in range(s, e, step_s)]
        if not parts or any(p is None for p in parts):
            continue
        out[s] = {"t": s, "o": parts[0]["o"], "h": max(p["h"] for p in parts),
                  "l": min(p["l"] for p in parts), "c": parts[-1]["c"],
                  "v": sum(int(p["v"]) for p in parts)}
    return out


def _repair_due(held: Optional[dict], now: float) -> bool:
    if not held:
        return True
    state = held.get("state")
    if state == "complete":
        return False
    wait = REPAIR_ERROR_RETRY_S if state == "error" else REPAIR_NEGATIVE_TTL_S
    try:
        return now - float(held.get("asked_at") or 0) >= wait
    except (TypeError, ValueError):
        return True


def _ask_vendor(yahoo_sym: str, tf: str, bad: Dict[Any, List[int]], side: dict,
                now: float) -> tuple:
    """Ask FMP for the due sessions of `bad`, newest first, at most REPAIR_MAX_FETCHES. Updates
    `side` in place. Returns (asked, pending): the calls made, and the due sessions left unasked."""
    from api.services import fmp_client
    interval, step = _REPAIR_SRC[tf]
    due = [d for d in sorted(bad, reverse=True) if _repair_due(side["days"].get(d.isoformat()), now)]
    changed, asked = False, 0
    for i, d in enumerate(due[:REPAIR_MAX_FETCHES]):
        iso = d.isoformat()
        held_bars = {int(b["t"]): b for b in (side["days"].get(iso) or {}).get("bars") or []
                     if isinstance(b, dict) and isinstance(b.get("t"), (int, float))}
        try:
            res = fmp_client.get_index_intraday(yahoo_sym, interval, iso, iso,
                                                timeout=REPAIR_FMP_TIMEOUT_S)
            if getattr(res, "degraded", None):
                raise RuntimeError(f"degraded answer: {res.degraded}")
            raw = getattr(res, "value", None)
        except fmp_client.FMPNotConfigured:
            # No key on this process: nothing can be asked, and nothing is recorded as asked.
            return asked, len(due) - i
        except fmp_client.FMPNotFound:
            raw = []
        except Exception as e:  # noqa: BLE001 - fail-soft: the hole stays and is named
            asked += 1
            logger.warning(f"[index_bars] repair ask FAILED {yahoo_sym} {tf} {iso}: "
                           f"{type(e).__name__}: {e}")
            side["days"][iso] = {"state": "error", "asked_at": now,
                                 "bars": [held_bars[t] for t in sorted(held_bars)]}
            continue
        asked += 1
        got = _roll_into_buckets(tf, d, _parse_fmp_intraday(raw, d), step)
        merged = {**held_bars, **got}
        full = _expected(tf, d)
        state = ("complete" if full and all(t in merged for t in full)
                 else "partial" if merged else "empty")
        if merged != held_bars:
            changed = True
        side["days"][iso] = {"state": state, "asked_at": now,
                             "bars": [merged[t] for t in sorted(merged)]}
    if changed:
        # The time (ms) the held history last changed, never moving backwards: the answer's
        # `history_rev`, so a chart holding the old rows re-reads them (barStore/reducer.js).
        side["changed_at"] = max(int(side.get("changed_at") or 0) + 1, int(now * 1000))
    return asked, max(0, len(due) - REPAIR_MAX_FETCHES)


def repair_rth_holes(sym: str, tf: str, series: list, now: Optional[float] = None):
    """`series` (Yahoo's intraday answer for index `sym`, already divided) with the holes of its
    settled sessions filled from FMP (see the block above), and the repair's record:
    `{"src", "repaired": [{"d", "src", "buckets", "whole_day"}], "holes": [t...], "pending",
    "history_rev"}`. Returns (series, None) unchanged when there is nothing this can judge: not an
    intraday tf, not an index, empty, or not on the authority's grid."""
    rtf = _REPAIR_TFS.get(tf)
    if rtf is None or sym not in INDEX_MAP or not series:
        return series, None
    now = float(now if now is not None else time.time())
    yahoo_sym, divisor = INDEX_MAP[sym]
    rows = sorted((b for b in series if isinstance(b, dict) and isinstance(b.get("t"), (int, float))
                   and not isinstance(b.get("t"), bool)), key=lambda b: b["t"])
    if not rows:
        return series, None
    by_day: Dict[Any, list] = {}
    for b in rows:
        by_day.setdefault(_et_date(b["t"]), []).append(b)
    for d, bars in by_day.items():
        exp = set(_expected(rtf, d))
        if any(int(b["t"]) not in exp for b in bars):
            return series, None            # another grid (^VIX's clock hours): not judged here
    import datetime as _dt
    first_ts = rows[0]["t"]
    first, last = min(by_day), max(by_day)
    bad: Dict[Any, List[int]] = {}
    d = first
    while d <= last:
        if _close_ts(d) + REPAIR_SETTLE_S <= now:
            exp = [t for t in _expected(rtf, d) if t >= first_ts]   # before the first row: depth
            have = {int(b["t"]) for b in by_day.get(d, [])}
            miss = [t for t in exp if t not in have]
            if miss:
                bad[d] = miss
        d += _dt.timedelta(days=1)

    path = _repair_path(yahoo_sym, rtf)
    pending = 0
    if bad and _vendor_repair_allowed():
        with _repair_lock(path):
            side = _load_repair(path)
            asked, pending = _ask_vendor(yahoo_sym, rtf, bad, side, now)
            if asked:
                _save_repair(path, side)
    else:
        side = _load_repair(path)
        pending = sum(1 for x in bad if _repair_due(side["days"].get(x.isoformat()), now))

    def _scaled(b):
        return {"t": int(b["t"]), "o": b["o"] / divisor, "h": b["h"] / divisor,
                "l": b["l"] / divisor, "c": b["c"] / divisor, "v": int(b.get("v") or 0)}

    out = list(rows)
    repaired, holes = [], []
    whole_days = set()
    for d in sorted(bad):
        miss = bad[d]
        held = {int(b["t"]): b for b in (side["days"].get(d.isoformat()) or {}).get("bars") or []
                if isinstance(b, dict) and isinstance(b.get("t"), (int, float))}
        full = _expected(rtf, d)
        if held and full and all(t in held for t in full):
            whole_days.add(d)
            out.extend(_scaled(held[t]) for t in full)
            repaired.append({"d": d.isoformat(), "src": REPAIR_SOURCE, "buckets": len(full),
                             "whole_day": True})
            continue
        add = [_scaled(held[t]) for t in miss if t in held]
        out.extend(add)
        if add:
            repaired.append({"d": d.isoformat(), "src": REPAIR_SOURCE, "buckets": len(add),
                             "whole_day": False})
        holes.extend(t for t in miss if t not in held)
    if whole_days:
        replaced = {id(b) for d in whole_days for b in by_day.get(d, [])}
        out = [b for b in out if id(b) not in replaced]
    out.sort(key=lambda b: b["t"])
    if repaired or holes:
        logger.info(f"[index_bars] repair {sym} {tf}: {len(repaired)} session(s) from {REPAIR_SOURCE}"
                    f" ({sum(1 for r in repaired if r['whole_day'])} whole), {len(holes)} hole(s) left,"
                    f" {pending} session(s) not yet asked")
    held_any = any((v or {}).get("bars") for v in side["days"].values())
    return out, {"src": REPAIR_SOURCE, "repaired": repaired, "holes": sorted(holes),
                 "pending": pending,
                 "history_rev": int(side["changed_at"]) if held_any and side.get("changed_at") else None}


def _repair_fields(rep: dict, out: list) -> dict:
    """The repair's record as answer fields, cut to the sessions the answer spans."""
    if not out:
        return {"repaired": [], "holes": [], "history_rev": rep.get("history_rev")}
    import datetime as _dt
    lo, hi = _et_date(out[0]["t"]), _et_date(out[-1]["t"])
    repaired = []
    for r in rep.get("repaired") or []:
        try:
            if lo <= _dt.date.fromisoformat(r["d"]) <= hi:
                repaired.append(r)
        except (KeyError, TypeError, ValueError):
            continue
    holes_all = [t for t in rep.get("holes") or [] if lo <= _et_date(t) <= hi]
    fields = {"repaired": repaired, "holes": holes_all[-REPAIR_HOLES_MAX:],
              "history_rev": rep.get("history_rev")}
    if len(holes_all) > REPAIR_HOLES_MAX:
        fields["holes_total"] = len(holes_all)
    deep = rep.get("deep")
    if isinstance(deep, dict):
        fields["deep"] = {k: deep.get(k) for k in ("src", "joined", "sessions", "from", "reason")}
        seam = deep.get("seam")
        if isinstance(seam, dict):
            fields["deep"]["seam"] = {k: seam.get(k) for k in ("d", "compared", "equal", "worst_rel")}
        # ⛔ (2026-11-22) THE ETF FILL's disclosure, cut to the answer's span like `repaired`: production served the
        # filled run with no `filled` field because this projection named only the five keys above.
        filled = []
        for f in deep.get("filled") or []:
            try:
                if lo <= _dt.date.fromisoformat(f["d"]) <= hi:
                    filled.append({k: f.get(k) for k in ("d", "slots", "src")})
            except (KeyError, TypeError, ValueError):
                continue
        fields["deep"]["filled"] = filled
    return fields


# ── ⭐ DEEP SETTLED HISTORY FROM FMP (2026-11-21, coordinator ruling on Fred RS's intraday grade) ──────────────
# ⚰️ WHY. Fred RS's RS line on SPY 5m / 30m was BLANK before about 60 days back where TradingView draws it
# (grade fred-intra-2026-11-21: 9,203 of 20,706 5m bars, 21,275 of 23,195 30m bars): this module served Yahoo's
# intraday index bars only, and Yahoo keeps 60 days of 5/15/30m (730 of 60m). FMP (the daily primary's vendor and
# licensing row, owner ruling 2026-11-14: FMP primary for index data, no Massive) serves ^GSPC 5min COMPLETE regular
# sessions at least 3 years back (measured on the web pod 2026-11-21: 78 bars a session at 45/120/400/1,100 days
# back), and on 12 shared days agreed with Yahoo on 544 of 546 5m closes to the cent (4 scattered prints, $0.05 to
# $2.06) and on every 30m / 60m bar but the NEWEST session's last (FMP had not settled it).
#
# THE SPLIT (coordinator, 2026-11-21): FMP is the source of SETTLED HISTORY; the LIVE TAIL stays Yahoo, whose tail
# rules (D7 withhold, D8/D9 refresh in the request, the index tail never behind) are the measured ones.
#   - ONE store per vendor symbol: FMP's 5-minute bars per settled session (`_deep_path`); 5/15/30/60 roll up from
#     it with `_roll_into_buckets` (a bucket only when every 5-minute bar of it is present).
#   - A session is COMPLETE when it holds every 5-minute bar the exchange calendar expects
#     (`intraday_gap_audit.expected_rth_buckets`: 78 on a full day, 42 on a 13:00 half-day); a holiday is no session,
#     never a missing one. A session enters only once SETTLED (`REPAIR_SETTLE_S` after its close).
#   - BACKFILLED ONCE, newest session first, on ITS OWN background thread (`start_deep_backfill`), never on a
#     request or warm thread, never inside the boot settle window (`bg_lane`'s rules: one item at a time after
#     600 s; where the lane is not active, the same 600 s from this module's load), at most `DEEP_MAX_FETCHES` FMP
#     calls a pass. Then INCREMENTAL: a pass asks only sessions that settled since (one call a day per symbol).
#   - SERVED: Yahoo's series as before, with a CONTIGUOUS run of complete FMP sessions PREPENDED before Yahoo's first
#     day (it stops at the first session the store lacks: never a hole). Yahoo is authoritative wherever it holds a
#     session.
#   - ⛔ THE SEAM: the first Yahoo session is compared bar by bar with FMP's copy of it; beyond the measured noise
#     (`SEAM_MAX_REL`, `SEAM_MAX_DIFF_FRAC`), or when FMP lacks it, nothing is joined (Yahoo only, `deep.joined` false
#     with the reason): a seam cliff on an RS line would be a new wrong picture.
#   - ⛔ A REQUEST NEVER PARSES THE STORE: the prefix is built on a background refresh and cached per (symbol, tf,
#     store version, Yahoo's first day); a request refresh that finds none serves Yahoo only.
#   - SIZE: about 6 years of 5m is ~118,000 bars, about 8 MB of JSON per vendor symbol on disk (2026-11-22: 3 -> 6 years).
# Kill switch: INDEX_INTRADAY_DEEP_ENABLED=0 (unset = on) serves exactly what this module served before.
DEEP_SOURCE = "fmp"
#: Calendar days of settled history the store holds (about 6 years).
DEEP_DAYS = 2190
#: ⭐ (2026-11-22) 6 years, not 3: FMP's 5min answers ^GSPC from 2020 and ^NDX from 2021 (measured on the pod; 2019
#: answers "no data"), and TradingView's own SPY 60m window in the Fred RS capture began 2021-01-04 while ours began
#: 2023-11-24. A session before FMP's history is recorded "empty" and ends the run, as before. The 5-minute GRID itself
#: is served at most DEEP_5M_SERVED_DAYS: `/api/bars` answers at most 60,000 bars (`bars: Query(le=60000)`), which 3
#: years of 5m already fill; the deeper sessions serve 15 / 30 / 60.
DEEP_5M_SERVED_DAYS = 1095
#: The UI timeframes served with deep history, and the grid each rolls to.
DEEP_TFS = {"1": "1", "5": "5", "15": "15", "30": "30", "60": "60", "1h": "60"}
#: The indices served with deep history (SPX/NDX: what relative-strength scripts read). XSP/XND/RUT/DJX/VIX: as before.
DEEP_SERVED_SYMS = frozenset({"SPX", "NDX"})
DEEP_SRC_INTERVAL, DEEP_SRC_STEP = "5min", 300
# ⭐ THE 1-MINUTE LANE (2026-11-22): Yahoo's ^GSPC 1m holds 7 sessions, a stock's own 1m chart about 5 months, so
# Fred RS on 1m drew 7 sessions. FMP's 1min (3 sessions an answer, back to 2023) equals Yahoo's 1m to the cent on 2,337
# of 2,340 bars (worst 1.1e-4, 6 sessions, measured on the pod 2026-11-22) and its 5-minute roll-up equals FMP's own
# 5min. It is kept in its OWN store (`_deep_path(sym, "1")`), DEEP_1M_DAYS deep, and served before Yahoo's on tf=1
# behind the same seam, run and ETF-fill rules as the 5-minute lane. A lane = the served grid it backs: "5" backs
# 5 / 15 / 30 / 60 (rolled up), "1" backs 1.
DEEP_1M_DAYS = 180
DEEP_1M_PAGE_DAYS = 4
DEEP_LANE_TFS = {"5": ("5", "15", "30", "60"), "1": ("1",)}


def _lane(rtf: str) -> str:
    """The store lane a served grid rolls up from."""
    return "1" if rtf == "1" else "5"


def _lane_cfg(lane: str) -> tuple:
    """(FMP interval, step seconds, calendar days held, calendar days a page) of a lane."""
    if lane == "1":
        return "1min", 60, DEEP_1M_DAYS, DEEP_1M_PAGE_DAYS
    return DEEP_SRC_INTERVAL, DEEP_SRC_STEP, DEEP_DAYS, DEEP_PAGE_DAYS
#: Calendar days one FMP call covers (at most 5 sessions, 390 rows: under the ~546 rows one answer held, measured).
DEEP_PAGE_DAYS = 6
#: FMP calls one backfill pass may make, over all vendor symbols.
DEEP_MAX_FETCHES = 8
#: Seconds between two backfill passes once settled.
DEEP_PASS_S = 120
#: Where `bg_lane` is not active (the bars-api tier), the backfill still waits this long after the module loaded.
DEEP_BOOT_SETTLE_S = 600.0
#: A session FMP answered empty (older than its history) is asked again after this long.
DEEP_NEGATIVE_TTL_S = 7 * 86400
#: A partial session (an answer cut by the page) is asked again at the next pass, this many times, then weekly.
DEEP_PARTIAL_RETRIES = 3
#: A failed call is retried after this long.
DEEP_ERROR_RETRY_S = 3600
DEEP_FMP_TIMEOUT_S = 20
#: THE SEAM. Measured noise (2026-11-21): 4 of 546 5m closes off by $0.05-$2.06 (worst 2.7e-4 of the level).
SEAM_MAX_REL = 1e-3
SEAM_MAX_DIFF_FRAC = 0.05
#: The junction is the first Yahoo session holding at least this share of its expected bars.
SEAM_MIN_BARS_FRAC = 0.5
DEEP_ENABLED_ENV = "INDEX_INTRADAY_DEEP_ENABLED"
# ⭐⭐ THE ETF FILL (OWNER RULING 2026-11-22: "you can use spy or whatever else is needed fully"). FMP's 5-minute
# history has slots it never answers: measured on the 3-year store (748 of 752 sessions complete), 2026-08-14 13:15,
# 2024-05-03 10:30, 2024-05-06 10:30 and 2024-05-30 10:45-11:45 ET are absent from its 5min AND 1min answers, asked
# three times. A run that stops at the first one served Fred RS 9 sessions of history (5 / 15 / 30), against years of
# the stock's own bars. So a session FMP still answers PARTIAL after DEEP_PARTIAL_RETRIES is completed from its ETF
# (`DEEP_FILL_PROXY`, the stock store's own 5m bars), scaled to the index by the MEDIAN ratio of the up to
# DEEP_FILL_EDGE_BARS slots on each side of the hole (`_edge_ratio`):
#   - measured on the pod 2026-11-22 against 40 COMPLETE sessions (2,508 interior slots, the edge ratio predicting the
#     index): close median 2.7e-5 of the level, p99 1.9e-4, worst 4.6e-4; a 13-slot (65 min) hole: close worst 2.3e-4.
#     Inside the seam's own noise bound (SEAM_MAX_REL). NDX's holes (2025-05-07, 2024-07-01 46 slots, 2024-05-06,
#     2024-03-27) are filled from QQQ the same way;
#   - only the slots FMP lacks, never a bar FMP answered; the fill lives BESIDE FMP's bars in the store (`fill`), so
#     FMP answering later wins, and INDEX_INTRADAY_DEEP_FILL_ENABLED=0 serves exactly the unfilled run;
#   - refused (never guessed) when the two edges' ratios disagree beyond DEEP_FILL_RATIO_DRIFT, when the ETF lacks a
#     slot, or when the hole is longer than DEEP_FILL_MAX_SLOTS; a filled high / low more than DEEP_FILL_WICK_MAX
#     beyond its body is held at the body (one ETF low print measured 1.1% off); a filled slot's volume is 0;
#   - NAMED in the answer: the `deep` record's `filled` lists every filled session and its slot count.
DEEP_FILL_PROXY = {"^GSPC": "SPY", "^NDX": "QQQ"}
DEEP_FILL_MAX_SLOTS = 60
#: Held slots on each side of a hole whose median ratio scales the ETF (a single edge bar can be a bad print).
DEEP_FILL_EDGE_BARS = 6
DEEP_FILL_RATIO_DRIFT = 1e-3
DEEP_FILL_WICK_MAX = 5e-3
#: ETF reads one pass may make (the stock store's own bars: no vendor call).
DEEP_FILL_MAX_PER_PASS = 8
DEEP_FILL_ENV = "INDEX_INTRADAY_DEEP_FILL_ENABLED"
_DEEP_T0 = time.monotonic()
_deep_prefix: Dict[tuple, tuple] = {}
_deep_prefix_lock = threading.Lock()
_deep_seam_logged: Dict[tuple, Any] = {}
_deep_locks: Dict[str, threading.Lock] = {}
_deep_thread_started = False
_deep_thread_guard = threading.Lock()


def deep_enabled(environ=None) -> bool:
    """On unless INDEX_INTRADAY_DEEP_ENABLED is 0/false/no/off (read per call)."""
    # ⛔ The literal name: the flag ledger's rail finds a gate by reading the code (feature_flag_index.py).
    raw = (os.environ.get("INDEX_INTRADAY_DEEP_ENABLED", "") if environ is None
           else environ.get("INDEX_INTRADAY_DEEP_ENABLED", ""))
    return str(raw).strip().lower() not in ("0", "false", "no", "off")


def deep_fill_enabled(environ=None) -> bool:
    """On unless INDEX_INTRADAY_DEEP_FILL_ENABLED is 0/false/no/off (read per call)."""
    # ⛔ The literal name: the flag ledger's rail finds a gate by reading the code (feature_flag_index.py).
    raw = (os.environ.get("INDEX_INTRADAY_DEEP_FILL_ENABLED", "") if environ is None
           else environ.get("INDEX_INTRADAY_DEEP_FILL_ENABLED", ""))
    return str(raw).strip().lower() not in ("0", "false", "no", "off")


def deep_vendor_symbols() -> List[str]:
    return sorted({INDEX_MAP[s][0] for s in DEEP_SERVED_SYMS})


def _deep_path(yahoo_sym: str, lane: str = "5") -> str:
    return os.path.join(_DISK_DIR, f"{yahoo_sym.lstrip('^')}_{_lane_cfg(lane)[0]}.deep.json")


def _deep_lock(path: str) -> threading.Lock:
    with _deep_prefix_lock:
        return _deep_locks.setdefault(path, threading.Lock())


def _deep_sig(path: str):
    """The store's version as the file system sees it, or None (no store)."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


def _load_deep(path: str) -> dict:
    """The store `{"days": {iso: {"state", "asked_at", "tries", "bars"}}, "changed_at"}`; an empty one when there is
    none or it cannot be read (a cache of vendor answers: a bad file is asked again, never served)."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        data = None
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[index_bars] deep store unreadable {os.path.basename(path)}: {type(e).__name__}: {e}")
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("days"), dict):
        return {"days": {}, "changed_at": None}
    return data


def _save_deep(path: str, data: dict) -> bool:
    """⛔ ATOMIC: a temp file in the same directory, flushed to disk, then `os.replace`. A process killed mid-write
    leaves the previous store (or none), never a truncated one."""
    tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[index_bars] deep store save failed {os.path.basename(path)}: {type(e).__name__}: {e}")
        try:
            os.remove(tmp)
        except OSError:
            pass
        return False


def _is_session_day(d) -> bool:
    from api.services import intraday_gap_audit as _gap
    return _gap._is_session(d)


def _deep_due(held: Optional[dict], now: float) -> bool:
    if not held:
        return True
    state = held.get("state")
    if state == "complete":
        return False
    try:
        asked = float(held.get("asked_at") or 0)
    except (TypeError, ValueError):
        return True
    if state == "error":
        return now - asked >= DEEP_ERROR_RETRY_S
    if state == "partial" and int(held.get("tries") or 0) < DEEP_PARTIAL_RETRIES:
        return True
    return now - asked >= DEEP_NEGATIVE_TTL_S


def deep_step(yahoo_sym: str, now: Optional[float] = None, max_fetches: int = DEEP_MAX_FETCHES,
              turn=None, lane: str = "5") -> dict:
    """ONE backfill pass for a vendor symbol: ask FMP for the settled sessions the store lacks, newest first, in
    pages of `DEEP_PAGE_DAYS` calendar days, at most `max_fetches` calls; each call inside `turn()` when given (the
    background lane). Returns the pass's counts. NEVER call this on a request thread."""
    import contextlib
    import datetime as _dt
    from api.services import fmp_client
    now = float(now if now is not None else time.time())
    interval, _step, days_held, page_days = _lane_cfg(lane)
    today = _et_date(now)
    start = today - _dt.timedelta(days=days_held)
    path = _deep_path(yahoo_sym, lane)
    stats = {"sym": yahoo_sym, "lane": lane, "asked": 0, "due": 0, "complete": 0, "changed": False, "stopped": None}
    with _deep_lock(path):
        held = _load_deep(path)
        days = dict(held["days"])                 # entries are replaced, never edited: readers never see a half one
        wanted, d = [], start
        while d <= today:
            if _is_session_day(d) and _close_ts(d) + REPAIR_SETTLE_S <= now:
                wanted.append(d)
            d += _dt.timedelta(days=1)
        due = [d for d in reversed(wanted) if _deep_due(days.get(d.isoformat()), now)]
        stats["due"] = len(due)
        bars_changed = False
        i = 0
        while i < len(due) and stats["asked"] < max_fetches:
            hi = due[i]
            lo = hi - _dt.timedelta(days=page_days - 1)
            page = [x for x in due[i:] if x >= lo]
            try:
                with (turn() if turn is not None else contextlib.nullcontext()):
                    res = fmp_client.get_index_intraday(yahoo_sym, interval, lo.isoformat(),
                                                        hi.isoformat(), timeout=DEEP_FMP_TIMEOUT_S)
                if getattr(res, "degraded", None):
                    raise RuntimeError(f"degraded answer: {res.degraded}")
                raw = getattr(res, "value", None)
            except fmp_client.FMPNotConfigured:
                stats["stopped"] = "not-configured"          # no key on this process: nothing asked, nothing recorded
                break
            except fmp_client.FMPNotFound:
                raw = []
            except Exception as e:  # noqa: BLE001 - fail-soft: the history stays as it is and is asked again
                stats["asked"] += 1
                logger.warning(f"[index_bars] deep ask FAILED {yahoo_sym} {lo}..{hi}: {type(e).__name__}: {e}")
                for x in page:
                    prior = days.get(x.isoformat()) or {}
                    days[x.isoformat()] = {"state": "error", "asked_at": now, "tries": int(prior.get("tries") or 0),
                                           "bars": list(prior.get("bars") or [])}
                i += len(page)
                continue
            stats["asked"] += 1
            # ⛔ A PAGE FMP CUT: its rows come newest first, so a session lying wholly before the oldest row it
            # returned was NOT REACHED by this answer. It is not recorded (it stays due, and the next pass's page
            # starts at it); the session the cut falls inside is held as partial and asked again next pass.
            got_ts = [t for x in page for t in _parse_fmp_intraday(raw, x)]
            oldest = min(got_ts) if got_ts else None
            for x in page:
                iso = x.isoformat()
                if oldest is not None and _close_ts(x) <= oldest:
                    continue
                prior = days.get(iso) or {}
                held_bars = {int(b["t"]): b for b in prior.get("bars") or []
                             if isinstance(b, dict) and isinstance(b.get("t"), (int, float))}
                exp = _expected(lane, x)
                expset = set(exp)
                merged = {t: b for t, b in {**held_bars, **_parse_fmp_intraday(raw, x)}.items() if t in expset}
                state = ("complete" if exp and all(t in merged for t in exp)
                         else "partial" if merged else "empty")
                if merged != held_bars:
                    bars_changed = True
                days[iso] = {"state": state, "asked_at": now, "tries": int(prior.get("tries") or 0) + 1,
                             "bars": [merged[t] for t in sorted(merged)]}
            i += len(page)
        if stats["asked"]:
            out = {"days": days, "changed_at": held.get("changed_at")}
            if bars_changed:
                # When the held history last changed (ms), never moving backwards: the answer's `history_rev`.
                out["changed_at"] = max(int(held.get("changed_at") or 0) + 1, int(now * 1000))
                stats["changed"] = True
            _save_deep(path, out)
        stats["complete"] = sum(1 for v in days.values() if (v or {}).get("state") == "complete")
    return stats


def _proxy_session_bars(proxy: str, d, lane: str = "5") -> Dict[int, dict]:
    """The ETF's own 5m bars of session `d`, from the stock store (`serve_bars`, a `to=` read, warm: it may be shed,
    then it is asked at the next pass). Never on a request thread."""
    import json as _json
    import datetime as _dt
    from api.routers import bars as _bars
    r = _bars.serve_bars(proxy, lane, bars=400 if lane == "5" else 1000, to=(d + _dt.timedelta(days=1)).isoformat(),
                         warm=1)
    body = getattr(r, "body", None)
    data = _json.loads(body) if body else (r if isinstance(r, dict) else {})
    out: Dict[int, dict] = {}
    for b in (data or {}).get("bars") or []:
        try:
            t = int(b["t"])
            if _et_date(t) == d:
                out[t] = {k: float(b[k]) for k in ("o", "h", "l", "c")}
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _edge_ratio(exp: List[int], i: int, step: int, have: Dict[int, dict], proxy_bars: Dict[int, dict]):
    """The index / ETF ratio on one side of a hole: the MEDIAN of the open and close ratios of the up to
    DEEP_FILL_EDGE_BARS nearest slots both hold, walking away from the hole (measured 2024-05-03: FMP's two bars
    bordering the 10:30 hole read 10.021 and 10.0375 against a steady 10.029 around them). None when no slot is held."""
    import statistics
    vals: List[float] = []
    n = 0
    while 0 <= i < len(exp) and n < DEEP_FILL_EDGE_BARS:
        t = exp[i]
        h, p = have.get(t), proxy_bars.get(t)
        if h is not None and p is not None and p["o"] > 0 and p["c"] > 0:
            vals += [float(h["o"]) / p["o"], float(h["c"]) / p["c"]]
            n += 1
        i += step
    return statistics.median(vals) if vals else None


def _fill_session(d, have: Dict[int, dict], proxy_bars: Dict[int, dict], lane: str = "5") -> dict:
    """The ETF fill of session `d`'s missing 5m slots: `{"state": "filled", "bars": [...], "slots", "worst_drift"}`
    or `{"state": "refused", "reason"}`. Pure: `have` = FMP's bars, `proxy_bars` = the ETF's."""
    exp = _expected(lane, d)
    missing = [i for i, t in enumerate(exp) if t not in have]
    if not exp or not missing:
        return {"state": "refused", "reason": "nothing to fill"}
    max_slots = DEEP_FILL_MAX_SLOTS * DEEP_SRC_STEP // _lane_cfg(lane)[1]     # the same span of time in every lane
    if len(missing) > max_slots:
        return {"state": "refused", "reason": f"{len(missing)} slots missing (fill at most {max_slots})"}
    runs, cur = [], [missing[0]]
    for i in missing[1:]:
        if i == cur[-1] + 1:
            cur.append(i)
        else:
            runs.append(cur)
            cur = [i]
    runs.append(cur)
    out, worst = [], 0.0
    for run in runs:
        ratios = [r for r in (_edge_ratio(exp, run[0] - 1, -1, have, proxy_bars),
                              _edge_ratio(exp, run[-1] + 1, 1, have, proxy_bars)) if r is not None]
        if not ratios:
            return {"state": "refused", "reason": "no edge bar held by both the index and the ETF"}
        drift = abs(ratios[0] - ratios[-1]) / ratios[0]
        if drift > DEEP_FILL_RATIO_DRIFT:
            return {"state": "refused",
                    "reason": f"the edge ratios differ by {drift:.2e} (fill at most {DEEP_FILL_RATIO_DRIFT:g})"}
        worst = max(worst, drift)
        ratio = sum(ratios) / len(ratios)
        for i in run:
            t = exp[i]
            pb = proxy_bars.get(t)
            if pb is None:
                return {"state": "refused", "reason": f"the ETF has no bar at {t}"}
            o, h, l, c = (_quote(pb[k] * ratio) for k in ("o", "h", "l", "c"))
            hi, lo = max(o, c), min(o, c)
            if h < hi or h > hi * (1 + DEEP_FILL_WICK_MAX):
                h = hi
            if l > lo or l < lo * (1 - DEEP_FILL_WICK_MAX):
                l = lo
            out.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": 0})
    return {"state": "filled", "bars": out, "slots": len(out), "worst_drift": round(worst, 8)}


def deep_fill_step(yahoo_sym: str, now: Optional[float] = None, max_reads: int = DEEP_FILL_MAX_PER_PASS,
                   turn=None, lane: str = "5") -> dict:
    """Complete from the ETF every session FMP still answers partial after its retries (see THE ETF FILL). Returns
    the pass's counts. NEVER call this on a request thread."""
    import contextlib
    import datetime as _dt
    now = float(now if now is not None else time.time())
    stats = {"sym": yahoo_sym, "read": 0, "filled": 0, "refused": 0}
    proxy = DEEP_FILL_PROXY.get(yahoo_sym)
    if not proxy or not deep_fill_enabled():
        return stats
    path = _deep_path(yahoo_sym, lane)
    with _deep_lock(path):
        held = _load_deep(path)
        days = dict(held["days"])
        changed = False
        for iso in sorted(days, reverse=True):
            if stats["read"] >= max_reads:
                break
            e = days[iso] or {}
            if e.get("state") != "partial" or int(e.get("tries") or 0) < DEEP_PARTIAL_RETRIES:
                continue
            f = e.get("fill") or {}
            if f.get("state") == "filled":
                continue
            if f.get("state") == "refused" and now - float(f.get("at") or 0) < DEEP_NEGATIVE_TTL_S:
                continue
            d = _dt.date.fromisoformat(iso)
            have = {int(b["t"]): b for b in e.get("bars") or [] if isinstance(b, dict)}
            stats["read"] += 1
            try:
                with (turn() if turn is not None else contextlib.nullcontext()):
                    pb = _proxy_session_bars(proxy, d, lane)
            except Exception as x:  # noqa: BLE001 - fail-soft: asked again at the next pass
                logger.warning(f"[index_bars] deep fill {yahoo_sym} {iso}: the {proxy} read FAILED: "
                               f"{type(x).__name__}: {x}")
                continue
            if not pb:
                continue                               # shed or not yet stored: the next pass asks again
            fill = dict(_fill_session(d, have, pb, lane), src=proxy, at=now)
            stats["filled" if fill["state"] == "filled" else "refused"] += 1
            (logger.info if fill["state"] == "filled" else logger.warning)(
                f"[index_bars] deep fill {yahoo_sym} {iso} from {proxy}: {fill['state']} "
                f"{fill.get('slots', '')} {fill.get('reason') or ''}".rstrip())
            days[iso] = dict(e, fill=fill)
            changed = True
        if changed:
            _save_deep(path, {"days": days,
                              "changed_at": max(int(held.get("changed_at") or 0) + 1, int(now * 1000))})
    return stats


def _seam_parity(rtf: str, d, deep_day: Optional[dict], yf_bars: list, divisor: float) -> dict:
    """FMP's copy of the junction session `d` against Yahoo's, bar by bar at the served grid: `{"d", "compared",
    "equal" (to the cent), "worst_rel", "ok", "reason"}`."""
    seam = {"d": d.isoformat(), "compared": 0, "equal": 0, "worst_rel": None, "ok": False, "reason": None}
    if not deep_day or deep_day.get("state") != "complete":
        seam["reason"] = "the store does not hold the junction session"
        return seam
    src = {int(b["t"]): b for b in deep_day.get("bars") or [] if isinstance(b, dict)}
    rolled = _roll_into_buckets(rtf, d, src, _lane_cfg(_lane(rtf))[1])
    worst, cmp_n, eq = 0.0, 0, 0
    for b in yf_bars:
        f = rolled.get(int(b["t"]))
        if f is None:
            continue
        yc = float(b["c"]) * divisor               # back to the index level: Yahoo's rows here are divided
        diff = abs(float(f["c"]) - yc)
        cmp_n += 1
        if diff <= 0.005:
            eq += 1
        if yc:
            worst = max(worst, diff / abs(yc))
    seam.update(compared=cmp_n, equal=eq, worst_rel=round(worst, 8) if cmp_n else None)
    if not cmp_n:
        seam["reason"] = "no bar of the junction session in both"
    elif worst > SEAM_MAX_REL:
        seam["reason"] = f"a bar differs by {worst:.2e} of the level (noise <= {SEAM_MAX_REL:g})"
    elif (cmp_n - eq) / cmp_n > SEAM_MAX_DIFF_FRAC:
        seam["reason"] = f"{cmp_n - eq} of {cmp_n} bars differ (noise <= {SEAM_MAX_DIFF_FRAC:.0%})"
    else:
        seam["ok"] = True
    return seam


def _overlap_parity(rtf: str, days: dict, by_day: Dict[Any, list], divisor: float) -> dict:
    """FMP against Yahoo on EVERY session both hold that has settled, the newest Yahoo session excluded (its last
    bar may not have settled at FMP: measured 2026-11-21), to the cent at the served grid. Logged, and carried in
    the answer's record; the JOIN is decided by the junction alone (`_seam_parity`)."""
    out = {"sessions": 0, "compared": 0, "equal": 0, "worst_rel": None}
    if not by_day:
        return out
    newest = max(by_day)
    now = _now()
    worst = 0.0
    for d in sorted(by_day):
        if d == newest or _close_ts(d) + REPAIR_SETTLE_S > now:
            continue
        e = days.get(d.isoformat())
        if not e or e.get("state") != "complete":
            continue
        rolled = _roll_into_buckets(rtf, d, {int(b["t"]): b for b in e.get("bars") or [] if isinstance(b, dict)},
                                    _lane_cfg(_lane(rtf))[1])
        n0 = out["compared"]
        for b in by_day[d]:
            f = rolled.get(int(b["t"]))
            if f is None:
                continue
            yc = float(b["c"]) * divisor
            diff = abs(float(f["c"]) - yc)
            out["compared"] += 1
            out["equal"] += 1 if diff <= 0.005 else 0
            if yc:
                worst = max(worst, diff / abs(yc))
        if out["compared"] > n0:
            out["sessions"] += 1
    out["worst_rel"] = round(worst, 8) if out["compared"] else None
    return out


def _build_deep_prefix(sym: str, rtf: str, data: dict, first_day, divisor: float) -> tuple:
    """The contiguous run of complete settled sessions before `first_day` (a partial one completed by THE ETF FILL
    counts), rolled to `rtf` and divided: (bars, the number of sessions, the oldest session's ISO date or None, the
    filled sessions `[{"d", "slots", "src"}]`)."""
    import datetime as _dt
    _interval, step, days_held, _page = _lane_cfg(_lane(rtf))
    if rtf == "5":
        days_held = min(days_held, DEEP_5M_SERVED_DAYS)
    start = _et_date(_now()) - _dt.timedelta(days=days_held)
    days = data.get("days") or {}
    run: List[list] = []
    fills: List[dict] = []
    oldest = None
    d = first_day - _dt.timedelta(days=1)
    while d >= start:
        if not _is_session_day(d):                 # a holiday or weekend is no session, never a missing one
            d -= _dt.timedelta(days=1)
            continue
        e = days.get(d.isoformat())
        if not e:
            break                                  # never a hole: the run stops at the first session not held
        src = {int(b["t"]): b for b in e.get("bars") or [] if isinstance(b, dict)}
        if e.get("state") != "complete":
            f = e.get("fill") or {}
            if e.get("state") != "partial" or f.get("state") != "filled" or not deep_fill_enabled():
                break
            src = {**{int(b["t"]): b for b in f.get("bars") or [] if isinstance(b, dict)}, **src}   # FMP's bar wins
            fills.append({"d": d.isoformat(), "slots": int(f.get("slots") or 0), "src": f.get("src")})
        rolled = _roll_into_buckets(rtf, d, src, step)
        exp = _expected(rtf, d)
        if not exp or any(t not in rolled for t in exp):
            break
        run.append([{"t": t, "o": rolled[t]["o"] / divisor, "h": rolled[t]["h"] / divisor,
                     "l": rolled[t]["l"] / divisor, "c": rolled[t]["c"] / divisor, "v": int(rolled[t]["v"])}
                    for t in exp])
        oldest = d.isoformat()
        d -= _dt.timedelta(days=1)
    return [b for day in reversed(run) for b in day], len(run), oldest, fills


def _merge_deep(sym: str, tf: str, out: list) -> tuple:
    """(series, record): Yahoo's intraday `out` with the store's contiguous settled history before its first day,
    behind the seam check; the record is None when deep history does not apply (another tf or index, switched off,
    nothing stored). ⛔ On a request thread the store is never parsed: a prefix not already built is skipped."""
    rtf = DEEP_TFS.get(tf)
    if rtf is None or sym not in DEEP_SERVED_SYMS or not out or not deep_enabled():
        return out, None
    yahoo_sym, divisor = INDEX_MAP[sym]
    path = _deep_path(yahoo_sym, _lane(rtf))
    sig = _deep_sig(path)
    if sig is None:
        return out, None
    rows = sorted(out, key=lambda b: b["t"])
    by_day: Dict[Any, list] = {}
    for b in rows:
        by_day.setdefault(_et_date(b["t"]), []).append(b)
    first_day = min(by_day)
    junction = None
    for d in sorted(by_day):
        exp = _expected(rtf, d)
        if exp and len(by_day[d]) >= SEAM_MIN_BARS_FRAC * len(exp):
            junction = d
            break
    key = (sym, tf)
    with _deep_prefix_lock:
        hit = _deep_prefix.get(key)
    if hit and hit[0] == (sig, first_day, junction):
        prefix, rec = hit[1], hit[2]
    elif not _vendor_repair_allowed():
        return out, {"src": DEEP_SOURCE, "joined": False, "sessions": 0, "from": None,
                     "reason": "the prefix is built off the request", "pending": True}
    else:
        data = _load_deep(path)
        if junction is None:
            seam = {"d": None, "compared": 0, "equal": 0, "worst_rel": None, "ok": False,
                    "reason": "no Yahoo session to join at"}
        else:
            seam = _seam_parity(rtf, junction, (data.get("days") or {}).get(junction.isoformat()),
                                by_day[junction], divisor)
        overlap = _overlap_parity(rtf, data.get("days") or {}, by_day, divisor)
        log_key = (sym, tf, seam.get("d"), data.get("changed_at"))
        if _deep_seam_logged.get(key) != log_key:
            _deep_seam_logged[key] = log_key
            (logger.info if seam["ok"] else logger.warning)(
                f"[index_bars] deep seam {sym} {tf} at {seam.get('d')}: {seam['equal']} of {seam['compared']} bars "
                f"equal to the cent, worst {seam['worst_rel']}; {'JOINED' if seam['ok'] else 'NOT JOINED: ' + str(seam['reason'])}"
                f"; overlap {overlap['sessions']} settled session(s): {overlap['equal']} of {overlap['compared']} equal, "
                f"worst {overlap['worst_rel']}")
        if seam["ok"]:
            prefix, n, oldest, fills = _build_deep_prefix(sym, rtf, data, first_day, divisor)
            rec = {"src": DEEP_SOURCE, "joined": True, "sessions": n, "from": oldest, "reason": None,
                   "seam": seam, "overlap": overlap, "rev": data.get("changed_at"), "filled": fills}
        else:
            prefix = []
            rec = {"src": DEEP_SOURCE, "joined": False, "sessions": 0, "from": None, "reason": seam["reason"],
                   "seam": seam, "overlap": overlap, "rev": None}
        with _deep_prefix_lock:
            _deep_prefix[key] = ((sig, first_day, junction), prefix, rec)
    if not prefix:
        return out, dict(rec)
    return prefix + rows, dict(rec)


def _deep_settle_wait() -> None:
    """Block the backfill thread until the boot has settled: `bg_lane`'s window where the lane is active (web),
    else `DEEP_BOOT_SETTLE_S` after this module loaded (the bars-api tier)."""
    try:
        from api.services import bg_lane
        if bg_lane.enabled():
            bg_lane.wait_settled("index-deep-backfill")
            return
    except Exception:  # noqa: BLE001 - the local window below still holds
        pass
    while True:
        rem = DEEP_BOOT_SETTLE_S - (time.monotonic() - _DEEP_T0)
        if rem <= 0:
            return
        time.sleep(min(rem, 30))


def _deep_turn():
    """One item of lane work (one FMP call): `bg_lane.turn` where the lane is active, else a plain context."""
    import contextlib
    try:
        from api.services import bg_lane
        if bg_lane.enabled():
            return bg_lane.turn("index-deep-backfill")
    except Exception:  # noqa: BLE001
        pass
    return contextlib.nullcontext()


def deep_backfill_pass(now: Optional[float] = None) -> List[dict]:
    """One pass over every vendor symbol, sharing `DEEP_MAX_FETCHES` calls; then the series that changed are
    refreshed (their prefix is rebuilt off the request)."""
    passes = []
    for lane in DEEP_LANE_TFS:
        budget = DEEP_MAX_FETCHES                  # per lane: the 1-minute backfill never starves the 5-minute one
        for ysym in deep_vendor_symbols():
            if budget <= 0:
                break
            st = deep_step(ysym, now=now, max_fetches=budget, turn=_deep_turn, lane=lane)
            budget -= st["asked"]
            fill = deep_fill_step(ysym, now=now, turn=_deep_turn, lane=lane)
            if fill["read"]:
                st["fill"] = fill
            passes.append(st)
    # A served series whose prefix was not built for the store as it stands (the store changed, or this process
    # never built it: after a restart a tf refreshed only by member reads would otherwise wait for the next change)
    # is refreshed in the background, where the prefix is built. Once per store version per series.
    for sym in sorted(DEEP_SERVED_SYMS):
        for lane, tfs in DEEP_LANE_TFS.items():
            sig = _deep_sig(_deep_path(INDEX_MAP[sym][0], lane))
            if sig is None:
                continue
            for tf in tfs:
                with _deep_prefix_lock:
                    hit = _deep_prefix.get((sym, tf))
                if not hit or hit[0][0] != sig:
                    _kick_bg_refresh(sym, tf)
    if any(p["asked"] or p.get("fill") for p in passes):
        logger.info(f"[index_bars] deep pass: {passes}")
    return passes


def start_deep_backfill() -> None:
    """Start the backfill thread once per process (both pod types that serve this module call it through
    `start_index_warm`). It waits for the boot to settle, then runs a pass every `DEEP_PASS_S`."""
    global _deep_thread_started
    with _deep_thread_guard:
        if _deep_thread_started:
            return
        _deep_thread_started = True

    def _loop():
        _deep_settle_wait()
        while True:
            try:
                if deep_enabled():
                    deep_backfill_pass()
            except Exception:  # noqa: BLE001
                logger.exception("[index_bars] deep backfill pass error")
            time.sleep(DEEP_PASS_S)
    threading.Thread(target=_loop, name="index-deep-backfill", daemon=True).start()


# ── Disk snapshot (cross-restart warmth) ─────────────────────────────────────
def _disk_path(sym: str, tf: str) -> str:
    return os.path.join(_DISK_DIR, f"{sym}_{tf}.json")


def _load_disk(sym: str, tf: str) -> Optional[dict]:
    try:
        with open(_disk_path(sym, tf), "r", encoding="utf-8") as fh:
            return json.load(fh)   # {saved_at, series}
    except FileNotFoundError:
        return None
    except Exception as e:
        logger.warning(f"[index_bars] disk load failed {sym} {tf}: {e}")
        return None


def _save_disk(sym: str, tf: str, series: list, proxy: Optional[bool] = None,
               repair: Optional[dict] = None) -> None:
    try:
        os.makedirs(_DISK_DIR, exist_ok=True)
        tmp = _disk_path(sym, tf) + ".tmp"
        entry = {"saved_at": time.time(), "series": series}
        if proxy is not None:
            entry["proxy"] = proxy
        if repair is not None:
            entry["repair"] = repair
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(entry, fh, separators=(",", ":"))
        os.replace(tmp, _disk_path(sym, tf))
    except Exception as e:
        logger.warning(f"[index_bars] disk save failed {sym} {tf}: {e}")


#: "SYM_tf" -> unix s of the newest refresh attempt that got no series from any vendor.
#: The next refresh that gets one drops it. Per process, like the store it describes.
_refresh_failed_at: Dict[str, float] = {}


def _held_saved_at(sym: str, tf: str) -> Optional[float]:
    """When the copy this process holds for (sym, tf) was stored (memory, then disk), or None."""
    from api.services.cache import cache
    entry = cache.get(f"idxbars_{sym}_{tf}") or _load_disk(sym, tf)
    if entry and entry.get("series"):
        try:
            return float(entry.get("saved_at") or 0) or None
        except (TypeError, ValueError):
            return None
    return None


def _note_refresh_failed(sym: str, tf: str, at: float, why: str) -> None:
    """A refresh got nothing: remember it (the answer says `refresh_state: "failed"`) and log
    it BY NAME, with the age of the copy that stays in place. Never deletes that copy."""
    import datetime as _dt
    _refresh_failed_at[f"{sym}_{tf}"] = at
    held = _held_saved_at(sym, tf)
    if held:
        when = _dt.datetime.fromtimestamp(held, _dt.timezone.utc).isoformat(timespec="minutes")
        logger.warning(f"[index_bars] refresh FAILED {sym} {tf}: {why}; the stored copy from "
                       f"{when} ({(at - held) / 86400:.1f} d old) stays and is served as "
                       f"refresh_state=failed")
    else:
        logger.warning(f"[index_bars] refresh FAILED {sym} {tf}: {why}; nothing is stored")


def _refresh(sym: str, tf: str) -> list:
    """Cold/background fetch → write mem + disk. Returns the fresh series ([] on fail).
    The entry records whether the series is the ETF proxy (`proxy`), so a reader can
    tell the index's own bars from a scaled ETF's. A refresh that gets nothing (or raises)
    is recorded and logged by name (`_note_refresh_failed`); the stored copy stays."""
    from api.services.cache import cache
    info: dict = {}
    asked = time.time()
    try:
        series = _fetch_full_series(sym, tf, info)
    except Exception as e:
        _note_refresh_failed(sym, tf, asked, f"{type(e).__name__}: {e}")
        raise
    if series:
        proxy = bool(info.get("proxy"))
        entry = {"saved_at": time.time(), "series": series, "proxy": proxy}
        repair = info.get("repair")
        if repair is not None:
            entry["repair"] = repair        # the hole repair's record (`repair_rth_holes`)
        cache.set(f"idxbars_{sym}_{tf}", entry, ttl=max(_TTL.get(tf, 300), 60))
        if repair is not None:
            _save_disk(sym, tf, series, proxy, repair=repair)
        else:
            _save_disk(sym, tf, series, proxy)
        _refresh_failed_at.pop(f"{sym}_{tf}", None)
    else:
        _note_refresh_failed(sym, tf, asked, "no vendor answered")
    return series


def _kick_bg_refresh(sym: str, tf: str) -> None:
    key = f"{sym}_{tf}"
    with _bg_lock:
        if key in _bg_inflight or len(_bg_inflight) >= 8:
            return
        _claim_locked(key)

    def _job():
        try:
            _refresh(sym, tf)
        except Exception as e:
            logger.info(f"[index_bars] bg refresh {sym} {tf} failed: {e}")
        finally:
            _release(key)
    try:
        _bg_pool.submit(_job)
    except Exception:
        _release(key)


#: ⭐ RS RATING L12 (2026-11-18): an INTRADAY copy this old, answered stale-while-revalidate, hands a chart an index a
#: session or more behind: /api/bars/SPX?tf=15 served 2026-11-16 15:00 ET on 2026-11-18's first request (nobody had
#: asked for it since), and only the NEXT request was current. Fred RS on a 15m chart then withheld its newest bars.
#: Past this age the request refreshes the series itself, the stock path's "cold-stale -> synchronous first paint"
#: rule (`bars_fetch._is_cold_stale_intraday`) applied to indices. Bounded by `yf_util.bounded_call`; a cold ^GSPC
#: read measured 2026-11-18: 15m 0.17 s median (1.27 s worst of 3), 5m 0.19 s, 1m 0.16 s, 30m 0.16 s. The stale copy
#: is served when the vendor answers nothing or another request is already refreshing it. A daily / weekly / monthly
#: copy, and a short miss of an intraday TTL, keep stale-while-revalidate.
COLD_STALE_S = 3600
_INTRADAY_UI_TFS = frozenset({"1", "5", "15", "30", "60", "1h"})


def _now() -> float:
    """THE serve clock: `_cached_series` judges a copy's age by it and `fetch_index_bars` withholds by it, so the
    two can never disagree about what time it is (a rail pins it). It reads this module's `time`, so a rail that
    pins `index_bars.time` pins it too. ⚰️ It was `time.time` bound at import while `_cached_series` read
    `time.time()`: two clocks, and a rail pinning one saw the other."""
    return time.time()


#: ⭐ 2026-11-20, production: how long a request that finds the refresh of its copy already running waits for that
#: refresh before answering the copy it holds. A cold ^GSPC read is ~0.2 s (measured above); the edge hedges a tier
#: answer slower than 1.2 s to web (`edge/bars-edge-router/worker.js` BARS_HEDGE_MS), so the wait stays under it.
REFRESH_WAIT_S = 1.0


#: ⭐ RS RATING L12 (2026-11-18) — A NEWEST BAR STORED WHILE IT WAS FORMING IS A PARTIAL PRINT. A refresh in session
#: stores the vendor's newest bar as it stands (the 15m 10:15 bar at 10:17:37 ET, close 7338.74); `newest_bar_is_forming`
#: is derived at SERVE time from the bar's own time (`routers/bars._augment_with_bar_close_state`), so once that bar's
#: period ends the stored copy hands it out as SETTLED with its partial close until the next refresh. Measured: an
#: in-session SPX 15m copy served the 09:30 bar at 7350.26 (the print at ~09:35) where TradingView's settled bar is
#: 7323.32, and production at 11:01 ET served the 10:15 bar at 7338.74 (final 7335.67, the refresh 25 s later).
#: That bar is WITHHELD (the bars before it are served); the refresh brings the bar with its own close. A bar still
#: forming at serve time is kept (it IS the forming bar), and so is one that had ended when the copy was stored.
#: A bar ends at its step, or at its session's close (a 60m index bar opening 15:30 ends at 16:00).
_INTRADAY_STEP_S = {"1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600, "1h": 3600}


def _intraday_bar_end(t, tf: str):
    """Unix seconds at which the intraday bar opening at `t` ends, or None (not an intraday bar)."""
    step = _INTRADAY_STEP_S.get(tf)
    if not step or not isinstance(t, (int, float)) or isinstance(t, bool):
        return None
    end = float(t) + step
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        from api.services.session_calendar import close_time
        close = close_time(datetime.fromtimestamp(float(t), ZoneInfo("America/New_York")).date())
        if close is not None and close.timestamp() > float(t):
            end = min(end, close.timestamp())
    except Exception:  # noqa: BLE001 - the step alone still bounds the bar
        pass
    return end


def _tail_ended_since_saved(series: list, tf: str, saved_at, now: float) -> bool:
    """True when the newest bar of an intraday copy was still forming when the copy was stored and has ended by
    `now` (see above). ONE rule, two readers: `_settled_partial_withheld` withholds that bar, and `_cached_series`
    refreshes the copy in the request, so the serve never answers a tail shorter than the one it answered before."""
    if not series or saved_at is None or not isinstance(series[-1], dict):
        return False
    end = _intraday_bar_end(series[-1].get("t"), tf)
    return end is not None and float(saved_at) < end <= float(now)


def _session_close_ts(t) -> Optional[float]:
    """Unix seconds at which the regular session of the ET day holding instant `t` closes (half-day aware), or None
    (no session that day, or an unreadable calendar: abstain)."""
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        from api.services.session_calendar import close_time
        close = close_time(datetime.fromtimestamp(float(t), ZoneInfo("America/New_York")).date())
        return close.timestamp() if close is not None else None
    except Exception:  # noqa: BLE001 - abstain, never guess
        return None


def _missing_bar_ended_since_saved(series: list, tf: str, saved_at, now: float) -> bool:
    """True when the bar AFTER an intraday copy's newest has ended since the copy was stored, inside the session.

    ⭐ 2026-11-20, production re-probe after D8: the tier's 1m refresh at 18:36:01Z got a series whose newest
    bar was 18:35, because the vendor had not published the new minute one second in. A signed-in probe saw the
    same at 13:36 ET. That copy's newest bar had already ENDED when it was stored, so `_tail_ended_since_saved`
    (correctly) does not fire, and the copy was answered "fresh" 1, then 2, bars behind until its TTL ran out.
    The copy never held the bar that has ended since, so it is behind; once per bar it is asked again.

    ⛔ NEVER OUTSIDE THE SESSION: a newest bar that ends at its session's close has no next bar to wait for
    until the next open (TTL and the cold-stale rule cover the night)."""
    if not series or saved_at is None or not isinstance(series[-1], dict):
        return False
    nxt = _intraday_bar_end(series[-1].get("t"), tf)        # the next bar opens where the newest ends
    if nxt is None:
        return False
    close = _session_close_ts(nxt)
    if close is None or nxt >= close:
        return False
    end = _intraday_bar_end(nxt, tf)
    return end is not None and float(saved_at) < end <= float(now)


def _copy_behind_since_saved(series: list, tf: str, saved_at, now: float) -> bool:
    """A bar boundary has passed since the copy was stored, inside the session: its newest bar was forming and has
    ended (`_tail_ended_since_saved`, which D7 also withholds), or the bar after it has ended and the copy never
    held it (`_missing_bar_ended_since_saved`). Such a copy is refreshed in the request (`_cached_series`)."""
    return (_tail_ended_since_saved(series, tf, saved_at, now)
            or _missing_bar_ended_since_saved(series, tf, saved_at, now))


def _settled_partial_withheld(series: list, tf: str, saved_at, now: float) -> list:
    """`series` without a newest bar that was still forming when the copy was stored and has ended since (see above)."""
    return series[:-1] if _tail_ended_since_saved(series, tf, saved_at, now) else series


def _cold_stale(tf: str, saved_at, now: float) -> bool:
    return tf in _INTRADAY_UI_TFS and now - float(saved_at or 0) > COLD_STALE_S


def _refresh_in_request(sym: str, tf: str, held_saved_at=None) -> list:
    """The series refreshed inside this request, or [] (no vendor answered, or another request holds the refresh and
    stored nothing newer than `held_saved_at` within `REFRESH_WAIT_S`: the caller serves its stale copy). Shares
    `_bg_inflight` with the background refresh, so one fetch runs at a time; a request that finds one running waits
    for it (`_await_refresh`) rather than answering the copy it is replacing."""
    key = f"{sym}_{tf}"
    with _bg_lock:
        busy = key in _bg_inflight
        if busy:
            done = _inflight_done.get(key)
        else:
            _claim_locked(key)
    if busy:
        return _await_refresh(sym, tf, done, held_saved_at)
    try:
        with _on_request_thread():         # the hole repair asks no vendor on a request
            return _refresh(sym, tf) or []
    except Exception as e:  # noqa: BLE001 - recorded by _refresh; the stale copy is still a chart
        logger.info(f"[index_bars] in-request refresh {sym} {tf} failed: {e}")
        return []
    finally:
        _release(key)
        _kick_pending_repair(sym, tf)


def _await_refresh(sym: str, tf: str, done: Optional[threading.Event], held_saved_at) -> list:
    """Another thread holds the refresh of (sym, tf): wait for it, at most `REFRESH_WAIT_S`, and answer the series it
    stored if that is newer than the copy this request holds (`held_saved_at`); else [] (the refresh got nothing, or
    is still running: the caller serves its stale copy). `done` is None for a refresh this module did not claim."""
    if done is None or not done.wait(REFRESH_WAIT_S):
        return []
    from api.services.cache import cache
    entry = cache.get(f"idxbars_{sym}_{tf}") or {}
    try:
        newer = float(entry.get("saved_at") or 0) > float(held_saved_at or 0)
    except (TypeError, ValueError):
        newer = False
    return (entry.get("series") or []) if newer else []


def _kick_pending_repair(sym: str, tf: str) -> None:
    """A refresh on a request thread left sessions the repair vendor has not been asked about
    (`repair["pending"]`): ask them in the background, off the member's request."""
    from api.services.cache import cache
    entry = cache.get(f"idxbars_{sym}_{tf}") or {}
    if (entry.get("repair") or {}).get("pending"):
        _kick_bg_refresh(sym, tf)


def _cached_series(sym: str, tf: str, info: Optional[dict] = None):
    """Return (series, tier). Never blocks on yfinance when ANY cached data exists —
    stale data is served immediately and a background refresh is kicked — EXCEPT two intraday copies, refreshed in
    the request: one older than `COLD_STALE_S` (RS RATING L12), and one whose newest bar has ended since it was
    stored (`_tail_ended_since_saved`). `info`, when given, is told when the served copy
    was stored (`info["saved_at"]`, None if none) and the hole repair's record of that copy (`info["repair"]`,
    None for a copy without one: D/W/M, the ETF proxy, another grid, or a copy stored before the repair existed).

    ⛔⛔ 2026-11-20, production: A COPY INSIDE ITS TTL IS NOT FRESH ONCE ITS NEWEST BAR HAS ENDED. `fetch_index_bars`
    withholds that bar (D7), so serving the copy answers a tail one bar SHORTER than the answer before it: the bars-api
    tier answered `/api/bars/SPX?tf=5` with the 15:00 bar forming at 15:04:47Z and only 14:55 at 15:05:07Z, from one copy
    stored 15:04:04 (its TTL is 300 s and the warm loop refreshes it every ~304 s, never at a bar's end). 16 of 21 tf=5
    answers were two bars behind the clock, and a Pine script reading SPX from an intraday chart sat pending. Such a
    copy is refreshed in the request; the copy that refresh stores holds the new bar and stays fresh until THAT bar
    ends, so a read pays one vendor call per bar. A vendor that answers nothing leaves the withheld copy, answered as
    stale, and the next request asks again, one vendor read at a time like the cold-stale rule (rails D8a-D8d,
    tests/test_index_bars_depth.py).

    ⭐ AND ONE STORED WITHOUT THE BAR NOW FORMING (2026-11-20, the re-probe after D8, rails D9a-D9b): a refresh the
    vendor answered one second into a minute, before it published that minute, is behind once that bar ends, though
    its own newest bar had ended before it was stored (`_missing_bar_ended_since_saved`, inside the session only).
    Both cases are one test, `_copy_behind_since_saved`."""
    from api.services.cache import cache
    ttl = _TTL.get(tf, 300)
    now = _now()
    mkey = f"idxbars_{sym}_{tf}"
    if info is None:
        info = {}
    info["saved_at"] = None
    info["repair"] = None

    def _stored():
        entry = cache.get(mkey) or {}
        info["saved_at"] = entry.get("saved_at")
        info["repair"] = entry.get("repair")

    mem = cache.get(mkey)
    if mem and mem.get("series"):
        info["saved_at"] = mem.get("saved_at")
        info["repair"] = mem.get("repair")
        ended = _copy_behind_since_saved(mem["series"], tf, mem.get("saved_at"), now)
        if now - mem.get("saved_at", 0) <= ttl and not ended:
            return mem["series"], "index-mem"
        if ended or _cold_stale(tf, mem.get("saved_at"), now):
            fresh = _refresh_in_request(sym, tf, mem.get("saved_at"))
            if fresh:
                _stored()
                return fresh, "index-yf"
        _kick_bg_refresh(sym, tf)          # stale but usable → serve + revalidate
        return mem["series"], "index-mem-stale"

    disk = _load_disk(sym, tf)
    if disk and disk.get("series"):
        info["saved_at"] = disk.get("saved_at")
        info["repair"] = disk.get("repair")
        cache.set(mkey, disk, ttl=max(ttl, 60))
        ended = _copy_behind_since_saved(disk["series"], tf, disk.get("saved_at"), now)
        if now - disk.get("saved_at", 0) <= ttl and not ended:
            return disk["series"], "index-disk"
        if ended or _cold_stale(tf, disk.get("saved_at"), now):
            fresh = _refresh_in_request(sym, tf, disk.get("saved_at"))
            if fresh:
                _stored()
                return fresh, "index-yf"
        _kick_bg_refresh(sym, tf)
        return disk["series"], "index-disk-stale"

    # Truly cold: no cache anywhere — the ONE slow request (then warm forever).
    try:
        with _on_request_thread():         # the hole repair asks no vendor on a request
            series = _refresh(sym, tf)
    finally:
        _kick_pending_repair(sym, tf)
    if series:
        _stored()
    return series, "index-yf"


def _freshness(sym: str, tf: str, tier: str, saved_at) -> dict:
    """How current an index answer is, stated in the answer (additive fields):
      refreshed_at   unix s the vendor last answered for the series served (None: no copy);
      refresh_state  "failed": the newest refresh got nothing from any vendor after the
                               served copy was stored (or nothing is stored), so the rows
                               are as old as `refreshed_at`;
                     "stale":  served past its TTL (`_TTL`), a background refresh kicked;
                     "fresh":  served within its TTL.
    ⛔ Not `verified_through`: a client reads that as proof the buckets up to it are EMPTY
    (`barStore/reducer.liveGapStart`) and as authority over the developing bar's extremes,
    and neither holds here (yfinance intraday lags; today's daily bar comes from 5m)."""
    try:
        saved = float(saved_at) if saved_at else None
    except (TypeError, ValueError):
        saved = None
    failed = _refresh_failed_at.get(f"{sym}_{tf}")
    if (failed is not None and (saved is None or failed >= saved)) or tier == "index-error":
        state = "failed"
    elif tier.endswith("-stale"):
        state = "stale"
    else:
        state = "fresh"
    return {"refreshed_at": saved, "refresh_state": state}


# ── Public serve ─────────────────────────────────────────────────────────────
def fetch_index_bars(ticker: str, tf: str = "D", bars: int = 600,
                     since: Optional[int] = None) -> dict:
    """Cache-first index bars. Reads the full cached series, slices to `bars`, and
    applies the browser `since` delta. yfinance is only touched on a cold miss or the
    background warm loop — a warm request is a <1ms mem hit."""
    sym = (ticker or "").upper().strip()
    if sym not in INDEX_MAP:
        return {"ticker": ticker, "tf": tf, "bars": []}
    if not TF_MAP.get(tf):
        logger.warning(f"[index_bars] unknown tf={tf!r} for {ticker}")
        return {"ticker": ticker, "tf": tf, "bars": []}

    info: dict = {}
    try:
        series, tier = _cached_series(sym, tf, info)
    except Exception as e:
        logger.error(f"[index_bars] serve failed {sym} {tf}: {e}")
        series, tier = [], "index-error"
    try:
        from api.services.bars_fetch import _mark_serve
        _mark_serve(tier)
    except Exception:
        pass

    out = _settled_partial_withheld(series or [], tf, info.get("saved_at"), _now())
    if since is not None:
        out = [b for b in out if b["t"] > since]
    if len(out) > bars:
        out = out[-bars:]
    rep = info.get("repair")
    if isinstance(rep, dict):
        # Additive: `repaired` (sessions filled from the second vendor), `holes` (settled buckets
        # no vendor has: never filled), `history_rev` (moves when a repair changes held history).
        try:
            extra = _repair_fields(rep, out)
        except Exception as e:  # noqa: BLE001 - a record that cannot be read is not served
            logger.warning(f"[index_bars] repair fields failed {sym} {tf}: {type(e).__name__}: {e}")
            extra = {}
    else:
        extra = {}
    return {"ticker": ticker, "tf": tf, "bars": out, **extra,
            **_freshness(sym, tf, tier, info.get("saved_at"))}


# ── ⭐ RS RATING L10 — TODAY'S SESSION AS A DAILY BAR ────────────────────────────
# ⚰️ 2026-11-17, production, in session: RS Rating's label and dots were withheld on every
# chart (`runtime:request`): the chart's own daily series carries today's forming bar, SPX's
# ended at yesterday, so the run could not know what `request.security("SP:SPX", "D", close)`
# reads on the newest bar. Pre-market both end at yesterday and the label drew. The daily
# store (FMP, 6 h TTL) holds today only as a snapshot from whenever it last refreshed, or not
# at all — measured the same afternoon, 18:04 UTC: SPX's daily tail 11-16, NDX's an 11-17 row
# from an earlier refresh, and both answered `developing: null`.

#: The series an index's daily bar for TODAY is built from: the index's own 5-minute bars,
#: which this module already serves to a 5m index chart and the warm loop keeps hot. ONE
#: authority for today's index value — the daily bar and the intraday chart cannot disagree —
#: and no new provider call (Massive's index snapshot answers 403 for this key:
#: `uct_agent/marketdata/index_quote.py`).
DEVELOPING_SOURCE_TF = "5"
#: The newest 5-minute bar must start within this of the moment the bar describes (now, or the
#: session's close once it has ended). Older ⇒ the 5m series stopped refreshing, and a day bar
#: frozen at an earlier minute is not today's value: none is built.
DEVELOPING_MAX_LAG_S = 30 * 60
#: A daily row for today that the store read at least this long after the close is the
#: session's settled bar (the vendor's end of day) and stands; one read earlier is a snapshot
#: of an unfinished session, and today's bar built from the 5m series replaces it.
SETTLED_AFTER_CLOSE_S = 30 * 60

_ET = "America/New_York"


def _peek_entry(sym: str, tf: str, now: float) -> Optional[dict]:
    """The cached entry for (sym, tf), memory then the disk snapshot, WITHOUT a provider call
    on this thread. A missing or stale entry kicks the same bounded background refresh
    `_cached_series` does (the warm loop normally keeps it fresh)."""
    from api.services.cache import cache
    ttl = _TTL.get(tf, 300)
    mkey = f"idxbars_{sym}_{tf}"
    entry = cache.get(mkey)
    if not (entry and entry.get("series")):
        entry = _load_disk(sym, tf)
        if not (entry and entry.get("series")):
            _kick_bg_refresh(sym, tf)
            return None
        cache.set(mkey, entry, ttl=max(ttl, 60))
    if now - float(entry.get("saved_at") or 0) > ttl:
        _kick_bg_refresh(sym, tf)
    return entry


def _session_of(now: float):
    """(today's ET date, regular-session open ts, close ts) for the instant `now`; half-day
    aware (`bars_fetch._session_window`)."""
    import datetime as _dt
    from zoneinfo import ZoneInfo
    from api.services.bars_fetch import _session_window
    today = _dt.datetime.fromtimestamp(now, ZoneInfo(_ET)).date()
    open_ts, close_ts = _session_window(today, "rth")
    return today, open_ts, close_ts


def todays_index_daily_bar(ticker: str, now: Optional[float] = None) -> Optional[dict]:
    """TODAY's daily bar for a cash index, `{t, o, h, l, c, v}`, `t` the UTC midnight of
    today's ET session date (the key every daily index row carries, `_utc_midnight`), built
    from the index's own 5-minute bars of today's regular session: the first bar's open, the
    highest high, the lowest low, the newest bar's close, the summed volume. None when:
      - no 5m bar of today's session exists (before the open, a weekend, a holiday: the bars
        themselves are the gate, so no calendar is restated here);
      - the 5m series is not cached (never a provider call on this thread);
      - the 5m series is the ETF proxy, or was stored before the proxy flag existed;
      - its newest bar starts more than `DEVELOPING_MAX_LAG_S` before now (or the close)."""
    sym = (ticker or "").upper().strip()
    if sym not in INDEX_MAP:
        return None
    now = float(now if now is not None else time.time())
    today, open_ts, close_ts = _session_of(now)
    entry = _peek_entry(sym, DEVELOPING_SOURCE_TF, now)
    if not entry or entry.get("proxy") is not False:
        return None
    rows = []
    for b in entry.get("series") or []:
        try:
            t = int(b["t"])
            o, h, l, c = (float(b[k]) for k in ("o", "h", "l", "c"))
        except (KeyError, TypeError, ValueError):
            continue
        if open_ts <= t < min(close_ts, now + 1) and all(x == x for x in (o, h, l, c)):
            rows.append((t, o, h, l, c, int(b.get("v") or 0)))
    if not rows:
        return None
    rows.sort()
    newest = rows[-1][0]
    if newest < min(now, close_ts) - DEVELOPING_MAX_LAG_S:
        logger.info(f"[index_bars] {sym}: today's 5m series ends {int(min(now, close_ts) - newest)}s "
                    f"behind; no daily bar for today is built from it")
        return None
    return {"t": _utc_midnight(today), "o": rows[0][1], "h": max(r[2] for r in rows),
            "l": min(r[3] for r in rows), "c": rows[-1][4], "v": sum(r[5] for r in rows)}


def _previous_session(today):
    """The NYSE session before `today` (weekends and holidays skipped), or None."""
    import datetime as _dt
    from api.services.bars_fetch import _is_trading_day_ymd
    d = today - _dt.timedelta(days=1)
    for _ in range(10):
        if _is_trading_day_ymd(d):
            return d
        d -= _dt.timedelta(days=1)
    return None


def _runs_through_previous_session(ticker: str, bars: list, today_key: int, now: float) -> bool:
    """Does the daily series reach the session before today? Read from the served rows; an empty
    `since` delta carries none, so then from the stored series (`_peek_entry`, the entry
    `fetch_index_bars` just read). An unreadable answer is "no" (fail closed)."""
    rows = bars if bars else ((_peek_entry((ticker or "").upper().strip(), "D", now) or {}).get("series") or [])
    before = [b["t"] for b in rows if isinstance(b, dict) and isinstance(b.get("t"), (int, float))
              and not isinstance(b.get("t"), bool) and b["t"] < today_key]
    today, _open, _close = _session_of(now)
    prev = _previous_session(today)
    if not before or prev is None:
        return False
    if max(before) < _utc_midnight(prev):
        logger.info(f"[index_bars] {(ticker or '').upper()}: the daily series ends "
                    f"{_dt_iso(max(before))}, before the previous session {prev}; today's bar is not "
                    f"appended across that gap")
        return False
    return True


def _dt_iso(t) -> str:
    import datetime as _dt
    return _dt.datetime.fromtimestamp(int(t), _dt.timezone.utc).date().isoformat()


def with_todays_session(ticker: str, bars: list, now: Optional[float] = None) -> Optional[list]:
    """The served daily `bars` with TODAY's session bar as their tail, or None to leave them
    as they are. The equity serve's rule (`bars._augment_daily_with_today`), for an index:
      - no bar for today can be built (`todays_index_daily_bar`) → unchanged;
      - the tail is newer than today → unchanged (never reorder);
      - the tail IS today: it stands when the store read it at least `SETTLED_AFTER_CLOSE_S`
        after the close (the settled bar); otherwise it is a snapshot of an unfinished
        session and the bar built from the 5m series replaces it;
      - otherwise (yesterday's tail, or an empty `since` delta) → today's bar is appended.
    ⛔ NEVER ACROSS A GAP: the newest row before today (in the served rows, or for an empty
    `since` delta in the stored series) must be the PREVIOUS session. A daily store that stopped
    refreshing (measured 2026-11-17 19:30Z: RUT, DJX, XSP at 10-22, XND at 10-28) would otherwise
    have today's bar drawn beside a weeks-old one, hiding the gap a chart ending at 10-22 shows."""
    if not isinstance(bars, list):
        return None
    now = float(now if now is not None else time.time())
    built = todays_index_daily_bar(ticker, now)
    if not built:
        return None
    tail = bars[-1] if bars else None
    tail_t = tail.get("t") if isinstance(tail, dict) else None
    if tail is not None and (not isinstance(tail_t, (int, float)) or isinstance(tail_t, bool)):
        return None                      # a tail this module did not write: never touch it
    if tail_t is not None and tail_t > built["t"]:
        return None
    if not _runs_through_previous_session(ticker, bars, built["t"], now):
        return None
    if tail_t == built["t"]:
        _today, _open, close_ts = _session_of(now)
        daily = _peek_entry((ticker or "").upper().strip(), "D", now)
        if daily and float(daily.get("saved_at") or 0) >= close_ts + SETTLED_AFTER_CLOSE_S:
            return None
        return bars[:-1] + [built]
    return bars + [built]


# ── Warm loop (keeps all 7 indices hot in THIS process's disk store) ──────────
#: The web pod's set: every timeframe an index chart reads.
_WARM_TFS = ("D", "W", "M", "60", "15", "5", "1")
#: The bars-api tier's set (`api/bars_api_main.py`): the date series, and the 5-minute series
#: today's daily bar is built from (`DEVELOPING_SOURCE_TF`), so a member's daily answer is
#: current on its FIRST read. The tier's other intraday series stay refreshed by the read
#: itself (an open intraday chart polls every 30 s against a 300 s TTL); warming them too
#: would cost 21 more Yahoo downloads every pass on top of web's.
SERVING_TIER_WARM_TFS = ("D", "W", "M", DEVELOPING_SOURCE_TF)
#: Seconds between two vendor reads in one pass (politeness; the pass is sequential).
_WARM_PACE_S = 0.3


def warm_indices(tfs=None) -> dict:
    """Refresh every index × timeframe in `tfs` (default `_WARM_TFS`) whose cache is
    missing/stale into the disk store, so the first request after a deploy is a cache hit.
    Sequential and spaced to stay polite to the vendors. A series that fails does not stop
    the pass; each one is logged by name (`_refresh`) and named in the pass summary.
    Returns a small stats dict."""
    from api.services.cache import cache
    tfs = tuple(tfs or _WARM_TFS)
    stats = {"fetched": 0, "fresh": 0, "failed": 0}
    failed: List[str] = []
    now = time.time()
    for sym in index_symbols():
        for tf in tfs:
            ttl = _TTL.get(tf, 300)
            mem = cache.get(f"idxbars_{sym}_{tf}")
            disk = mem or _load_disk(sym, tf)
            if disk and disk.get("series") and now - disk.get("saved_at", 0) <= ttl:
                stats["fresh"] += 1
                continue
            try:
                series = _refresh(sym, tf)
            except Exception:              # noqa: BLE001 — already logged by name in _refresh
                series = []
            if series:
                stats["fetched"] += 1
            else:
                stats["failed"] += 1
                failed.append(f"{sym} {tf}")
            time.sleep(_WARM_PACE_S)   # polite pacing
    if failed:
        logger.warning(f"[index_bars] warm pass done: {stats}; FAILED: {', '.join(failed)}")
    else:
        logger.info(f"[index_bars] warm pass done: {stats}")
    return stats


def start_index_warm(interval_seconds: int = 300, tfs=None) -> None:
    """Boot warm + periodic refresh on a daemon thread, over `tfs` (default `_WARM_TFS`).
    Only 7 symbols, so this is cheap enough to run on the web pod and on the bars-api tier
    (no worker/R2 dependency for indices)."""
    def _loop():
        time.sleep(15)   # let boot settle
        while True:
            try:
                warm_indices(tfs)
            except Exception:
                logger.exception("[index_bars] warm loop error")
            time.sleep(interval_seconds)
    # The deep settled history's backfill (FMP), on its OWN thread, after the boot settles (never this loop).
    start_deep_backfill()
    threading.Thread(target=_loop, name="index-bars-warm", daemon=True).start()
