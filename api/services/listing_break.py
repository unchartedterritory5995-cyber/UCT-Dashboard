"""Where a symbol's CURRENT listing starts in a daily series read from the bars store.

The store keeps every daily bar a symbol ever had. A recycled or renamed symbol
therefore carries an EARLIER security's bars in front of its own: on production,
2026-11-12, ``BNY`` held a municipal fund at $9.67 to $10.20 (to 2026-02-06), 104
days of nothing, then the bank at $138.98 (from 2026-05-21); ``BSP`` held 2013-14
bars near $8, a 4,317-day gap, then a 2026 listing at $40.50. The CHART never shows
the earlier life (``bars_sanitize._apply_listing_cutoff`` drops it at serve time,
read-only), but every reader of the STORE saw one stock that had risen fifteen-fold:
the RS Rating scored 8 of that night's 14 liquid 99s on such closes, and the screener
build drew their 200-day line, 52-week range and one-year change across the break.

This module is the store readers' cut. Pure: no I/O, no clock, no environment.

THE RULE is the chart's, its two metadata-free branches, so a stock's numbers and its
chart agree on where its history starts:

* a gap of :data:`GAP_DAYS` calendar days between two consecutive daily bars WITH a
  close that jumped by :data:`PRICE_FACTOR` either way, or
* a gap of :data:`GAP_STANDALONE_DAYS` on its own.

A shorter gap at a similar price is a halt of the SAME company, or a hole the prewarm
left (BSP carries a 17-day one inside its real history), and cuts nothing. The chart
has a third branch this cannot use (a gap that resumes on the provider's listing
date, read from a metadata cache): a symbol reused within 150 days at under four
times the price is cut on the chart and not here. Counted as a known difference, not
hidden.

The three numbers are pinned equal to ``bars_sanitize``'s and to
``bars_sqlite.current_listing_starts``'s defaults by ``tests/test_listing_break.py``.
"""
from __future__ import annotations

from datetime import date

#: A gap this long (calendar days) with a :data:`PRICE_FACTOR` close jump starts a new listing.
GAP_DAYS = 21
#: A gap this long starts a new listing whatever the price did.
GAP_STANDALONE_DAYS = 150
#: The close ratio across the gap (or its inverse) that marks another security.
PRICE_FACTOR = 4.0


def _date(ymd: int) -> date:
    y = int(ymd)
    return date(y // 10000, y // 100 % 100, y % 100)


def is_break(gap_days: int, prev_close, close) -> bool:
    """Is a ``gap_days`` calendar gap between two consecutive daily bars the start of
    a new listing? A reference close that is missing or not positive is no evidence."""
    if gap_days < GAP_DAYS:
        return False
    if gap_days >= GAP_STANDALONE_DAYS:
        return True
    try:
        ratio = float(close) / float(prev_close)
    except (TypeError, ValueError, ZeroDivisionError):
        return False
    return ratio >= PRICE_FACTOR or (0.0 < ratio <= 1.0 / PRICE_FACTOR)


def start_index(ts_list, closes, lo: int = 0, hi: int | None = None) -> int:
    """The index, in ``[lo, hi)``, of the first bar of the listing that bar ``hi - 1``
    belongs to: the bar after the NEWEST listing break inside the range, else ``lo``.

    ``ts_list`` holds ``YYYYMMDD`` ints, oldest first; ``closes`` sits beside it.
    """
    hi = len(ts_list) if hi is None else int(hi)
    lo = max(0, int(lo))
    for i in range(hi - 1, lo, -1):
        # YYYYMMDD keys: inside one month the difference IS the day count, and across
        # a month end it is at least 70, so only a candidate pays for two dates.
        if ts_list[i] - ts_list[i - 1] >= GAP_DAYS and is_break(
                (_date(ts_list[i]) - _date(ts_list[i - 1])).days, closes[i - 1], closes[i]):
            return i
    return lo


def current_listing(bars: list) -> list:
    """``bars`` (dicts with a ``YYYYMMDD`` ``t`` and a close ``c``, oldest first) without
    any earlier listing. The SAME list object when there is nothing to cut, and when a
    bar's date cannot be read (the series is then left exactly as it was)."""
    if not bars or len(bars) < 2:
        return bars
    try:
        ts = [int(b["t"]) for b in bars]
    except (KeyError, TypeError, ValueError):
        return bars
    start = start_index(ts, [b.get("c") for b in bars])
    return bars if start <= 0 else bars[start:]
