"""Aggregate 1-minute bars into multi-minute timeframes.

Polygon/Massive AM events deliver 1-minute OHLCV bars. For each multi-minute
chart we accumulate consecutive 1-min bars in the same bucket and emit when the
bucket closes. Pure functions only — IO and state live in bar_broadcaster.

5/15/30 use UTC-floored buckets (cheap, no DST concerns, matches the
historical session resample which never had to ET-anchor sub-hourly windows).
60-min uses the canonical ET-anchored bucket from bars_fetch — that function is
the single source of truth for hourly bucket alignment, shared with the REST
resample path so the two NEVER drift (the equivalence is by construction).
"""
from typing import Optional

# Supported intraday timeframes that roll up from 1-min bars.
# D/W are not in this list — those use end-of-day data via the existing prewarmer/SQLite path.
TF_TO_SECONDS = {
    "1":  60,
    "5":  300,
    "15": 900,
    "30": 1800,
    "60": 3600,
}


def bucket_start(ts_ms: int, tf: str) -> int:
    """Return the start-of-bucket timestamp (ms) that contains ts_ms for the given tf.

    For tf=60: delegates to the canonical ET-anchored bucket function so the
    REST resample path and this WS rollup path produce bit-identical
    timestamps. Anything else here (UTC floor) would drift across DST or the
    9:30 RTH-open anchor and plant duplicate candles in SQLite at neighboring
    ``ts`` values — the exact failure shape of the FMP timezone bug.

    Raises ValueError if tf is not one of TF_TO_SECONDS keys.
    """
    if tf not in TF_TO_SECONDS:
        raise ValueError(f"Unsupported timeframe for rollup: {tf!r}")
    if tf == "60":
        # Single source of truth — import lazily to keep this module's tiny
        # import graph clean and avoid any future circular-dep risk.
        from api.services.bars_fetch import bucket_60_et_unix_seconds
        return bucket_60_et_unix_seconds(ts_ms // 1000) * 1000
    sec = TF_TO_SECONDS[tf]
    bucket_sec = (ts_ms // 1000) // sec * sec
    return bucket_sec * 1000


def aggregate(prev: Optional[dict], bar: dict) -> dict:
    """Merge a new 1-min bar into the partial bucket bar.

    `prev` is the in-progress bar for this bucket, or None if this is the first bar.
    `bar` is a single 1-min bar with keys: t (ms), o, h, l, c, v.
    Returns a fresh dict (no mutation of `prev` or `bar`, no aliasing).

    CONTRACT: caller MUST verify `bar` belongs to the same bucket as `prev`
    before calling — this function does NOT validate bucket alignment, and
    mixing buckets silently produces a corrupted bar (sums volume across
    bucket boundaries, keeps wrong `t`). The canonical caller is
    `bar_broadcaster.BarBroadcaster.push_minute_bar`, which uses
    `bucket_start(bar["t"], tf)` to detect bucket transitions and resets
    `prev=None` at boundaries.
    """
    if prev is None:
        return {
            "t": bar["t"],   # bucket start (caller computes via bucket_start before first call)
            "o": bar["o"],
            "h": bar["h"],
            "l": bar["l"],
            "c": bar["c"],
            "v": bar["v"],
        }
    return {
        "t": prev["t"],
        "o": prev["o"],
        "h": max(prev["h"], bar["h"]),
        "l": min(prev["l"], bar["l"]),
        "c": bar["c"],
        "v": prev["v"] + bar["v"],
    }
