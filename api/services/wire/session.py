"""The ET session date a print belongs to.

This is the wire's PRIMARY KEY and (Phase 3) its alert-dedup key, so it is its
own module with its own tests. `date.today()` is wrong here: the box runs
Central, and a 16:05 ET print must land on the ET session regardless of host
timezone.

Weekday-based, matching `calendar.py::_prev_trading_day`. Market holidays need
no special case: on a holiday there are no scheduled reporters, so the wire is
correctly EMPTY rather than wrong.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")


def market_session_date(now: datetime | None = None) -> str:
    """ISO date of the trading session a print at `now` belongs to."""
    if now is None:
        now = datetime.now(_ET)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=_ET)      # naive means ET here, never UTC
    else:
        now = now.astimezone(_ET)

    d = now.date()
    while d.weekday() >= 5:                # Sat/Sun -> back to Friday
        d -= timedelta(days=1)
    return d.isoformat()
