"""O11: the ONE implied-move convention every options panel uses.

    move (one standard deviation) = IV x sqrt(trading sessions / 252)

`IV` is the vendor's annualised implied volatility; `trading sessions` counts NYSE sessions (the
published session calendar, weekends and holidays excluded). A one-day move is therefore
IV / sqrt(252) whatever the weekday, a five-day move is IV x sqrt(5/252), and the range to an
expiration counts the sessions between today and that expiration -- never calendar days / 365,
which made a weekly's range ~20% wider than the Levels panel's move for the same IV.
"""
from __future__ import annotations

import datetime as _dt
import math

SESSIONS_PER_YEAR = 252
CONVENTION_TEXT = ("One standard deviation = IV x sqrt(trading sessions / 252), with trading "
                   "sessions counted on the NYSE calendar (weekends and holidays excluded).")


def sessions_between(start: _dt.date, end: _dt.date) -> int:
    """NYSE sessions after `start` up to and including `end` (0 when `end` <= `start`)."""
    from api.services import session_calendar
    if end <= start:
        return 0
    n, d = 0, start
    while d < end:
        d += _dt.timedelta(days=1)
        if session_calendar.is_trading_day(d):
            n += 1
    return n


def sigma(iv: float, sessions: float) -> float:
    """The one-standard-deviation move as a fraction of spot."""
    return iv * math.sqrt(max(sessions, 0) / SESSIONS_PER_YEAR)
