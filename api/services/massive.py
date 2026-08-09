"""Service layer calling Massive.com REST API directly.

Provides get_snapshot() and get_movers() with TTL caching.
Calls https://api.massive.com using MASSIVE_API_KEY env var.

No dependency on the local uct-intelligence package — works on Railway.
"""
import os
import time
import concurrent.futures as _cf
from typing import Any

import httpx

from api.services.cache import cache

_REST_BASE = "https://api.massive.com"

# yfinance (used for VIX/BTC/futures snapshots + a liquidity filter) has NO
# request timeout, so a hung Yahoo call pins the caller's worker thread forever —
# enough of those exhaust the anyio pool and take the whole site down (the
# 2026-07-01 incident). Run yfinance calls on a small dedicated pool and cap the
# wait: a hung call returns the fallback in _YF_TIMEOUT_S instead of never. Any
# still-running orphan is bounded to the pool's 4 workers. Treated as a black box
# so we never touch yfinance internals (version-fragile).
_YF_TIMEOUT_S = 12.0
_YF_POOL = _cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="yf-bound")


def _bounded_yf(fn, default, timeout: float = _YF_TIMEOUT_S):
    """Run a blocking yfinance callable with a hard wall-clock cap.
    Returns `default` on timeout or any error."""
    try:
        return _YF_POOL.submit(fn).result(timeout=timeout)
    except Exception:
        return default


def to_polygon_symbol(ticker: str) -> str:
    """Map an app/UI ticker to the symbol Massive (Polygon-compatible)
    expects. Class shares use DOT notation upstream (BRK.B), but the
    universe list, SQLite cache, FMP and yfinance all use the HYPHEN
    form (BRK-B). Verified empirically: Massive returns n=0 for
    'BRK-B'/'BF-B' but full fresh data for 'BRK.B'/'BF.B'. Without this,
    every dual-class ticker's Massive (and delta) fetch returns nothing
    and the chart stays frozen at whatever the cache last had.

    Apply ONLY at the Massive REST boundary — storage/cache keys and the
    FMP/yfinance fallbacks keep the canonical hyphen form. No-op for
    normal tickers (no hyphen)."""
    return ticker.upper().replace("-", ".")

_client = None

# Shared httpx session — persistent TCP connections.
# read=25s: historical bar responses can be large (8000 daily bars ≈ 500 KB
# compressed); 8s was timing out on Massive for full-universe fetches.
# connect=3s: fast fail on DNS/TCP failure.
# max_connections=30: more headroom when multiple tickers load simultaneously.
_http = httpx.Client(
    # Doubled max_connections to 60 + pool wait to 10s. With Phase 4 + browser
    # loading multiple charts × multiple TFs simultaneously, the previous
    # 30-connection limit was getting exhausted under load, causing
    # _fetch_intraday_massive to silently fail with PoolTimeout (caught by
    # blanket except → return []) → /api/bars empty → blank charts.
    timeout=httpx.Timeout(connect=3.0, read=25.0, write=5.0, pool=10.0),
    limits=httpx.Limits(max_keepalive_connections=30, max_connections=60),
    headers={"Accept": "application/json"},
)


class _MassiveRestClient:
    """Lightweight REST client wrapping the Massive.com API directly.

    Polygon.io-compatible API at api.massive.com.
    Uses MASSIVE_API_KEY from environment variables.
    """

    def __init__(self):
        self._api_key = os.environ.get("MASSIVE_API_KEY", "")
        if not self._api_key:
            raise RuntimeError("MASSIVE_API_KEY not set in environment")

    def _get(self, url: str, timeout: float = None) -> dict:
        resp = _http.get(url, timeout=timeout)  # None = use client-level timeout (read=25s)
        resp.raise_for_status()
        return resp.json()

    def get_top_movers(self, direction: str = "gainers", limit: int = 20) -> list:
        """Return top gaining or losing stocks for the current session.

        Returns list of dicts: ticker, change_pct, change, close, volume
        """
        if direction not in ("gainers", "losers"):
            raise ValueError("direction must be 'gainers' or 'losers'")
        url = (
            f"{_REST_BASE}/v2/snapshot/locale/us/markets/stocks/{direction}"
            f"?apiKey={self._api_key}"
        )
        data = self._get(url)
        result = []
        for t in data.get("tickers", [])[:limit]:
            day = t.get("day", {})
            result.append({
                "ticker":     t.get("ticker", ""),
                "change_pct": round(float(t.get("todaysChangePerc", 0.0)), 2),
                "change":     round(float(t.get("todaysChange", 0.0)), 4),
                "close":      day.get("c", 0.0),
                "volume":     int(float(day.get("v", 0) or 0)),
            })
        return result

    def get_single_ticker_snapshot(self, ticker: str) -> dict:
        """Return real-time snapshot for a single US equity ticker.

        Returns dict with: close, vwap, change_pct, change
        Returns empty dict if not found or on error.
        """
        url = (
            f"{_REST_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
            f"/{to_polygon_symbol(ticker)}?apiKey={self._api_key}"
        )
        try:
            data = self._get(url)
        except Exception:
            return {}

        if data.get("status") not in ("OK", "DELAYED"):
            return {}

        t = data.get("ticker", {})
        if not t:
            return {}

        day        = t.get("day", {})
        last_trade = t.get("lastTrade", {})
        prev_day   = t.get("prevDay", {})

        # Pre-market: day.c == 0 (no regular-session trades yet).
        # Fall back to lastTrade.p (last extended-hours print) then prevDay.c.
        close = day.get("c") or last_trade.get("p") or prev_day.get("c") or 0.0

        # A4: Extended-hours fields
        session = _detect_session()
        ext_price = None
        ext_session = None
        if session != "regular":
            lt_price = last_trade.get("p")
            if lt_price and float(lt_price) > 0:
                ext_price = round(float(lt_price), 2)
                ext_session = session  # "pre_market" | "post_market"

        return {
            "close":       close,
            "vwap":        day.get("vw", 0.0),
            "change_pct":  round(float(t.get("todaysChangePerc", 0.0)), 4),
            "change":      round(float(t.get("todaysChange", 0.0)), 4),
            "ext_price":   ext_price,
            "ext_session": ext_session,
        }


    # Massive's snapshot endpoint (like Polygon's) caps a `tickers=` batch — a
    # multi-thousand-ticker URL (Theme Tracker sends ~2,050 holdings across all
    # themes) 414s / truncates, so the whole call came back empty and every
    # theme silently kept its STALE daily-bar % (collapsed rows showed a leader
    # that wasn't). Chunk under the cap and merge; a failed chunk skips only its
    # own tickers, never the rest.
    _SNAPSHOT_BATCH = 200

    def get_batch_snapshots(self, tickers: list[str]) -> dict[str, float]:
        """Return regular-session % change for a batch of tickers.

        Chunked under the endpoint's ticker cap AND fetched in PARALLEL — the
        Theme Tracker sends ~2,050 holdings = ~11 chunks; sequential fetches were
        ~1s each (~10s total), which stalled the theme-performance rebuild and
        froze the tab on load. Parallel collapses that to ~one round-trip.
        """
        if not tickers:
            return {}

        def _f(v):
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        uniq = list(dict.fromkeys(t.upper() for t in tickers))
        chunks = [uniq[i:i + self._SNAPSHOT_BATCH]
                  for i in range(0, len(uniq), self._SNAPSHOT_BATCH)]

        def _fetch_chunk(chunk):
            url = (
                f"{_REST_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
                f"?tickers={','.join(chunk)}&apiKey={self._api_key}"
            )
            try:
                return self._get(url).get("tickers", []) or []
            except Exception:
                return []  # one bad chunk must not wipe the others

        rows: list = []
        if len(chunks) <= 1:
            rows = _fetch_chunk(chunks[0]) if chunks else []
        else:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=min(6, len(chunks))) as ex:
                for chunk_rows in ex.map(_fetch_chunk, chunks):
                    rows.extend(chunk_rows)

        result: dict[str, float] = {}
        for t in rows:
            ticker = t.get("ticker", "")
            if not ticker:
                continue
            day_c = _f((t.get("day") or {}).get("c"))
            prev_c = _f((t.get("prevDay") or {}).get("c"))
            chg = _f(t.get("todaysChangePerc"))
            # ALWAYS derive the % from day close vs prev close when we have both —
            # the REGULAR-session move (matches the chart's close-vs-prev legend).
            # Massive's todaysChangePerc is LAST-TRADE-based (incl. after-hours), so
            # after the close it over/under-states the regular % (TWST 2.93% vs the
            # real 2.87%) AND intermittently comes back a stale 0 → Theme Tracker
            # flashes to 0.00%. A genuinely flat stock still has day_c == prev_c → 0.
            if day_c and prev_c:
                result[ticker] = round((day_c - prev_c) / prev_c * 100.0, 4)
            elif chg is not None and chg != 0.0:
                result[ticker] = round(chg, 4)
            # else: no day close to compute from AND change is 0/missing → no data
            # yet → OMIT the ticker so callers keep their last-known value instead
            # of overwriting it with a spurious 0.00%.
        return result

    def get_batch_rich_snapshots(self, tickers: list[str]) -> dict[str, dict]:
        """Return price + prev-day volume + change_pct + day_open + prev_close
        for a batch of tickers.

        Uses the same batch endpoint as get_batch_snapshots but extracts richer fields.
        price       — today's close (falls back to lastTrade → prevDay close)
        vol         — yesterday's full-day volume (prevDay.v) — stable proxy for liquidity
        change_pct  — today's % change (intraday, vs prev close)
        day_open    — today's regular-session opening print (0 pre-market)
        prev_close  — yesterday's regular-session close
        """
        if not tickers:
            return {}
        tickers_param = ",".join(t.upper() for t in tickers)
        url = (
            f"{_REST_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
            f"?tickers={tickers_param}&apiKey={self._api_key}"
        )
        try:
            data = self._get(url)
        except Exception:
            return {}
        session = _detect_session()
        result = {}
        for t in data.get("tickers", []):
            ticker = t.get("ticker", "")
            if not ticker:
                continue
            day      = t.get("day", {})
            prev_day = t.get("prevDay", {})
            last     = t.get("lastTrade", {})
            close    = day.get("c") or last.get("p") or prev_day.get("c") or 0.0
            vol      = int(prev_day.get("v") or day.get("v") or 0)

            # A4: Extended-hours fields
            ext_price = None
            ext_session = None
            if session != "regular":
                lt_price = last.get("p")
                if lt_price and float(lt_price) > 0:
                    ext_price = round(float(lt_price), 2)
                    ext_session = session

            result[ticker] = {
                "price":       round(float(close), 2),
                "vol":         vol,
                "change_pct":  round(float(t.get("todaysChangePerc", 0.0)), 4),
                "day_open":    round(float(day.get("o") or 0.0), 2),
                "prev_close":  round(float(prev_day.get("c") or 0.0), 2),
                "ext_price":   ext_price,
                "ext_session": ext_session,
            }
        return result

    def get_full_market_snapshot(self) -> dict[str, dict]:
        """Snapshot the ENTIRE US equities market in one call (~10k names).

        Hits the all-tickers snapshot endpoint with NO ticker filter, so it
        returns every name — unlike get_top_movers (capped at 20 by percent)
        and get_batch_rich_snapshots (a specific ticker list). Used by the
        catalyst broad gap-scan to surface modest-% big-cap NEWS movers that
        a percentage-ranked top-20 list structurally misses.

        Per ticker returns just what the gap-scan needs:
          last_price  — lastTrade.p (pre-market aware) → day.c → prevDay.c
          prev_close  — prevDay.c (yesterday's regular-session close)
          today_vol   — day.v (today's volume so far)
          prev_vol    — prevDay.v (yesterday's full-day volume; stable liquidity)
        Returns {} on error.
        """
        url = (
            f"{_REST_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
            f"?apiKey={self._api_key}"
        )
        try:
            data = self._get(url)
        except Exception:
            return {}
        out: dict[str, dict] = {}
        for t in data.get("tickers", []):
            ticker = t.get("ticker", "")
            if not ticker:
                continue
            day      = t.get("day", {})
            prev_day = t.get("prevDay", {})
            last     = t.get("lastTrade", {})
            last_price = float(last.get("p") or day.get("c") or prev_day.get("c") or 0.0)
            out[ticker] = {
                "last_price": round(last_price, 4),
                "prev_close": round(float(prev_day.get("c") or 0.0), 4),
                "today_vol":  int(day.get("v") or 0),
                "prev_vol":   int(prev_day.get("v") or 0),
            }
        return out


def _get_client() -> _MassiveRestClient:
    """Return a shared _MassiveRestClient instance, initializing on first call."""
    global _client
    if _client is None:
        try:
            _client = _MassiveRestClient()
        except Exception as e:
            raise RuntimeError(f"Failed to initialize Massive client: {e}")
    return _client


def _fmt_price(val) -> str:
    """Format a float price with comma-thousands and 2 decimals."""
    try:
        f = float(val)
        if f >= 1000:
            return f"{f:,.2f}"
        return f"{f:.2f}"
    except (TypeError, ValueError):
        return str(val)


def _fmt_chg(pct: float) -> tuple[str, str]:
    """Return (formatted change string, css class string) for a % change value."""
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct:.2f}%", ("pos" if pct >= 0 else "neg")


def _is_leveraged_etf(ticker: str) -> bool:
    """Return True if ticker is a leveraged/inverse ETF. Cached 24h via existing cache."""
    cache_key = f"is_lev_{ticker}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    verified = False
    try:
        import yfinance as yf
        info = _bounded_yf(lambda: yf.Ticker(ticker).info, None)
        if not info:
            result = False
        else:
            verified = True
            name = (info.get("longName", "") + " " + info.get("shortName", "")).lower()
            keywords = ["2x", "3x", "-2x", "-3x", "ultra", "leveraged", "inverse",
                        "bull 2", "bear 2", "bull 3", "bear 3", "direxion daily",
                        "proshares ultra"]
            result = any(kw in name for kw in keywords)
    except Exception:
        result = False
    # A yfinance failure/empty `.info` could not actually determine leveraged-
    # ness -- caching that unverified `False` for 24h means TQQQ/SQQQ/SOXL etc.
    # render as ordinary stocks in Top Movers for a day on a transient blip.
    # Only a real answer earns the long TTL; an unverifiable one retries soon.
    cache.set(cache_key, result, ttl=86400 if verified else 300)
    return result


# ── Liquidity filter thresholds ───────────────────────────────────────────────
_PRICE_MIN    = 2.0          # price must be strictly above $2
_PM_VOL_MIN   = 50_000       # min shares in current session (pre-market at open)
_AVG_DVOL_MIN = 5_000_000    # min 5-day avg dollar volume ($5M)


def _get_avg_dollar_vol(tickers: list) -> dict[str, float]:
    """Return 5-day average dollar volume for each ticker via yfinance.

    Fetches all tickers in parallel (ThreadPoolExecutor).
    Returns float("inf") for any ticker where history cannot be fetched —
    meaning it will NOT be filtered out if yfinance is unavailable.
    """
    if not tickers:
        return {}
    try:
        import yfinance as yf

        def _fetch_one(ticker: str) -> tuple[str, float]:
            try:
                hist = yf.Ticker(ticker).history(period="10d")
                if hist.empty:
                    return ticker, 0.0
                dvol = (hist["Close"] * hist["Volume"]).tail(5)
                return ticker, float(dvol.mean()) if not dvol.empty else 0.0
            except Exception:
                return ticker, float("inf")  # can't fetch → don't filter out

        # Bound the whole batch to a hard deadline + non-blocking shutdown so a
        # hung Yahoo request can't pin this thread forever (2026-07-01 incident).
        ex = _cf.ThreadPoolExecutor(max_workers=min(len(tickers), 8), thread_name_prefix="yf-dvol")
        futures = {ex.submit(_fetch_one, t): t for t in tickers}
        result: dict[str, float] = {}
        deadline = time.monotonic() + 15.0
        for fut, t in futures.items():
            try:
                k, v = fut.result(timeout=max(0.0, deadline - time.monotonic()))
                result[k] = v
            except Exception:
                result[t] = float("inf")  # timeout/error → don't filter out
        ex.shutdown(wait=False, cancel_futures=True)
        return result
    except Exception:
        return {t: float("inf") for t in tickers}


def _yfinance_snapshot(ticker: str) -> dict:
    """Fetch latest price via yfinance (used for futures/crypto not in Massive equities)."""
    try:
        import yfinance as yf

        def _work():
            t = yf.Ticker(ticker)
            fi = t.fast_info
            close = float(fi.last_price)
            prev  = float(fi.previous_close)
            chg_pct = (close - prev) / prev * 100 if prev else 0.0
            return {"close": close, "vwap": close, "change_pct": round(chg_pct, 4)}

        return _bounded_yf(_work, {})
    except Exception:
        return {}


# NOTE: unused since 2026-07-27 — its only caller was the index-futures snapshot
# path, which was removed. Kept because it is the only .info-based quote helper.
def _yf_quote_info(ticker: str) -> dict:
    """Accurate quote via Yahoo's regularMarket* fields.

    For INDEX FUTURES the day-change must be measured against the prior
    SETTLEMENT — which is `regularMarketPreviousClose`, NOT
    `fast_info.previous_close` (that reads a different/earlier reference and
    understates the move badly, e.g. -0.17% vs the true -0.53% on ES).
    `regularMarketChangePercent` is already in percent units. Falls back to the
    fast_info snapshot on any failure. (Do NOT use this for ^VIX — Yahoo's
    regularMarketChangePercent for the index is unreliable.)"""
    try:
        import yfinance as yf

        def _work():
            info = yf.Ticker(ticker).get_info()
            price = info.get("regularMarketPrice")
            chg   = info.get("regularMarketChangePercent")
            if price is None or chg is None:
                return None
            return {"close": float(price), "vwap": float(price), "change_pct": round(float(chg), 4)}

        got = _bounded_yf(_work, None)
        return got if got is not None else _yfinance_snapshot(ticker)
    except Exception:
        return _yfinance_snapshot(ticker)


def _detect_session() -> str:
    """Detect current market session based on ET time.

    Returns 'pre_market', 'post_market', or 'regular'.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo
    now = datetime.now(ZoneInfo("America/New_York"))
    # Weekends → post_market (last session that ran)
    if now.weekday() >= 5:
        return "post_market"
    hour_min = now.hour * 100 + now.minute
    # The overnight window (midnight–4:00am) is still the JUST-CLOSED post-market,
    # not the next day's pre-market — pre-market doesn't begin until 4:00am ET.
    if hour_min < 400:
        return "post_market"
    if hour_min < 930:
        return "pre_market"
    if hour_min >= 1600:
        return "post_market"
    return "regular"


def get_extended_movers() -> dict:
    """Return gainers/losers for the extended-hours movers page.

    Uses the same Massive gainers/losers snapshot endpoints.
    Filters: price > $5. Auto-detects session (pre/post/regular).

    Returns {"gainers": [...], "losers": [...], "session": str}
    Each entry: {ticker, price, change_pct, volume}
    """
    cached = cache.get("extended_movers")
    if cached is not None:
        return cached

    session = _detect_session()
    client = _get_client()

    def _fetch_side(direction: str) -> list:
        try:
            raw = client.get_top_movers(direction=direction, limit=40)
        except Exception:
            return []
        result = []
        for m in raw:
            price = float(m.get("close") or 0)
            if price <= 5.0:
                continue
            result.append({
                "ticker":     m["ticker"],
                "price":      round(price, 2),
                "change_pct": m["change_pct"],
                "volume":     m["volume"],
            })
            if len(result) >= 20:
                break
        return result

    gainers = _fetch_side("gainers")
    losers = _fetch_side("losers")

    data = {"gainers": gainers, "losers": losers, "session": session}
    cache.set("extended_movers", data, ttl=60)
    return data


def get_ticker_snapshot(ticker: str) -> dict:
    """Return change_pct for a single equity ticker (for earnings gap display)."""
    try:
        return _get_client().get_single_ticker_snapshot(ticker)
    except Exception:
        return {}


def get_ticker_details(ticker: str) -> dict:
    """Polygon-style ticker reference (market_cap, shares, name, exchange).
    Best-effort: returns {} if Massive doesn't serve the reference endpoint."""
    try:
        cli = _get_client()
        url = (f"{_REST_BASE}/v3/reference/tickers/{to_polygon_symbol(ticker)}"
               f"?apiKey={cli._api_key}")
        j = cli._get(url) or {}
        return j.get("results") or {}
    except Exception:
        return {}


def get_market_cap(ticker: str, price: float | None = None):
    """Market cap (float USD) from Massive ticker details, or None. Best-effort.
    Prefers the ``market_cap`` field; falls back to shares_outstanding * price
    (price from the caller's bars) when the field is absent."""
    res = get_ticker_details(ticker)
    if not res:
        return None
    mc = res.get("market_cap")
    try:
        if mc:
            return float(mc)
    except (TypeError, ValueError):
        pass
    shares = res.get("weighted_shares_outstanding") or res.get("share_class_shares_outstanding")
    try:
        if shares and price:
            return float(shares) * float(price)
    except (TypeError, ValueError):
        pass
    return None


def get_etf_snapshots(tickers: list[str]) -> dict[str, float]:
    """Return intraday % change for a list of ETF tickers via batch snapshot.

    Returns dict mapping ticker -> change_pct float.
    Returns empty dict on Massive client failure.
    """
    try:
        return _get_client().get_batch_snapshots(tickers)
    except Exception:
        return {}


def get_agg_bars(ticker: str, from_date: str, to_date: str) -> list[dict]:
    """Return daily OHLCV bars for a ticker from the Massive agg endpoint.

    Args:
        ticker:    Equity ticker symbol (e.g. "RKLB")
        from_date: Start date in "YYYY-MM-DD" format
        to_date:   End date in "YYYY-MM-DD" format

    Returns:
        List of bar dicts with keys: t (unix ms), o, h, l, c, v
        Empty list on any error or if ticker not found.
    """
    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{to_polygon_symbol(ticker)}/range/1/day"
            f"/{from_date}/{to_date}"
            f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        data = client._get(url)
        return data.get("results") or []
    except Exception:
        return []


def get_daily_agg(symbol: str, from_date: str, to_date: str, *,
                  adjusted: bool = False, map_symbol: bool = True) -> list[dict]:
    """Daily OHLCV bars from the Massive agg endpoint. Generic over ticker —
    works for equities (map_symbol=True applies to_polygon_symbol) AND option
    OCC symbols like 'O:AAPL260116C00200000' (map_symbol=False, verbatim).
    adjusted=False gives raw point-in-time prices for portfolio valuation."""
    try:
        client = _get_client()
        sym = to_polygon_symbol(symbol) if map_symbol else symbol
        adj = "true" if adjusted else "false"
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{sym}/range/1/day/{from_date}/{to_date}"
            f"?adjusted={adj}&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        return client._get(url).get("results") or []
    except Exception:
        return []


def get_grouped_daily_closes(day_iso: str, adjusted: bool = True) -> dict:
    """{TICKER: close} for ONE date — the whole US equities market in a single call.

    Provider-form tickers (BRK.B). adjusted=True → split-adjusted to the current basis
    (so a return measured against an old close is correct across any split). Returns {}
    for a non-trading day (the endpoint answers with zero results) or on error. Powers the
    Top-Gainers scans' whole-market N-day reference AND the Custom-Period Sort.

    CACHED per (date, adjusted): a PAST date's whole-market closes are IMMUTABLE, so this
    ~8,000-ticker fetch runs at most once per date (Custom-Period Sort was re-fetching two
    of them on every range). A recent date (could still be forming) caches only briefly."""
    import datetime as _dt
    ck = f"grouped_close_{day_iso}_{1 if adjusted else 0}"
    cached = cache.get(ck)
    if cached is not None:
        return cached
    try:
        client = _get_client()
        adj = "true" if adjusted else "false"
        url = (
            f"{_REST_BASE}/v2/aggs/grouped/locale/us/market/stocks/"
            f"{day_iso}?adjusted={adj}&apiKey={client._api_key}"
        )
        data = client._get(url) or {}
    except Exception:
        return {}
    out: dict[str, float] = {}
    for r in (data.get("results") or []):
        tk, c = r.get("T"), r.get("c")
        if tk and isinstance(c, (int, float)) and c > 0:
            out[str(tk).upper()] = float(c)
    if out:  # never cache an empty/error (would pin a non-trading-day miss)
        # Strictly before yesterday (UTC) = a settled past day → cache long; today/yesterday
        # may still be forming → short.
        _cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=1)).date().isoformat()
        cache.set(ck, out, ttl=(604800 if day_iso < _cutoff else 900))
    return out


def get_split_tickers(from_iso: str, to_iso: str) -> set:
    """Set of tickers (provider-form) with a stock split whose execution_date falls in
    [from_iso, to_iso]. Paginated /v3/reference/splits — a handful of calls covers the
    whole market for a 30–90 day window.

    Lets a return computation tell a REAL split (trust the split-adjusted close) from the
    provider's PHANTOM adjustment (a name with no real split whose adjusted feed is still
    divided by a bogus factor → trust the raw close). set() on error."""
    out: set = set()
    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v3/reference/splits"
            f"?execution_date.gte={from_iso}&execution_date.lte={to_iso}"
            f"&limit=1000&apiKey={client._api_key}"
        )
        for _ in range(20):  # safety cap on pagination
            data = client._get(url) or {}
            for r in (data.get("results") or []):
                t = r.get("ticker")
                if t:
                    out.add(str(t).upper())
            nxt = data.get("next_url")
            if not nxt:
                break
            url = f"{nxt}&apiKey={client._api_key}"
    except Exception:
        return set()
    return out


def get_agg_bars_minute(ticker: str, multiplier: int, from_date: str, to_date: str) -> list[dict]:
    """Return intraday minute-aggregated OHLCV bars for a ticker over a date
    range from the Massive agg endpoint (timespan=minute). Follows ``next_url``
    pagination so a multi-day window isn't silently truncated.

    Args:
        ticker:     Equity ticker symbol (e.g. "SNDK")
        multiplier: bar size in minutes (e.g. 5 for 5-minute bars)
        from_date:  Start date "YYYY-MM-DD" (inclusive)
        to_date:    End date "YYYY-MM-DD" (inclusive)

    Returns:
        List of raw bar dicts (keys: t=unix ms, o, h, l, c, v). Empty on error.
    """
    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{to_polygon_symbol(ticker)}/range/{int(multiplier)}/minute"
            f"/{from_date}/{to_date}"
            f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        results: list[dict] = []
        for _page in range(10):  # 10 × 50000 safety cap — one day of 5-min is ~78 bars
            data = client._get(url)
            results.extend(data.get("results") or [])
            nxt = data.get("next_url")
            if not nxt:
                break
            sep = "&" if "?" in nxt else "?"
            url = f"{nxt}{sep}apiKey={client._api_key}"
        return results
    except Exception:
        return []


def get_snapshot() -> dict:
    """Return formatted market snapshot for the FuturesStrip tile (QQQ/SPY/IWM/DIA/BTC/VIX).

    ETFs (QQQ, SPY, IWM, DIA): Massive REST API snapshot.
    BTC: yfinance (BTC-USD) — crypto not in Massive equities API.
    VIX: yfinance (^VIX) — index not in Massive equities API.

    Returns:
        {
          "futures": {"BTC": {"price": "...", "chg": "...", "css": "pos|neg"}},
          "etfs":    {"QQQ": ..., "SPY": ..., "IWM": ..., "DIA": ..., "VIX": ...},
        }

    Raises RuntimeError on Massive client failure (caller handles with 503).
    """
    cached = cache.get("snapshot")
    if cached is not None:
        return cached

    client = _get_client()

    # QQQ/SPY/IWM/DIA → Massive equities API (real-time)
    etf_tickers = ["QQQ", "SPY", "IWM", "DIA"]
    # Index futures (ES/NQ/YM/RTY) removed 2026-07-27 — owner call. Nothing renders
    # them any more, and yfinance's futures previous_close is a session stale, so
    # their day-change was measured off the wrong baseline. Four fewer yfinance
    # calls on a 15s-cached endpoint that every dashboard page polls.
    # BTC + VIX → the lighter fast_info snapshot (accurate for these; Yahoo's
    # regularMarketChangePercent is unreliable for ^VIX). VIX rides in the etfs dict.
    fast_targets = {"BTC": "BTC-USD", "VIX": "^VIX"}

    _EMPTY = {"price": "—", "chg": "—", "css": ""}

    def _make_entry(snap: dict) -> dict[str, Any]:
        price   = snap.get("close") or snap.get("vwap") or 0.0
        chg_pct = snap.get("change_pct") or 0.0
        chg_str, css = _fmt_chg(float(chg_pct))
        return {"price": _fmt_price(price), "chg": chg_str, "css": css}

    etfs = {}
    for ticker in etf_tickers:
        try:
            snap = client.get_single_ticker_snapshot(ticker)
            etfs[ticker] = _make_entry(snap) if snap else dict(_EMPTY)
        except Exception:
            etfs[ticker] = dict(_EMPTY)

    # Fetch all yfinance quotes in parallel so the extra calls don't serialize.
    jobs = list(fast_targets.items())

    def _fetch(job):
        lbl, yft = job
        return lbl, _yfinance_snapshot(yft)

    with _cf.ThreadPoolExecutor(max_workers=len(jobs), thread_name_prefix="snap-yf") as ex:
        yf_snaps = dict(ex.map(_fetch, jobs))

    etfs["VIX"] = _make_entry(yf_snaps["VIX"]) if yf_snaps.get("VIX") else dict(_EMPTY)
    # "futures" is now BTC only. The key name stays because MorningWireIndexes,
    # MarketStatusBar and FuturesStrip all read BTC from data.futures.BTC.
    futures = {"BTC": _make_entry(yf_snaps["BTC"]) if yf_snaps.get("BTC") else dict(_EMPTY)}

    data = {"futures": futures, "etfs": etfs}
    cache.set("snapshot", data, ttl=15)
    return data


def _fetch_finviz_movers_live() -> tuple[list, list]:
    """Fetch current session top % movers from Finviz Elite screener.

    Quality filters applied at URL level:
      sh_price_o5        = price > $5
      sh_avgvol_o300     = avg daily vol > 300K
      sh_mktcap_smallover= mktcap > $300M (small-cap and above)

    Returns (ripping, drilling) — lists of {"sym", "pct"} dicts, up to 12 each,
    with |change| >= 3%. Sorted by magnitude descending (Finviz sort order).
    """
    import csv
    import io

    token = os.environ.get("FINVIZ_API_KEY", "")
    if not token:
        return [], []

    _qf = "sh_price_o5,sh_avgvol_o300,sh_mktcap_smallover"
    _headers = {"User-Agent": "Mozilla/5.0", "Accept": "text/csv"}

    def _fetch_rows(order: str) -> list[dict]:
        url = (
            f"https://elite.finviz.com/export.ashx"
            f"?v=152&f={_qf}&o={order}&auth={token}"
        )
        try:
            r = httpx.get(url, headers=_headers, timeout=15.0)
            r.raise_for_status()
            reader = csv.DictReader(io.StringIO(r.text))
            return list(reader)
        except Exception:
            return []

    # Keyword check on Company name — instant, no yfinance calls needed.
    # Finviz CSV already includes the full company name in each row.
    _lev_kw = ("2x", "3x", "-2x", "-3x", "ultra pro", "ultrashort", "ultralong",
                "leveraged", "inverse", "daily bear", "daily bull",
                "direxion daily", "proshares ultra", "proshares short",
                "short bitcoin", "short ether", "2× long", "2× short")

    def _is_lev_by_name(row: dict) -> bool:
        name = (row.get("Company", "") + " " + row.get("Ticker", "")).lower()
        return any(kw in name for kw in _lev_kw)

    def _parse_pct(s: str) -> float:
        try:
            return float(s.replace("%", "").replace("+", "").strip())
        except (ValueError, AttributeError):
            return 0.0

    ripping:  list[dict] = []
    drilling: list[dict] = []

    for row in _fetch_rows("-change"):
        sym = row.get("Ticker", "").strip()
        pct = _parse_pct(row.get("Change", "0"))
        if not sym or pct < 3.0:
            break  # sorted descending; once below 3% all remaining are too
        if _is_lev_by_name(row):
            continue
        ripping.append({"sym": sym, "pct": f"+{pct:.2f}%"})
        if len(ripping) >= 12:
            break

    for row in _fetch_rows("change"):
        sym = row.get("Ticker", "").strip()
        pct = _parse_pct(row.get("Change", "0"))
        if not sym or pct > -3.0:
            break  # sorted ascending; once above -3% all remaining are too
        if _is_lev_by_name(row):
            continue
        drilling.append({"sym": sym, "pct": f"{pct:.2f}%"})
        if len(drilling) >= 12:
            break

    return ripping, drilling


def _build_movers_discovery() -> dict:
    """Run Finviz + wire_data discovery to get the quality-filtered mover list.

    Expensive (~1-2s). Result cached separately at 120s so the cheap Massive
    price-refresh path doesn't re-run Finviz on every 30s poll.

    Returns {"ripping": [...], "drilling": [...]} with Finviz % values.
    """
    wire = cache.get("wire_data")

    # wire_data movers — pre-market gappers from 7:35 AM engine run
    engine_ripping:  list = []
    engine_drilling: list = []
    if wire and wire.get("movers"):
        d = wire["movers"]
        engine_ripping  = d.get("rippers",  d.get("ripping",  []))
        engine_drilling = d.get("drillers", d.get("drilling", []))
        engine_ripping  = [m for m in engine_ripping  if not _is_leveraged_etf(m["sym"])]
        engine_drilling = [m for m in engine_drilling if not _is_leveraged_etf(m["sym"])]

    # Finviz Elite live screener — quality-filtered (price>$5, avgvol>300K, mktcap>$300M)
    fv_ripping, fv_drilling = _fetch_finviz_movers_live()

    engine_syms_rip = {m["sym"] for m in engine_ripping}
    engine_syms_drl = {m["sym"] for m in engine_drilling}

    _TARGET = 12

    def _abs_pct(m: dict) -> float:
        try:
            return abs(float(m["pct"].replace("%", "").replace("+", "")))
        except (KeyError, ValueError):
            return 0.0

    combined_rip = engine_ripping + [m for m in fv_ripping  if m["sym"] not in engine_syms_rip]
    combined_drl = engine_drilling + [m for m in fv_drilling if m["sym"] not in engine_syms_drl]

    ripping  = sorted(combined_rip[:_TARGET], key=_abs_pct, reverse=True)
    drilling = sorted(combined_drl[:_TARGET], key=_abs_pct, reverse=True)

    # cap_universe filter — removes stocks below $300M that gapped into range
    cap_uni = set(wire.get("cap_universe", []) if wire else [])
    if cap_uni:
        ripping  = [m for m in ripping  if m["sym"] in cap_uni]
        drilling = [m for m in drilling if m["sym"] in cap_uni]

    return {"ripping": ripping, "drilling": drilling}


def get_movers() -> dict:
    """Return live movers for the sidebar, refreshed every 30s.

    Two-layer cache:
      Layer 1 — discovery (120s TTL): Finviz Elite + wire_data determine *which*
        tickers qualify (quality-filtered, no micro-cap noise). Runs ~every 2 min.
      Layer 2 — price refresh (30s TTL): Massive batch snapshot updates the %
        change on the discovered tickers in real time. Runs every 30s.

    During regular session the displayed % reflects Massive's real-time price.
    Pre-market: Massive todaysChangePerc is often 0 (no regular-session trades yet)
    so Finviz values are kept as fallback when Massive returns < 0.5% absolute.

    Returns:
        {
          "ripping":  [{"sym": "TICK", "pct": "+34.40%"}, ...],
          "drilling": [{"sym": "TICK", "pct": "-50.55%"}, ...],
        }
    """
    cached = cache.get("movers")
    if cached is not None:
        return cached

    # ── Layer 1: discovery (expensive — Finviz HTTP, cached 120s) ─────────────
    discovery = cache.get("movers_discovery")
    if discovery is None:
        discovery = _build_movers_discovery()
        cache.set("movers_discovery", discovery, ttl=60)

    ripping  = list(discovery["ripping"])
    drilling = list(discovery["drilling"])

    # ── Layer 2: Massive real-time % overlay (cheap batch call) ───────────────
    all_syms = [m["sym"] for m in ripping + drilling]
    if all_syms:
        try:
            live = _get_client().get_batch_snapshots(all_syms)
        except Exception:
            live = {}

        def _apply_live(items: list, positive: bool) -> list:
            result = []
            for m in items:
                raw = live.get(m["sym"])
                # Only override when Massive has a meaningful value (>= 0.5% abs).
                # Pre-market: day.c == 0 so todaysChangePerc ≈ 0 — keep Finviz value.
                if raw is not None and abs(raw) >= 0.5:
                    sign = "+" if raw >= 0 else ""
                    result.append({**m, "pct": f"{sign}{raw:.2f}%"})
                else:
                    result.append(m)
            return result

        ripping  = _apply_live(ripping,  positive=True)
        drilling = _apply_live(drilling, positive=False)

    def _abs_pct(m: dict) -> float:
        try:
            return abs(float(m["pct"].replace("%", "").replace("+", "")))
        except (KeyError, ValueError):
            return 0.0

    # After Massive overlay, enforce live thresholds:
    # - ripping: must still be >= +3% and positive (faded movers drop off)
    # - drilling: must still be <= -3% and negative (recovered movers drop off)
    # This keeps the list reflecting who is actually moving RIGHT NOW.
    ripping  = [m for m in ripping  if _abs_pct(m) >= 3.0 and not m["pct"].startswith("-")]
    drilling = [m for m in drilling if _abs_pct(m) >= 3.0 and     m["pct"].startswith("-")]

    # Re-sort by magnitude so biggest movers stay at the top
    ripping  = sorted(ripping,  key=_abs_pct, reverse=True)
    drilling = sorted(drilling, key=_abs_pct, reverse=True)

    data = {"ripping": ripping, "drilling": drilling}
    cache.set("movers", data, ttl=30)
    return data
