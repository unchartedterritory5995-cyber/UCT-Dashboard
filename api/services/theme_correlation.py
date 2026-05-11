"""api/services/theme_correlation.py

Computes a pairwise Pearson correlation matrix for the top N theme ETFs
using 60 days of daily close prices.

Result is cached in-memory for 1 hour (TTLCache) and computed synchronously
on first request (no background thread needed — runs once per hour).
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np

from api.services.cache import cache

_logger = logging.getLogger(__name__)
_CACHE_TTL = 3600  # 1 hour

# Path to themes_taxonomy.json (repo root, also accessible from Railway /app)
_TAXONOMY_PATHS = [
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "themes_taxonomy.json"),
    "/app/themes_taxonomy.json",
    "themes_taxonomy.json",
]


def _load_taxonomy() -> list[dict]:
    """Load themes_taxonomy.json from disk. Returns list of theme dicts."""
    for path in _TAXONOMY_PATHS:
        try:
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                return data.get("themes", [])
        except Exception:
            continue
    return []


def _get_etf_list(n: int) -> list[dict]:
    """Return up to n theme ETFs as [{"ticker": ..., "name": ...}] dicts.

    Filters to themes that have a real ETF ticker (not None/empty).
    Preserves taxonomy display_order so correlation uses the most prominent themes first.
    """
    themes = _load_taxonomy()
    result = []
    seen = set()
    for theme in themes:
        etf = theme.get("etf_ticker")
        if not etf or not isinstance(etf, str) or etf.strip().lower() in ("", "none", "null"):
            continue
        etf = etf.strip().upper()
        if etf in seen:
            continue
        seen.add(etf)
        result.append({"ticker": etf, "name": theme.get("name", etf)})
        if len(result) >= n:
            break
    return result


def _fetch_daily_closes(ticker: str, lookback: int) -> Optional[list[tuple[int, float]]]:
    """Fetch daily close prices for a ticker.

    Tries (in order):
      1. SQLite bar store (primary, per Plan 5 hot-tier architecture)
      2. Legacy disk bars cache at /data/bars_cache/{ticker}_D_{N}.json
      3. Massive REST API via get_agg_bars()

    Returns list of (timestamp, close) sorted ascending, or None on failure.
    Timestamp is whatever the source provides (int for SQLite, may be str for
    disk cache — caller treats opaquely for inner-join only).
    """
    # 1. Primary: SQLite bar store
    try:
        from api.services import bars_sqlite as _sqlite
        rows = _sqlite.get_bars(ticker.upper(), "D", lookback + 10)
        if rows and len(rows) >= max(10, lookback // 2):
            # rows are (ts, o, h, l, c, v) tuples
            pairs = [(r[0], r[4]) for r in rows if r[0] and r[4]]
            if len(pairs) >= max(10, lookback // 2):
                return pairs[-(lookback + 5):]
    except Exception as e:
        _logger.debug("theme_correlation: sqlite read failed for %s: %s", ticker, e)

    # 2. Legacy disk cache (kept for resilience)
    try:
        from api.services import bars_disk_cache as disk_cache
        for bar_count in (5000, 500, 1000, 8000):
            try:
                cached = disk_cache.get(ticker, "D", bar_count)
                if cached and cached.get("bars"):
                    bars = cached["bars"]
                    pairs = [(b["t"], b["c"]) for b in bars if b.get("t") and b.get("c")]
                    if len(pairs) >= lookback:
                        return pairs[-(lookback + 5):]
            except Exception:
                pass
    except Exception:
        pass

    # 3. Fallback: Massive REST API
    try:
        from api.services.massive import get_agg_bars
        to_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        from_dt = datetime.now(timezone.utc) - timedelta(days=lookback + 20)
        from_date = from_dt.strftime("%Y-%m-%d")
        bars = get_agg_bars(ticker, from_date, to_date)
        if bars:
            pairs = [(b["t"], b["c"]) for b in bars if b.get("t") and b.get("c")]
            if len(pairs) >= max(10, lookback // 2):
                return pairs
    except Exception as e:
        _logger.debug("theme_correlation: massive REST failed for %s: %s", ticker, e)

    return None


def _compute(n: int, lookback: int, cache_key: str) -> Optional[dict]:
    """Do the actual correlation computation."""
    etf_list = _get_etf_list(n)
    if len(etf_list) < 2:
        _logger.warning("theme_correlation: not enough ETFs in taxonomy (%d)", len(etf_list))
        return None

    # Fetch closes for every ETF
    closes_map: dict[str, dict[int, float]] = {}
    for item in etf_list:
        pairs = _fetch_daily_closes(item["ticker"], lookback + 10)
        if pairs and len(pairs) >= max(10, lookback // 2):
            closes_map[item["ticker"]] = {t: c for t, c in pairs}
        else:
            _logger.debug("theme_correlation: skipping %s — insufficient data", item["ticker"])

    # Keep only ETFs that had data
    valid_etfs = [item for item in etf_list if item["ticker"] in closes_map]
    if len(valid_etfs) < 2:
        _logger.warning("theme_correlation: fewer than 2 ETFs had data")
        return None

    # Inner-join timestamps: only use dates present for ALL ETFs
    timestamp_sets = [set(closes_map[item["ticker"]].keys()) for item in valid_etfs]
    common_ts = sorted(set.intersection(*timestamp_sets))

    # Use the most recent `lookback` common timestamps
    if len(common_ts) < 10:
        _logger.warning("theme_correlation: only %d common timestamps across ETFs", len(common_ts))
        return None

    common_ts = common_ts[-lookback:]

    # Build matrix rows [n_etfs x n_dates]
    price_matrix = np.array([
        [closes_map[item["ticker"]][t] for t in common_ts]
        for item in valid_etfs
    ], dtype=np.float64)

    # Compute pairwise Pearson correlation
    corr = np.corrcoef(price_matrix)

    # Handle NaN (degenerate series with zero variance)
    corr = np.nan_to_num(corr, nan=0.0)

    labels = [item["ticker"] for item in valid_etfs]
    names  = [item["name"]   for item in valid_etfs]
    matrix = [[round(float(v), 4) for v in row] for row in corr]

    result = {
        "labels": labels,
        "names":  names,
        "matrix": matrix,
        "n_dates": len(common_ts),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    cache.set(cache_key, result, ttl=_CACHE_TTL)
    return result


def get_theme_correlation(n: int = 40, lookback: int = 60) -> Optional[dict]:
    """Return correlation matrix for top N theme ETFs.

    Result shape:
      {
        "labels":       ["XLK", "ARKK", ...],
        "names":        ["Semis", "Disruptive Tech", ...],
        "matrix":       [[1.0, 0.7, ...], ...],   # n×n Pearson correlation
        "n_dates":      60,                        # actual trading days used
        "generated_at": "2026-05-04T...",
      }

    Returns None on failure.
    """
    cache_key = f"theme_correlation_{n}_{lookback}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        return _compute(n, lookback, cache_key)
    except Exception as e:
        _logger.warning("theme_correlation failed: %s", e, exc_info=True)
        return None
