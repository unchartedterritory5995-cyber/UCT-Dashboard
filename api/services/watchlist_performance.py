"""
Watchlist performance — batch multi-period returns for ticker lists.
Reuses _compute_returns pattern from theme_performance.py.
"""

import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

_logger = logging.getLogger(__name__)

from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.massive import get_agg_bars
from api.services.theme_performance import _compute_returns_with_refs

_MAX_WORKERS = 2  # Conservative for Railway 512MB — prevents thread explosion
_CACHE_TTL = 300  # 5 minutes
_CACHE_TTL_PARTIAL = 30  # any per-ticker fetch failure in the batch — retry in 30s, not 5 min

# Periods for which we surface the REFERENCE close price so the client can recompute
# the % against a live intraday price, tick-by-tick (like the daily change column).
_REF_PERIODS = ("5d", "30d", "60d", "90d")


def _fetch_ticker_returns(ticker: str) -> dict:
    to_date = date.today().isoformat()
    from_date = (date.today() - timedelta(days=400)).isoformat()
    bars = get_agg_bars(ticker, from_date, to_date)
    r, refs = _compute_returns_with_refs(bars)
    out = {k: r.get(k) for k in ("1d", "1w", "1m", "3m", "ytd", "5d", "30d", "60d", "90d")}
    # Reference closes for the N-day columns → client recomputes % vs the live price.
    out["refs"] = {k: refs.get(k) for k in _REF_PERIODS}
    return out


def get_batch_returns(tickers: list[str]) -> dict:
    """Compute 1d/1w/1m/3m/ytd + 5d/30d/60d/90d returns for a batch of tickers.

    Returns:
        {ticker: {1d, 1w, 1m, 3m, ytd, 5d, 30d, 60d, 90d}} dict
    """
    deduped = sorted(set(t.upper() for t in tickers))
    if not deduped:
        return {}
    cache_key = "wl_perf:" + hashlib.md5(",".join(deduped).encode()).hexdigest()
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    results = {}
    any_failed = False
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = {pool.submit(_fetch_ticker_returns, t): t for t in deduped}
        for future in futures:
            ticker = futures[future]
            try:
                results[ticker] = future.result(timeout=15)
            except Exception as e:
                _logger.warning("Failed to fetch returns for %s: %s", ticker, e)
                any_failed = True
                results[ticker] = {"1d": None, "1w": None, "1m": None, "3m": None, "ytd": None,
                                   "5d": None, "30d": None, "60d": None, "90d": None,
                                   "refs": {k: None for k in _REF_PERIODS}}

    # A per-ticker failure writes an all-None row into the SAME batch dict
    # that healthy tickers share — caching the whole batch at the full 5-min
    # TTL pinned that failed ticker's row blank for 5 min even though its
    # peers in the same request succeeded. `any_failed` tracks whether every
    # future in this batch actually completed.
    set_by_completeness(cache_key, results, complete=not any_failed,
                         ttl_ok=_CACHE_TTL, ttl_partial=_CACHE_TTL_PARTIAL)
    return results
