"""Detect missing 1-minute bars within RTH sessions, surface for backfill.

A complete RTH session is 390 minute bars (9:30 ET inclusive to 16:00 ET exclusive).
Cross-day gaps (16:00 today -> 9:30 tomorrow) are NOT considered missing -- they're
expected. Weekend gaps similarly silent.

This module is read-only diagnostics. The active backfill queue is Plan 5.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")


def _is_in_rth(ts: int) -> bool:
    """True if epoch second `ts` falls within RTH 9:30-16:00 ET on a weekday."""
    dt = datetime.fromtimestamp(ts, tz=_ET)
    if dt.weekday() >= 5:
        return False
    hm = dt.hour * 100 + dt.minute
    return 930 <= hm < 1600


def find_missing_minutes(bars: list[dict]) -> list[int]:
    """Return sorted list of timestamps that should exist between consecutive bars.

    Only flags gaps that span fully within RTH sessions. A 16:00 -> 9:30 next-day
    gap is silently allowed (overnight). Weekend gaps are silently allowed.

    Args:
      bars: list of bar dicts with at least a "t" key (epoch seconds).

    Returns:
      Sorted list of epoch-second timestamps for each missing minute (in RTH).
    """
    if not bars or len(bars) < 2:
        return []
    sorted_bars = sorted(bars, key=lambda b: b.get("t", 0) if isinstance(b, dict) else 0)
    missing: list[int] = []
    for i in range(len(sorted_bars) - 1):
        if not isinstance(sorted_bars[i], dict) or not isinstance(sorted_bars[i + 1], dict):
            continue
        a = sorted_bars[i].get("t")
        b = sorted_bars[i + 1].get("t")
        if a is None or b is None:
            continue
        if b - a <= 60:
            continue
        # Skip overnight / cross-day gaps entirely -- they include the expected
        # 16:00 -> 9:30 next-day gap and are not real "missing" minutes.
        a_dt = datetime.fromtimestamp(a, tz=_ET)
        b_dt = datetime.fromtimestamp(b, tz=_ET)
        if a_dt.date() != b_dt.date():
            continue
        # Walk every expected minute timestamp between a and b within the same day
        ts = a + 60
        while ts < b:
            if _is_in_rth(ts):
                missing.append(ts)
            ts += 60
    return missing
