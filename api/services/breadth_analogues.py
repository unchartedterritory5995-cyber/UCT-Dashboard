"""api/services/breadth_analogues.py

Historical breadth pattern matching ("analogues").
Finds past dates where market breadth looked most similar to today,
then reports what SPY did in the following 5/10/20/60 trading days.

Uses the same breadth_monitor.db as the main breadth service.
"""

import json
import math
import time
from typing import Optional

from api.services.breadth_monitor import _conn, get_history


# ── Cache ──────────────────────────────────────────────────────────────────────

_cache: dict = {"ts": 0, "data": None}
_CACHE_TTL = 6 * 3600  # 6 hours


# ── Metrics used for similarity comparison ─────────────────────────────────────
# These are the key breadth metrics that characterize market regime.
# Each tuple: (metric_key, weight)
# Higher weight = more important in the similarity calculation.

ANALOGUE_METRICS = [
    ("breadth_score",      3.0),
    ("uct_exposure",       2.5),
    ("pct_above_50sma",    2.0),
    ("pct_above_200sma",   2.0),
    ("pct_above_20ema",    1.5),
    ("ratio_5day",         1.5),
    ("ratio_10day",        1.0),
    ("vix",                2.0),
    ("mcclellan_osc",      1.5),
    ("cnn_fear_greed",     1.0),
    ("aaii_spread",        1.0),
    ("cboe_putcall",       1.0),
    ("new_52w_highs",      1.0),
    ("new_52w_lows",       1.0),
    ("hi_ratio",           1.0),
    ("stage2_count",       1.0),
]


def _get_all_snapshots(lookback_days: int = 500) -> list[dict]:
    """Fetch up to lookback_days of breadth snapshots, newest first."""
    return get_history(lookback_days)


def _extract_vector(row: dict) -> Optional[list[float]]:
    """Extract the analogue feature vector from a breadth row.
    Returns None if too many key metrics are missing."""
    vals = []
    missing = 0
    for key, _weight in ANALOGUE_METRICS:
        v = row.get(key)
        if v is None:
            missing += 1
            vals.append(None)
        else:
            vals.append(float(v))
    # Require at least 60% of metrics present
    if missing > len(ANALOGUE_METRICS) * 0.4:
        return None
    return vals


def _compute_stats(rows: list[dict]) -> tuple[dict, dict]:
    """Compute mean and std for each metric across all rows (for normalization)."""
    sums = {}
    sq_sums = {}
    counts = {}
    for row in rows:
        for key, _ in ANALOGUE_METRICS:
            v = row.get(key)
            if v is not None:
                fv = float(v)
                sums[key] = sums.get(key, 0.0) + fv
                sq_sums[key] = sq_sums.get(key, 0.0) + fv * fv
                counts[key] = counts.get(key, 0) + 1

    means = {}
    stds = {}
    for key, _ in ANALOGUE_METRICS:
        n = counts.get(key, 0)
        if n < 2:
            means[key] = 0.0
            stds[key] = 1.0  # avoid division by zero
        else:
            mu = sums[key] / n
            var = (sq_sums[key] / n) - (mu * mu)
            means[key] = mu
            stds[key] = max(math.sqrt(max(var, 0)), 0.01)  # floor at 0.01

    return means, stds


def _normalized_distance(vec_a: list, vec_b: list, means: dict, stds: dict) -> float:
    """Weighted normalized euclidean distance between two feature vectors."""
    total = 0.0
    weight_sum = 0.0
    for i, (key, weight) in enumerate(ANALOGUE_METRICS):
        a = vec_a[i]
        b = vec_b[i]
        if a is None or b is None:
            continue
        # Z-score normalize
        std = stds.get(key, 1.0)
        norm_a = (a - means.get(key, 0)) / std
        norm_b = (b - means.get(key, 0)) / std
        diff = norm_a - norm_b
        total += weight * (diff * diff)
        weight_sum += weight

    if weight_sum == 0:
        return float("inf")
    return math.sqrt(total / weight_sum)


def _compute_forward_returns(rows_asc: list[dict], idx: int) -> dict:
    """Compute SPY forward returns from a given index in the ascending-ordered list.
    Returns dict with keys like 'fwd_5d', 'fwd_10d', etc."""
    base_close = rows_asc[idx].get("sp500_close")
    if base_close is None or base_close == 0:
        return {}

    result = {}
    for label, offset in [("fwd_5d", 5), ("fwd_10d", 10), ("fwd_20d", 20), ("fwd_60d", 60)]:
        target_idx = idx + offset
        if target_idx < len(rows_asc):
            future_close = rows_asc[target_idx].get("sp500_close")
            if future_close is not None:
                result[label] = round((future_close - base_close) / base_close * 100, 2)
    return result


def _build_metrics_summary(row: dict) -> dict:
    """Extract key metrics for display in the analogue card."""
    keys_to_show = [
        "breadth_score", "uct_exposure", "pct_above_50sma", "pct_above_200sma",
        "vix", "mcclellan_osc", "ratio_5day", "new_52w_highs", "new_52w_lows",
        "cnn_fear_greed", "aaii_spread", "sp500_close",
    ]
    return {k: row.get(k) for k in keys_to_show if row.get(k) is not None}


def find_analogues(
    current_snapshot: Optional[dict] = None,
    lookback_days: int = 500,
    top_n: int = 5,
    min_gap_days: int = 10,
) -> dict:
    """Find the top_n most similar historical breadth dates.

    Args:
        current_snapshot: Override for 'today' snapshot. If None, uses latest row.
        lookback_days: How many trading days of history to search.
        top_n: Number of analogues to return.
        min_gap_days: Minimum trading days between analogue matches (avoid clustering).

    Returns:
        dict with 'reference_date', 'analogues' list, and 'reference_metrics'.
    """
    # Check cache
    now = time.time()
    if _cache["data"] is not None and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["data"]

    rows = _get_all_snapshots(lookback_days)
    if len(rows) < 20:
        return {"reference_date": None, "analogues": [], "reference_metrics": {}}

    # rows is newest-first; reverse for chronological order
    rows_asc = list(reversed(rows))

    # Current snapshot = most recent (last element of ascending list)
    if current_snapshot is None:
        current_snapshot = rows_asc[-1]

    current_vec = _extract_vector(current_snapshot)
    if current_vec is None:
        return {"reference_date": current_snapshot.get("date"), "analogues": [], "reference_metrics": {}}

    # Compute normalization stats across all rows
    means, stds = _compute_stats(rows_asc)

    # Build date → index map for forward return lookup
    date_to_idx = {r["date"]: i for i, r in enumerate(rows_asc)}

    # Score each historical date (exclude last 5 trading days — too recent to be a useful analogue)
    candidates = []
    for i, row in enumerate(rows_asc[:-5]):
        vec = _extract_vector(row)
        if vec is None:
            continue
        dist = _normalized_distance(current_vec, vec, means, stds)
        candidates.append((dist, i, row))

    # Sort by distance (lower = more similar)
    candidates.sort(key=lambda x: x[0])

    # Pick top_n with minimum gap between matches
    selected = []
    used_indices = set()
    for dist, idx, row in candidates:
        if len(selected) >= top_n:
            break
        # Check gap from already-selected indices
        too_close = False
        for used_idx in used_indices:
            if abs(idx - used_idx) < min_gap_days:
                too_close = True
                break
        if too_close:
            continue

        used_indices.add(idx)

        # Similarity score: convert distance to a 0-100% similarity
        # Using exponential decay: sim = 100 * exp(-dist)
        similarity = round(100 * math.exp(-dist), 1)

        forward = _compute_forward_returns(rows_asc, idx)

        selected.append({
            "date": row["date"],
            "similarity": similarity,
            "distance": round(dist, 3),
            "metrics_then": _build_metrics_summary(row),
            "forward_returns": forward,
        })

    result = {
        "reference_date": current_snapshot.get("date"),
        "reference_metrics": _build_metrics_summary(current_snapshot),
        "analogues": selected,
    }

    # Cache result
    _cache["ts"] = now
    _cache["data"] = result

    return result


def invalidate_cache():
    """Clear the analogues cache (e.g. after new breadth push)."""
    _cache["ts"] = 0
    _cache["data"] = None
