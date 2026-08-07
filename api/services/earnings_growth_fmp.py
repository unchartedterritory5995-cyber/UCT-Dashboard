"""Quarterly YoY earnings growth from FMP — the half yfinance leaves blank.

WHY THIS EXISTS
---------------
`get_fundamentals` reads `earnings_growth_pct` from yfinance's
`info["earningsGrowth"]`, and that field is empty far more often than it
should be. Sampled live 2026-08-06 across 40 liquid names, **8 (20%) had no
EPS rating at all** as a direct result — and EPS carries the joint-largest
weight (0.25) in the UCT Composite, so one ticker in five was scoring on 75%
of the intended basis.

WHAT THIS CAN AND CANNOT FIX -- the distinction is the whole design
-------------------------------------------------------------------
Of those 8, only SOME were provider gaps. Measured, not assumed:

  PANW   year-ago quarter POSITIVE  -> -167.5%  RECOVERABLE
  COIN   year-ago quarter POSITIVE  -> -125.2%  RECOVERABLE
  JAZZ   year-ago quarter a LOSS    ->  UNDEFINED  (-$405M TTM -> +$941M)
  CRWD, SNOW, ZS, TEAM  likewise    ->  UNDEFINED

A growth PERCENTAGE from a negative or zero base is not a hard number, it is
a meaningless one: JAZZ went -$405M -> +$941M, which is a loss-to-profit
turnaround and arguably the strongest earnings signal there is, but "+332%"
would be arithmetic theatre -- the sign flip, not the magnitude, is the
information. So this module REFUSES those rather than inventing a figure, and
the UI's coverage note already explains the gap honestly (see
`research/ratings._coverage`). Filling them would be worse than the gap.

IT MUST BE THE *SAME* STATISTIC, AND THAT WAS MEASURED
-----------------------------------------------------
The composite ranks `earnings_growth` as a PERCENTILE across the universe. If
80% of tickers carried yfinance's definition and the backfilled 20% carried a
different one, the ranking would silently compare unlike things -- worse than
the blank it replaced, because it would look authoritative.

So the method was chosen by measurement, not intuition. Both candidates were
computed for 9 names where yfinance HAS a value (2026-08-06):

    SYM    yfinance   TTM-over-TTM   quarter-YoY
    MSFT       31.7           31.3          31.3
    NVDA      214.5          107.9         210.6   <-- decisive
    AAPL       28.7           29.9          27.1
    AMD       159.5          127.0         163.4
    LLY        26.2           93.5          25.3   <-- decisive
    ORCL       21.9           37.3          25.6
    ANET       35.7           24.4          36.5
    V          10.2           11.4           6.8
    COST       45.5           12.7          15.2   <-- neither

TTM-over-TTM is the intuitive choice and it is WRONG: it halves NVDA and
nearly quadruples LLY. `info["earningsGrowth"]` is the most recent quarter
against the YEAR-AGO quarter, so that is what this computes -- accepting that
a single quarter is noisier, because matching the incumbent definition matters
more than picking the nicer statistic.

COST matches neither and is left as a known outlier (a fiscal-calendar
mismatch is the likely cause); one name in nine, and it only ever applies when
yfinance returned nothing anyway.

⚠️ Renamed tickers: FMP keeps serving the OLD symbol with stale figures (SQ
returned -132.2% while the live XYZ rows give -87.9%). This module cannot
detect that; it is a symbol-resolution problem, tracked separately.
"""
from __future__ import annotations

import logging

# Resolved through the MODULE at call time, never `from ... import _fmp_get`.
# A bound copy severs this module from the owner's guards AND from every test
# stub -- that exact mistake sent a live request through an active provider
# cooldown on 2026-08-06. See earnings_history_fmp for the full note.
from api.services import earnings_estimates as _ee
from api.services.cache import cache

_log = logging.getLogger(__name__)

# Quarters pulled. Only rows 0 and 4 are read, but asking for a few extra
# absorbs a restated or duplicated period without the year-ago row falling off
# the end of the response.
_QUARTERS = 8
# Rows back to the year-ago quarter in a newest-first quarterly list.
_YEAR_AGO = 4

_CACHE_TTL = 6 * 3600      # fundamentals move quarterly; 6h is generous
_MISS_TTL = 900            # never cache a failed fetch as a durable value
_SENTINEL = "__none__"     # distinguishes "asked, no answer" from a cache miss


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def earnings_growth_pct(ticker: str) -> float | None:
    """Quarter-over-year-ago-quarter net-income growth %, or None.

    None covers BOTH "FMP had nothing" and "the prior-year base was <= 0, so
    the percentage is undefined". The caller cannot act differently on those
    two anyway -- in both cases there is no honest figure to show -- and
    collapsing them keeps this from implying a precision it does not have.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None

    ck = f"fmp_eg::{sym}"
    hit = cache.get(ck)
    if hit is not None:
        return None if hit == _SENTINEL else hit

    try:
        rows = _ee._fmp_get("/stable/income-statement",
                            {"symbol": sym, "period": "quarter", "limit": _QUARTERS})
    except Exception as exc:                       # noqa: BLE001 - never raise
        _log.warning("FMP income statement failed for %s: %s", sym, exc)
        rows = None

    out = _growth_from_rows(rows)
    # Short TTL on a miss so a transient provider blip doesn't pin a blank for
    # six hours; full TTL only on a real answer.
    cache.set(ck, _SENTINEL if out is None else out,
              _MISS_TTL if out is None else _CACHE_TTL)
    return out


def _growth_from_rows(rows) -> float | None:
    """Pure half, so the arithmetic is testable without touching the network.

    Most recent quarter vs the YEAR-AGO quarter -- matching what
    `info["earningsGrowth"]` reports. See the module note for the measurement
    that ruled out TTM-over-TTM.
    """
    if not isinstance(rows, list):
        return None
    # Drop unusable rows BEFORE indexing, but keep order: position 4 must still
    # be four QUARTERS back. A row with no netIncome would otherwise shift the
    # year-ago index and quietly compare the wrong two periods.
    ni = [_num(r.get("netIncome")) for r in rows if isinstance(r, dict)]
    if len(ni) <= _YEAR_AGO:
        return None
    recent, year_ago = ni[0], ni[_YEAR_AGO]
    if recent is None or year_ago is None:
        return None

    # THE REFUSAL. A percentage from a non-positive base is undefined, not
    # merely large -- see the module note. Returning something here is the
    # single easiest way to make this feature worse than the gap it fills.
    if year_ago <= 0:
        return None
    return round((recent - year_ago) / year_ago * 100, 1)
