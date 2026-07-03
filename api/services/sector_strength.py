"""Sector strength via SPDR sector-ETF relative performance.

Computes real period returns for the 11 SPDR Select Sector ETFs from daily
bars (mirrors the existing rs_ranking.py pattern of fetching Massive daily
aggs and diffing closes; also matches the "Sector Flow" data source already
documented in CLAUDE.md — Massive API bars for 11 SPDR ETFs, 15min cache —
which had never actually been wired up).

No theme-tracker fallback anywhere in this module: if sector-ETF bars can't
be fetched, callers get an honest empty result, never mislabeled theme data.
"""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

from api.services.cache import cache

logger = logging.getLogger(__name__)

_CACHE_TTL = 900  # 15 min

# Bounded fetch pool for the 11-ETF batch (mirrors rs_ranking's conservative
# ThreadPoolExecutor sizing for Railway). Worst case wall time drops from
# ~11 sequential upstream calls to ~ceil(11/6) rounds.
_MAX_FETCH_WORKERS = 6

# Single-flight guard for the cache-miss path (herd-collapse pattern, cf.
# live_prices.py's Semaphore + re-check valve): N concurrent cold callers
# must not fan out N×11 upstream fetches on the single-process web pod.
_COMPUTE_LOCK = threading.Lock()

SECTOR_ETFS: dict[str, str] = {
    "Technology": "XLK",
    "Financials": "XLF",
    "Energy": "XLE",
    "Healthcare": "XLV",
    "Industrials": "XLI",
    "Consumer Discretionary": "XLY",
    "Consumer Staples": "XLP",
    "Materials": "XLB",
    "Real Estate": "XLRE",
    "Utilities": "XLU",
    "Communication Services": "XLC",
}

# Canonical period string (see voice_market_tools._norm_period) -> trading-day
# lookback in bars. "Today" = 1-bar (prior close -> latest close) snapshot.
PERIOD_TO_BARS: dict[str, int] = {
    "Today": 1,
    "1W": 5,
    "1M": 21,
    "3M": 63,
}
DEFAULT_PERIOD = "Today"


def _fetch_sector_bars(ticker: str, n_bars: int) -> list[dict]:
    """Live daily bars for one sector ETF — enough calendar days to cover
    n_bars trading days plus a buffer for weekends/holidays."""
    from api.services.massive import get_agg_bars

    calendar_days = max(20, int(n_bars * 1.7) + 15)
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    from_date = (datetime.utcnow() - timedelta(days=calendar_days)).strftime("%Y-%m-%d")
    return get_agg_bars(ticker, from_date, to_date)


def compute_sector_returns(n_bars: int, *, bars_fetcher=None) -> list[dict]:
    """Compute period % return for each SPDR sector ETF, ranked strongest-first.

    `bars_fetcher(ticker, n_bars) -> list[{'c': close, ...}]` is injectable for
    tests (defaults to a live Massive fetch). Never raises: a sector whose
    bars can't be fetched or don't cover the lookback window is silently
    dropped from the ranking rather than faked. Returns [] if every sector
    fails — the caller (voice_market_tools) must treat that as "unavailable",
    not substitute unrelated data.
    """
    fetcher = bars_fetcher or _fetch_sector_bars

    def _one(name: str, ticker: str) -> dict | None:
        bars = fetcher(ticker, n_bars)  # exceptions handled at future.result()
        if not bars or len(bars) < n_bars + 1:
            return None
        closes = [b.get("c") for b in bars]
        current = closes[-1]
        ref = closes[-(n_bars + 1)]
        if not current or not ref or current <= 0 or ref <= 0:
            return None
        change_pct = (current - ref) / ref * 100
        return {"sector": name, "ticker": ticker, "change_pct": round(change_pct, 2)}

    # Parallel fetch across the 11 ETFs (bounded pool, mirrors
    # rs_ranking.compute_rs_scores). Per-ETF failure isolation: one raising
    # ticker is logged + dropped, never kills the batch.
    items = list(SECTOR_ETFS.items())
    out: list[dict] = []
    max_workers = min(len(items), _MAX_FETCH_WORKERS) or 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_one, name, ticker): ticker
                   for name, ticker in items}
        for future in as_completed(futures):
            try:
                row = future.result()
            except Exception:
                logger.exception("[sector_strength] bars fetch failed for %s",
                                 futures[future])
                continue
            if row is not None:
                out.append(row)

    out.sort(key=lambda r: r["change_pct"], reverse=True)
    return out


def get_sector_strength(period: str = DEFAULT_PERIOD) -> list[dict]:
    """Cached sector-return ranking for a canonical period
    ('Today' / '1W' / '1M' / '3M').

    Returns [] when data is unavailable — never falls back to theme (or any
    other unrelated) data. Empty results are not cached so a transient outage
    self-heals on the next call instead of freezing "unavailable" for 15 min.
    """
    n_bars = PERIOD_TO_BARS.get(period, PERIOD_TO_BARS[DEFAULT_PERIOD])
    cache_key = f"sector_strength_{n_bars}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    # Single-flight: check -> acquire -> re-check -> compute -> set. On a cold
    # cache, N racing callers produce exactly ONE upstream compute; the rest
    # wait briefly and serve the freshly cached result (524-shape hardening —
    # never fan out N×11 Massive calls from the shared anyio threadpool).
    with _COMPUTE_LOCK:
        cached = cache.get(cache_key)
        if cached is not None:
            return cached
        rows = compute_sector_returns(n_bars)
        if rows:
            cache.set(cache_key, rows, ttl=_CACHE_TTL)
        return rows
