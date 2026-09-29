"""WHAT TRADINGVIEW'S SESSION APPLIES -- the vendor's view of the NYSE calendar.

⭐ THE CLOCK LAYER, NOT A SECOND CALENDAR (2026-09-28, the C8 ``time_close``
lane). The real NYSE dates have ONE authority, ``market_calendar.json``, read
through ``nyse_calendar`` (here) and ``nyseCalendar.js`` (in the browser). What
lives in this module is four MEASURED facts about the vendor -- which of those
dates its session does not honour -- and the view DERIVED from the two. It is
kept out of ``nyse_calendar`` because it is not a fact about the NYSE, and the
browser twin ``tradingViewSession.js`` is held to it by
``tests/test_nyse_calendar_parity.py``.

Readers: ``indicator_compute.compute_clock`` / ``bar_open_instant`` (the C8 clock
columns and a date-keyed D/W/M bar's opening instant). ⛔ Stdlib plus the
``nyse_calendar`` leaf only, so the indicator engine pulls no service in.
"""
from __future__ import annotations

from datetime import date

from api.services.nyse_calendar import (
    NYSE_EARLY_CLOSES_YYYYMMDD,
    NYSE_HOLIDAYS_YYYYMMDD,
)

# ── WHAT TRADINGVIEW'S SESSION APPLIES (2026-09-28) ─────────────────────────
#
# Standing owner rule: the chart draws exactly what TradingView draws. The C8
# clock columns (``time_close``, ``time_close("D")``, a weekly or monthly bar's
# ``time``) therefore read the calendar AS THE VENDOR APPLIES IT. Measured on
# AMEX:SPY at full history (probe ``vw-clock-close-tfchange``, 1D / 60m / 1W):
#
#   closures -- from 2000 on, a weekly bar's ``time`` is its week's first
#     session and its ``time_close`` the last session's close: 133 of the 134
#     weeks whose first session is after Monday, 46 of the 47 whose last is
#     before Friday. Before 2000 the vendor stamps Monday 09:30 and Friday 16:00
#     on EVERY week, closure or not: 0 of 44 (31 late-starting weeks, the
#     listing week among them, and 13 early-ending ones). The two post-2000
#     misses are both unscheduled closures: the 2001-09-10 week reads Friday
#     16:00 (September 11 is not in the vendor's session) and the 2012-10-29
#     week is stamped Monday 09:30 (nor is Hurricane Sandy). 2004-06-11 (Reagan,
#     a Friday) and 2007-01-02 (Ford, the Tuesday after a holiday Monday) ARE
#     honoured. 2018-12-05 and 2025-01-09 fall mid-week, where no weekly reading
#     can see them, and are left applied.
#   half-days -- a daily bar's ``time_close`` is 13:00 on exactly 13 days, every
#     one an NYSE half-day from 2019-07-03 on, and the 60m chart agrees (the
#     12:30 bar closes at 13:00 and no later bar exists). The vendor keeps a FULL
#     session on every half-day before 2019 (all eight of 2015-2018 in the 60m
#     capture, late-trading bars to 16:00 included) and on 2020-11-27 and
#     2020-12-24.
TRADINGVIEW_CLOSURES_FROM_YYYYMMDD = 20000101
TRADINGVIEW_EARLY_CLOSES_FROM_YYYYMMDD = 20190101

#: Closures the vendor's session does not apply. Only 2001-09-14 and 2012-10-29
#: are OBSERVABLE (a weekly bar's close, a weekly bar's open); the other days of
#: the same two events cannot be seen from any weekly reading and go with them.
TRADINGVIEW_UNAPPLIED_CLOSURES_YYYYMMDD: frozenset[int] = frozenset({
    20010911, 20010912, 20010913, 20010914,     # September 11
    20121029, 20121030,                         # Hurricane Sandy
})

#: NYSE half-days on or after ``TRADINGVIEW_EARLY_CLOSES_FROM_YYYYMMDD`` that the
#: vendor's session keeps as full days.
TRADINGVIEW_UNAPPLIED_EARLY_CLOSES_YYYYMMDD: frozenset[int] = frozenset({
    20201127, 20201224,
})

#: ⭐ DERIVED, NEVER TYPED: the vendor's view of the two NYSE sets above.
TRADINGVIEW_CLOSURES_YYYYMMDD: frozenset[int] = frozenset(
    d for d in NYSE_HOLIDAYS_YYYYMMDD
    if d >= TRADINGVIEW_CLOSURES_FROM_YYYYMMDD
    and d not in TRADINGVIEW_UNAPPLIED_CLOSURES_YYYYMMDD)
TRADINGVIEW_EARLY_CLOSES_YYYYMMDD: frozenset[int] = frozenset(
    d for d in NYSE_EARLY_CLOSES_YYYYMMDD
    if d >= TRADINGVIEW_EARLY_CLOSES_FROM_YYYYMMDD
    and d not in TRADINGVIEW_UNAPPLIED_EARLY_CLOSES_YYYYMMDD)

#: The regular session in New York, minutes after midnight, and a half-day's close.
SESSION_OPEN_MINUTE = 9 * 60 + 30
SESSION_CLOSE_MINUTE = 16 * 60
EARLY_CLOSE_MINUTE = 13 * 60


def tradingview_close_minute(ymd: int):
    """The vendor's regular-session close on ``ymd`` (``YYYYMMDD``), in minutes
    after midnight New York -- 13:00 on a half-day it applies, else 16:00 -- or
    ``None`` when its session holds no trading that day: a Saturday, a Sunday,
    or a closure it applies. Mirrors ``nyseCalendar.js::tradingViewCloseMinute``.
    """
    if date(ymd // 10000, (ymd // 100) % 100, ymd % 100).weekday() >= 5 \
            or ymd in TRADINGVIEW_CLOSURES_YYYYMMDD:
        return None
    if ymd in TRADINGVIEW_EARLY_CLOSES_YYYYMMDD:
        return EARLY_CLOSE_MINUTE
    return SESSION_CLOSE_MINUTE
