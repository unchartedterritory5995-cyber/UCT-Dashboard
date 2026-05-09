"""Per-ticker volume baseline for the low-volume validation gate.

A QQQ bar with V=56 is implausibly low; for a thin small-cap a V=56 bar may
be normal. This module computes a per-ticker median-volume baseline so the
validation low-volume threshold can scale appropriately.

Used by Task 7 (validation enrichment) and downstream by audit + cache write
paths via bar_validation.validate_bar(low_volume_threshold=...).
"""
from statistics import median

_DEFAULT_THRESHOLD = 1000
_FRACTION_OF_MEDIAN = 0.01  # 1% of median = "implausibly low"


def compute_low_volume_threshold(bars: list, tf: str) -> int:
    """Return the volume threshold below which a bar is suspicious for THIS ticker.

    Inputs:
        bars: list of bar dicts (from cache or fresh fetch). Sentinels/non-dicts skipped.
        tf: timeframe string (currently unused — reserved for future scaling).

    Returns:
        int threshold. _DEFAULT_THRESHOLD (1000) when no positive-volume history found.
    """
    if not bars:
        return _DEFAULT_THRESHOLD
    volumes = [
        b.get("v", 0) for b in bars
        if isinstance(b, dict) and isinstance(b.get("v"), (int, float)) and b.get("v", 0) > 0
    ]
    if not volumes:
        return _DEFAULT_THRESHOLD
    med = median(volumes)
    threshold = max(1, int(med * _FRACTION_OF_MEDIAN))
    return threshold
