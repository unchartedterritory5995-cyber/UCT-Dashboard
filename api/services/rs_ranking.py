"""IBD-style Relative Strength (RS) ranking system.

Computes weighted price performance for a universe of stocks and ranks them
on a 1-99 percentile scale. Uses Massive API for 6-month daily bars.

RS Score formula (IBD-inspired weighted returns):
  40% × 3-month return
  20% × 6-month return
  20% × 1-month return
  20% × 1-week return

Cached for 1 hour (3600s). Universe: cap_universe from wire_data ($300M+).
"""

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

from api.services.cache import cache
from api.services.massive import get_agg_bars

logger = logging.getLogger(__name__)

_CACHE_KEY = "rs_rankings"
_CACHE_TTL = 3600  # 1 hour


def _get_universe() -> list[str]:
    """Return the stock universe for RS ranking.

    Uses cap_universe from wire_data ($300M+ market cap stocks pushed by
    the morning wire engine). Falls back to leadership list if unavailable.
    """
    wire = cache.get("wire_data")
    if not wire:
        return []

    # cap_universe is a sorted list of ~500+ tickers with $300M+ market cap
    universe = list(wire.get("cap_universe", []))

    # Always include UCT20 leadership stocks even if cap_universe is missing
    leadership = wire.get("leadership", [])
    if isinstance(leadership, list):
        lead_tickers = set()
        for item in leadership[:20]:
            sym = item.get("ticker") or item.get("sym") or item.get("symbol")
            if sym:
                lead_tickers.add(sym.upper())
        # Prepend leadership tickers if not already in universe
        uni_set = set(universe)
        for t in lead_tickers:
            if t not in uni_set:
                universe.append(t)

    return universe


def _compute_returns(ticker: str) -> dict | None:
    """Fetch 6 months of daily bars and compute weighted returns.

    Returns dict with ticker, rs_score, and period returns, or None on failure.
    """
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    from_date = (datetime.utcnow() - timedelta(days=200)).strftime("%Y-%m-%d")

    bars = get_agg_bars(ticker, from_date, to_date)
    if not bars or len(bars) < 10:
        return None

    closes = [b["c"] for b in bars]
    current = closes[-1]
    if current <= 0:
        return None

    def _pct(n_bars: int) -> float | None:
        """Return % return over last n trading bars."""
        if len(closes) < n_bars + 1:
            return None
        ref = closes[-(n_bars + 1)]
        if ref <= 0:
            return None
        return (current - ref) / ref * 100

    ret_1w = _pct(5)      # ~1 week
    ret_1m = _pct(21)     # ~1 month
    ret_3m = _pct(63)     # ~3 months
    ret_6m = _pct(126)    # ~6 months

    # Need at least 3m return to compute a meaningful score
    if ret_3m is None:
        return None

    # Weighted score: 40% 3M + 20% 6M + 20% 1M + 20% 1W
    # Use 0 for any missing shorter periods
    w_3m = ret_3m * 0.40
    w_6m = (ret_6m if ret_6m is not None else ret_3m) * 0.20
    w_1m = (ret_1m if ret_1m is not None else 0) * 0.20
    w_1w = (ret_1w if ret_1w is not None else 0) * 0.20
    raw_score = w_3m + w_6m + w_1m + w_1w

    return {
        "ticker": ticker,
        "raw_score": raw_score,
        "returns": {
            "1w": round(ret_1w, 2) if ret_1w is not None else None,
            "1m": round(ret_1m, 2) if ret_1m is not None else None,
            "3m": round(ret_3m, 2) if ret_3m is not None else None,
            "6m": round(ret_6m, 2) if ret_6m is not None else None,
        },
    }


def compute_rs_scores() -> list[dict]:
    """Compute RS scores and percentile ranks for the full universe.

    Returns list of {ticker, rs_score, rs_rank, returns: {1w, 1m, 3m, 6m}}
    sorted by rs_rank descending (best first).

    Results cached for 1 hour.
    """
    cached = cache.get(_CACHE_KEY)
    if cached is not None:
        return cached

    universe = _get_universe()
    if not universe:
        logger.warning("[rs_ranking] No universe available — wire_data may not be loaded")
        return []

    logger.info(f"[rs_ranking] Computing RS scores for {len(universe)} stocks...")

    # Fetch bars and compute returns in parallel
    results = []
    max_workers = min(len(universe), 12)  # Conservative for Railway

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_compute_returns, t): t for t in universe}
        for future in as_completed(futures):
            try:
                result = future.result()
                if result is not None:
                    results.append(result)
            except Exception:
                pass

    if not results:
        logger.warning("[rs_ranking] No valid results computed")
        return []

    # Sort by raw_score to assign percentile ranks
    results.sort(key=lambda x: x["raw_score"])
    n = len(results)

    ranked = []
    for i, item in enumerate(results):
        # Percentile rank: 1-99 scale
        percentile = max(1, min(99, round((i / max(n - 1, 1)) * 98 + 1)))
        ranked.append({
            "ticker": item["ticker"],
            "rs_score": round(item["raw_score"], 2),
            "rs_rank": percentile,
            "returns": item["returns"],
        })

    # Sort descending by rank (best RS first)
    ranked.sort(key=lambda x: x["rs_rank"], reverse=True)

    cache.set(_CACHE_KEY, ranked, ttl=_CACHE_TTL)
    logger.info(f"[rs_ranking] Cached {len(ranked)} RS rankings")
    return ranked


def get_rs_for_ticker(ticker: str) -> dict | None:
    """Return RS data for a single ticker from cached rankings."""
    rankings = compute_rs_scores()
    ticker_up = ticker.upper()
    for item in rankings:
        if item["ticker"] == ticker_up:
            return item
    return None
