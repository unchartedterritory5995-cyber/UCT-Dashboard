"""The most recent COMPLETED session, for the MD-1 adapters (owner: agent-md). agent-qa F-23.

`bars_fetch._last_closed_session_yyyymmdd` counts today as closed only from 16:00 ET, so on a half day (13:00 close)
the completed session is skipped from 13:00 to 16:00 and every "last completed session" answer gives the day before.
This helper reads the SAME calendar (`bars_fetch._session_close_minutes`, `_is_nyse_holiday`) and counts today as
completed once ITS OWN close has passed; at every other moment it returns exactly what bars_fetch returns. bars_fetch
itself is not changed (it is not agent-md's, and its 16:00 rule mirrors the client's chart logic).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")


def last_completed_session(now: Optional[datetime] = None) -> int:
    """YYYYMMDD of the newest completed NYSE session at `now` (default: the wall clock)."""
    from api.services import bars_fetch
    et = (now or datetime.now(timezone.utc)).astimezone(_ET)
    ymd = int(et.strftime("%Y%m%d"))
    try:
        trading = et.weekday() < 5 and not bars_fetch._is_nyse_holiday(ymd)
        if trading and et.hour * 60 + et.minute >= bars_fetch._session_close_minutes(ymd):
            return ymd
    except Exception:  # noqa: BLE001 — an unreadable calendar: fall back to the product's own rule
        pass
    return bars_fetch._last_closed_session_yyyymmdd(now=et)
