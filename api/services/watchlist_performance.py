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
from api.services.massive import get_agg_bars
from api.services.theme_performance import _compute_returns

_MAX_WORKERS = 2  # Conservative for Railway 512MB — prevents thread explosion
_CACHE_TTL = 300  # 5 minutes


def _fetch_ticker_returns(ticker: str) -> dict:
    to_date = date.today().isoformat()
    from_date = (date.today() - timedelta(days=400)).isoformat()
    bars = get_agg_bars(ticker, from_date, to_date)
    r = _compute_returns(bars)
    return {k: r.get(k) for k in ("1d", "1w", "1m", "3m", "ytd")}


def get_batch_returns(tickers: list[str]) -> dict:
    """Compute 1d/1w/1m/3m/ytd returns for a batch of tickers.

    Returns:
        {ticker: {1d, 1w, 1m, 3m, ytd}} dict
    """
    deduped = sorted(set(t.upper() for t in tickers))
    if not deduped:
        return {}
    cache_key = "wl_perf:" + hashlib.md5(",".join(deduped).encode()).hexdigest()
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    results = {}
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = {pool.submit(_fetch_ticker_returns, t): t for t in deduped}
        for future in futures:
            ticker = futures[future]
            try:
                results[ticker] = future.result(timeout=15)
            except Exception as e:
                _logger.warning("Failed to fetch returns for %s: %s", ticker, e)
                results[ticker] = {"1d": None, "1w": None, "1m": None, "3m": None, "ytd": None}

    cache.set(cache_key, results, _CACHE_TTL)
    return results
