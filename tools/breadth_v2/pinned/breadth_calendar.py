"""NYSE regular-session calendar for historical breadth reconstruction (2008 onward).

⛔⛔ WHY THE WINDOW IS NO LONGER DERIVED FROM PARTICIPATION. `breadth_session.rth_bounds`
took the last minute with ≥15 % of the busiest minute's names as "the auction minute" and
ended the path one minute earlier. Measured over the corrected V2 artifact, that is wrong in
both directions:

  * 417 full sessions (2008-2017): the 16:00 closing-cross minute sits just under the floor
    (e.g. 782 names vs a 5,270 open = 14.8 %), so the 15:59 REGULAR minute was dropped;
  * 22 half-days: post-bell 13:01/13:02 minutes clear the floor, so the 13:00 closing-
    AUCTION bar (and sometimes 13:01) entered the intraday path;
  * and the boundary was derived PER UNIVERSE, so four universes could disagree on when
    the same session ended.

⭐ The session is a calendar fact. It is written here from the exchange's published RULES
(not transcribed dates), and it is VERIFIED against the data rather than trusted: every
provider trading session in 2008-2026 is a rule trading day, every rule holiday is absent
from the provider, and the rule early closes are exactly the sessions whose participation
collapses at 13:00 (`tests/test_breadth_calendar.py`).

Window: 09:30 open, last regular-session bar = close − 1 minute (15:59 / 12:59). The
closing auction is not in the intraday path — it reaches the candle through the daily close.
A real halt (the 2020 market-wide circuit breakers) is simply minutes with no prints; it is
never "repaired".
"""
from __future__ import annotations

import datetime as _dt
from typing import Optional

OPEN_MIN = 9 * 60 + 30
CLOSE_MIN = 16 * 60
EARLY_CLOSE_MIN = 13 * 60

#: One-off closures that no rule produces. Each is a documented exchange closure.
SPECIAL_CLOSURES = {
    "2012-10-29": "Hurricane Sandy",
    "2012-10-30": "Hurricane Sandy",
    "2018-12-05": "National Day of Mourning (G.H.W. Bush)",
    "2025-01-09": "National Day of Mourning (J. Carter)",
}


def _easter(y: int) -> _dt.date:
    a = y % 19; b = y // 100; c = y % 100; d = b // 4; e = b % 4
    f = (b + 8) // 25; g = (b - f + 1) // 3; h = (19 * a + b - d - g + 15) % 30
    i = c // 4; k = c % 4; l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    return _dt.date(y, (h + l - 7 * m + 114) // 31, ((h + l - 7 * m + 114) % 31) + 1)


def _nth(y, mo, wd, n):
    d = _dt.date(y, mo, 1)
    d += _dt.timedelta(days=(wd - d.weekday()) % 7)
    return d + _dt.timedelta(weeks=n - 1)


def _last(y, mo, wd):
    d = (_dt.date(y, mo + 1, 1) if mo < 12 else _dt.date(y + 1, 1, 1)) - _dt.timedelta(days=1)
    return d - _dt.timedelta(days=(d.weekday() - wd) % 7)


def _observed(d):
    return d - _dt.timedelta(days=1) if d.weekday() == 5 else (
        d + _dt.timedelta(days=1) if d.weekday() == 6 else d)


def holidays(y: int) -> dict:
    h = {}
    ny = _dt.date(y, 1, 1)
    if ny.weekday() == 6:
        h[ny + _dt.timedelta(days=1)] = "New Year's Day (observed)"
    elif ny.weekday() != 5:          # a Saturday New Year is not observed on Dec 31
        h[ny] = "New Year's Day"
    h[_nth(y, 1, 0, 3)] = "Martin Luther King Jr. Day"
    h[_nth(y, 2, 0, 3)] = "Washington's Birthday"
    h[_easter(y) - _dt.timedelta(days=2)] = "Good Friday"
    h[_last(y, 5, 0)] = "Memorial Day"
    if y >= 2022:
        h[_observed(_dt.date(y, 6, 19))] = "Juneteenth"
    h[_observed(_dt.date(y, 7, 4))] = "Independence Day"
    h[_nth(y, 9, 0, 1)] = "Labor Day"
    h[_nth(y, 11, 3, 4)] = "Thanksgiving"
    h[_observed(_dt.date(y, 12, 25))] = "Christmas"
    for iso, name in SPECIAL_CLOSURES.items():
        d = _dt.date.fromisoformat(iso)
        if d.year == y:
            h[d] = name
    return h


def early_closes(y: int) -> dict:
    hol = holidays(y)
    e = {}
    jul3 = _dt.date(y, 7, 3)
    if jul3.weekday() < 5 and jul3 not in hol:
        e[jul3] = "Independence Day eve"
    e[_nth(y, 11, 3, 4) + _dt.timedelta(days=1)] = "Day after Thanksgiving"
    c24 = _dt.date(y, 12, 24)
    if c24.weekday() < 5 and c24 not in hol:
        e[c24] = "Christmas Eve"
    return e


def is_trading_day(iso: str) -> bool:
    d = _dt.date.fromisoformat(iso)
    return d.weekday() < 5 and d not in holidays(d.year)


def close_minute(iso: str) -> Optional[int]:
    """The session's scheduled close in ET minutes, or None when not a trading day."""
    if not is_trading_day(iso):
        return None
    d = _dt.date.fromisoformat(iso)
    return EARLY_CLOSE_MIN if d in early_closes(d.year) else CLOSE_MIN


def session_window(iso: str) -> Optional[tuple]:
    """(first_bar_minute, last_bar_minute) inclusive, or None when not a trading day."""
    c = close_minute(iso)
    return None if c is None else (OPEN_MIN, c - 1)
