"""
index_bars.py — cache-backed bars for cash-settled indexes that Schwab's
/pricehistory doesn't serve (SPX, NDX, VIX, RUT, DJX, XSP, XND).

WHY THIS EXISTS
  Schwab serves /pricehistory for ETFs but returns {"bars": []} for cash indexes.
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
  STALE-WHILE-REVALIDATE: if we have ANY cached series it is served IMMEDIATELY and a
  refresh is kicked to a bounded background pool — a request NEVER blocks on yfinance
  when we already have data. The proxy ratio is cached (it drifts ~quarterly), so the
  intraday proxy no longer pays 2 extra downloads per request.

  A web-side warm loop (`start_index_warm`) keeps all 7 indices hot in the disk store
  so even the first request after a deploy is a cache hit. Only 7 symbols, so warming
  on the web pod is negligible (unlike the full equity universe, which is worker-only).

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
    "60m": "60d", "90m": "60d",
    "1d":  "5y",  "5d":  "5y",  "1wk": "10y", "1mo": "max", "3mo": "max",
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


def is_index(ticker: str) -> bool:
    """True if the ticker should route through yfinance instead of Schwab."""
    return (ticker or "").upper().strip() in INDEX_TICKERS


def index_symbols() -> list[str]:
    return sorted(INDEX_TICKERS)


# ── yfinance fetch (the only slow tier) ──────────────────────────────────────
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
            o = float(row["Open"]) / divisor
            h = float(row["High"]) / divisor
            l = float(row["Low"]) / divisor
            c = float(row["Close"]) / divisor
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


def _fetch_full_series(sym: str, tf: str) -> List[Dict[str, Any]]:
    """Fetch the full available index series for (sym, tf) from yfinance, with the
    intraday ETF-proxy fallback (ratio cached)."""
    yahoo_sym, divisor = INDEX_MAP[sym]
    interval = TF_MAP.get(tf)
    if not interval:
        return []
    period = PERIOD_MAP.get(interval, "60d")
    out = _fetch_yf(yahoo_sym, interval, period, divisor)
    if (interval in INTRADAY_INTERVALS and len(out) < INTRADAY_SPARSE_THRESHOLD
            and sym in ETF_PROXY):
        etf_sym, ratio_target = ETF_PROXY[sym]
        ratio = _proxy_ratio(ratio_target, etf_sym)
        if ratio is not None:
            proxy_out = _fetch_yf(etf_sym, interval, period, divisor / ratio)
            if len(proxy_out) > len(out):
                out = proxy_out
    return out


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


def _save_disk(sym: str, tf: str, series: list) -> None:
    try:
        os.makedirs(_DISK_DIR, exist_ok=True)
        tmp = _disk_path(sym, tf) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"saved_at": time.time(), "series": series}, fh, separators=(",", ":"))
        os.replace(tmp, _disk_path(sym, tf))
    except Exception as e:
        logger.warning(f"[index_bars] disk save failed {sym} {tf}: {e}")


def _refresh(sym: str, tf: str) -> list:
    """Cold/background fetch → write mem + disk. Returns the fresh series ([] on fail)."""
    from api.services.cache import cache
    series = _fetch_full_series(sym, tf)
    if series:
        cache.set(f"idxbars_{sym}_{tf}", {"saved_at": time.time(), "series": series},
                  ttl=max(_TTL.get(tf, 300), 60))
        _save_disk(sym, tf, series)
    return series


def _kick_bg_refresh(sym: str, tf: str) -> None:
    key = f"{sym}_{tf}"
    with _bg_lock:
        if key in _bg_inflight or len(_bg_inflight) >= 8:
            return
        _bg_inflight.add(key)

    def _job():
        try:
            _refresh(sym, tf)
        except Exception as e:
            logger.info(f"[index_bars] bg refresh {sym} {tf} failed: {e}")
        finally:
            with _bg_lock:
                _bg_inflight.discard(key)
    try:
        _bg_pool.submit(_job)
    except Exception:
        with _bg_lock:
            _bg_inflight.discard(key)


def _cached_series(sym: str, tf: str):
    """Return (series, tier). Never blocks on yfinance when ANY cached data exists —
    stale data is served immediately and a background refresh is kicked."""
    from api.services.cache import cache
    ttl = _TTL.get(tf, 300)
    now = time.time()
    mkey = f"idxbars_{sym}_{tf}"

    mem = cache.get(mkey)
    if mem and mem.get("series"):
        if now - mem.get("saved_at", 0) <= ttl:
            return mem["series"], "index-mem"
        _kick_bg_refresh(sym, tf)          # stale but usable → serve + revalidate
        return mem["series"], "index-mem-stale"

    disk = _load_disk(sym, tf)
    if disk and disk.get("series"):
        cache.set(mkey, disk, ttl=max(ttl, 60))
        if now - disk.get("saved_at", 0) <= ttl:
            return disk["series"], "index-disk"
        _kick_bg_refresh(sym, tf)
        return disk["series"], "index-disk-stale"

    # Truly cold: no cache anywhere — the ONE slow request (then warm forever).
    return _refresh(sym, tf), "index-yf"


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

    try:
        series, tier = _cached_series(sym, tf)
    except Exception as e:
        logger.error(f"[index_bars] serve failed {sym} {tf}: {e}")
        series, tier = [], "index-error"
    try:
        from api.services.bars_fetch import _mark_serve
        _mark_serve(tier)
    except Exception:
        pass

    out = series or []
    if since is not None:
        out = [b for b in out if b["t"] > since]
    if len(out) > bars:
        out = out[-bars:]
    return {"ticker": ticker, "tf": tf, "bars": out}


# ── Web-side warm loop (keeps all 7 indices hot in the disk store) ────────────
_WARM_TFS = ("D", "W", "M", "60", "15", "5", "1")


def warm_indices() -> dict:
    """Refresh every index × timeframe whose cache is missing/stale into the disk
    store, so the first request after a deploy is a cache hit. Spaced to stay polite
    to yfinance. Returns a small stats dict."""
    from api.services.cache import cache
    stats = {"fetched": 0, "fresh": 0, "failed": 0}
    now = time.time()
    for sym in index_symbols():
        for tf in _WARM_TFS:
            ttl = _TTL.get(tf, 300)
            mem = cache.get(f"idxbars_{sym}_{tf}")
            disk = mem or _load_disk(sym, tf)
            if disk and disk.get("series") and now - disk.get("saved_at", 0) <= ttl:
                stats["fresh"] += 1
                continue
            series = _refresh(sym, tf)
            stats["fetched" if series else "failed"] += 1
            time.sleep(0.3)   # polite pacing
    logger.info(f"[index_bars] warm pass done: {stats}")
    return stats


def start_index_warm(interval_seconds: int = 300) -> None:
    """Boot warm + periodic refresh on a daemon thread. Only 7 symbols, so this is
    cheap enough to run on the web pod (no worker/R2 dependency for indices)."""
    def _loop():
        time.sleep(15)   # let boot settle
        while True:
            try:
                warm_indices()
            except Exception:
                logger.exception("[index_bars] warm loop error")
            time.sleep(interval_seconds)
    threading.Thread(target=_loop, name="index-bars-warm", daemon=True).start()
