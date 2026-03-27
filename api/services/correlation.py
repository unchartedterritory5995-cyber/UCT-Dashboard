"""Correlation matrix service for UCT20 leadership stocks.

Fetches daily bars from Massive API, computes Pearson correlation matrix
on daily returns, and flags high-correlation pairs (|r| > 0.8).
"""

from datetime import date, timedelta

import numpy as np

from api.services.cache import cache
from api.services.massive import get_agg_bars


def _get_default_tickers() -> list[str]:
    """Pull current UCT20 tickers from wire_data leadership list."""
    wire = cache.get("wire_data")
    if not wire or not wire.get("leadership"):
        return []
    tickers = []
    for item in wire["leadership"][:20]:
        sym = item.get("ticker") or item.get("sym") or item.get("symbol")
        if sym:
            tickers.append(sym.upper())
    return tickers


def compute_correlation_matrix(
    tickers: list[str] | None = None,
    period: int = 60,
) -> dict:
    """Build NxN Pearson correlation matrix from daily returns.

    Args:
        tickers: List of ticker symbols. Defaults to UCT20 leadership stocks.
        period:  Number of calendar days of history to fetch (default 60).

    Returns:
        {
          "tickers": ["AAPL", "MSFT", ...],
          "matrix": [[1.0, 0.87, ...], ...],
          "high_correlations": [{"pair": ["AAPL", "MSFT"], "correlation": 0.87}, ...]
        }
    """
    if tickers is None:
        tickers = _get_default_tickers()

    if not tickers:
        return {"tickers": [], "matrix": [], "high_correlations": []}

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for t in tickers:
        t_upper = t.upper()
        if t_upper not in seen:
            seen.add(t_upper)
            unique.append(t_upper)
    tickers = unique

    # Cache key based on sorted tickers + period
    cache_key = f"correlation_{'_'.join(sorted(tickers))}_{period}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Date range
    end = date.today()
    start = end - timedelta(days=period)
    from_str = start.isoformat()
    to_str = end.isoformat()

    # Fetch daily bars for each ticker
    # Build dict of {ticker: {unix_ms_date: close_price}}
    all_bars: dict[str, dict[int, float]] = {}
    valid_tickers: list[str] = []

    for ticker in tickers:
        bars = get_agg_bars(ticker, from_str, to_str)
        if len(bars) < 10:
            # Skip tickers without enough data
            continue
        price_map = {}
        for bar in bars:
            # Normalize timestamp to date-level (strip intraday)
            t_ms = bar.get("t", 0)
            price_map[t_ms] = bar.get("c", 0.0)
        all_bars[ticker] = price_map
        valid_tickers.append(ticker)

    if len(valid_tickers) < 2:
        result = {
            "tickers": valid_tickers,
            "matrix": [[1.0]] if valid_tickers else [],
            "high_correlations": [],
        }
        cache.set(cache_key, result, ttl=3600)
        return result

    # Find common trading dates across all tickers
    common_dates = set.intersection(*(set(bars.keys()) for bars in all_bars.values()))
    if len(common_dates) < 10:
        # Not enough overlapping data
        result = {"tickers": valid_tickers, "matrix": [], "high_correlations": []}
        cache.set(cache_key, result, ttl=3600)
        return result

    sorted_dates = sorted(common_dates)

    # Build price matrix: rows = tickers, cols = dates
    price_matrix = np.array(
        [[all_bars[ticker][d] for d in sorted_dates] for ticker in valid_tickers]
    )

    # Compute daily returns (% change day over day)
    # returns shape: (n_tickers, n_days - 1)
    returns = np.diff(price_matrix, axis=1) / price_matrix[:, :-1]

    # Replace any inf/nan with 0 (e.g. if a price was 0)
    returns = np.nan_to_num(returns, nan=0.0, posinf=0.0, neginf=0.0)

    # Pearson correlation matrix
    n = len(valid_tickers)
    corr = np.corrcoef(returns)

    # Replace any NaN correlations with 0 (happens if a ticker has zero variance)
    corr = np.nan_to_num(corr, nan=0.0)

    # Round to 2 decimal places
    matrix = [[round(float(corr[i][j]), 2) for j in range(n)] for i in range(n)]

    # Find high-correlation pairs (|r| > 0.8, excluding diagonal)
    high_correlations = []
    for i in range(n):
        for j in range(i + 1, n):
            r = corr[i][j]
            if abs(r) > 0.8:
                high_correlations.append({
                    "pair": [valid_tickers[i], valid_tickers[j]],
                    "correlation": round(float(r), 2),
                })

    # Sort by absolute correlation descending
    high_correlations.sort(key=lambda x: abs(x["correlation"]), reverse=True)

    result = {
        "tickers": valid_tickers,
        "matrix": matrix,
        "high_correlations": high_correlations,
    }

    cache.set(cache_key, result, ttl=3600)  # 1 hour cache
    return result
