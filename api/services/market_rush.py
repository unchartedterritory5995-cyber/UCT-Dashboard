"""Keep heavy background work out of the market's opening and closing rush
(desktop speed plan Step 10.5).

MEASURED 2026-11-11 (the Wednesday measurement window, api/services/measurement_window.py):
`company_news_percompany` ran 09:38:58-09:45:28 ET, 390 s wall and 42.5 s of the web
process's CPU, inside the minutes members load every page after the open, on the same pod
that answers them. It runs every 20 minutes and takes 6-8 minutes; news coverage minutes
late costs nobody anything, a slow app at 09:30 costs every member.

So a heavy job asks `should_wait(now, expected_minutes)` before it starts, and skips that
run when it would START inside a rush or within its own expected length before one. The
next interval runs it after the rush. Time-critical jobs (breaking news, live data) do not
ask: only work whose value does not depend on the minute.

The rush windows are the deploy freeze's (tools/deploy_freeze.py BURST_WINDOWS_ET, the
times a deploy may not restart the pod). They are restated here because api/ cannot import
tools/; tests/test_market_rush.py fails if the two ever disagree.

THE NYSE CALENDAR (2026-11-26). RUSH_WINDOWS_ET is a REGULAR day. The rushes a job is held
out of are the DAY's (`day_rush_windows`, read from api/services/session_calendar.py, the
repo's one calendar): none on a holiday, and on a half-day the closing rush moves with the
close, close-30 .. close+15 (12:30-13:15 ET for a 13:00 close), exactly as the deploy freeze
derives it (`day_hold_windows`; a rail compares the two for every day the calendar covers).
A calendar that cannot be read, or a date past its horizon, falls back to the WEEKDAY rule
(RUSH_WINDOWS_ET), never to "no rush": a broken calendar must not put heavy work back into a
live session's busiest minutes.
"""
from __future__ import annotations

import datetime as _dt
import logging
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
_log = logging.getLogger(__name__)

#: A REGULAR day's rushes, ET wall clock, half-open [start, end). Same as the deploy freeze's BURST_WINDOWS_ET.
RUSH_WINDOWS_ET = (("opening", (9, 20), (9, 45)), ("closing", (15, 30), (16, 15)))
#: The close RUSH_WINDOWS_ET's closing rush is written around (30 min before it to 15 min after).
REGULAR_CLOSE_ET = (16, 0)
_WARNED: set = set()


def _calendar():
    """The one NYSE calendar (stdlib-only module; a seam for tests)."""
    from api.services import session_calendar
    return session_calendar


def _warn_once(msg: str) -> None:
    if msg not in _WARNED:
        _WARNED.add(msg)
        _log.warning("[market-rush] %s", msg)


def day_rush_windows(day: _dt.date) -> tuple:
    """The rushes of ET date `day`: ((name, start, end), ...). None on a weekend or an NYSE holiday; on a half-day the
    closing rush is close-30 .. close+15; a regular day is RUSH_WINDOWS_ET. Calendar unreadable or `day` past its
    horizon: RUSH_WINDOWS_ET (the weekday rule), with a logged warning."""
    if day.weekday() >= 5:
        return ()
    try:
        cal = _calendar()
        if not cal.covers(day):
            _warn_once(f"{day} is past the NYSE calendar's horizon ({cal.horizon()}); using the weekday rushes")
            return RUSH_WINDOWS_ET
        if not cal.is_trading_day(day):
            return ()
        close = cal.close_time(day)
        close_m = close.hour * 60 + close.minute
    except Exception as e:  # noqa: BLE001
        _warn_once(f"the NYSE calendar could not be read ({type(e).__name__}: {e}); using the weekday rushes")
        return RUSH_WINDOWS_ET
    regular_m = _minutes(REGULAR_CLOSE_ET)
    if close_m == regular_m:
        return RUSH_WINDOWS_ET
    opening, (name, a, b) = RUSH_WINDOWS_ET
    shift = close_m - regular_m
    hm = lambda m: (m // 60, m % 60)  # noqa: E731
    start = max(_minutes(a) + shift, _minutes(opening[2]))
    return (opening, (name, hm(start), hm(_minutes(b) + shift)))


def _minutes(hm: tuple[int, int]) -> int:
    return hm[0] * 60 + hm[1]


def should_wait(now: _dt.datetime, expected_minutes: float) -> str | None:
    """The rush a job starting `now` and running `expected_minutes` would overlap, or None.

    The rushes are the day's (`day_rush_windows`): weekends and NYSE holidays never wait, a half-day's closing rush
    is 12:30-13:15 ET. A naive `now` is read as ET."""
    et = now.astimezone(_ET) if now.tzinfo else now.replace(tzinfo=_ET)
    start = et.hour * 60 + et.minute + et.second / 60
    end = start + max(0.0, float(expected_minutes))
    for name, a, b in day_rush_windows(et.date()):
        if start < _minutes(b) and end > _minutes(a):
            return name
    return None
