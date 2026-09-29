"""⭐⭐ THE NYSE CALENDAR — the two date sets, and nothing else.

⛔⛔ THIS MODULE IMPORTS NOTHING. That is its entire job. Both sets already had
exactly one authority each, but those authorities lived inside SERVICE modules:
the full closures in ``bars_fetch`` (which pulls ``fastapi``, ``massive``, the
cache and a thread pool at import) and the half-days in ``liveflow_monitor``.
Any module that needed a date had to drag a service in behind it.

⚰️ THE CONCRETE COST, 2026-09-09. ``ast_interpret`` needed both sets to produce
the barstate tri-state, and reaching them meant ``try: from api.services.bars_fetch
import ...`` inside a function -- which put a ``try/except`` into a file whose own
rail forbids one, because *"a caught RecursionError is one line from being a
budget refusal"* (``tests/test_ast_budget.py``). The import was defensive for a
real reason and the rail was right for a real reason; the fix is neither, it is
to stop the data living inside a service.

⭐ STILL ONE AUTHORITY PER SET. ``bars_fetch`` and ``liveflow_monitor`` import
from here and re-export under their existing names, so every one of the existing
read sites is untouched and keeps working through the module it already names.
What moved is where the literal lives, not who owns it.

⚠️ BOTH SETS RUN TO 2027 and carry a standing instruction to refresh annually
from ``nyse.com/markets/hours-calendars``. Past that horizon a D/W/M bar falls
back to the regular session and may read ``isrealtime`` for up to one session
too long on a holiday or half-day -- named in ``docs/pine/barstate.md`` rather
than papered over.

⭐⭐ AND THEY RUN BACK TO 1993 (closures) AND 2015 (half-days), 2026-09-28. The
C8 clock (``time_close``, a weekly bar's ``time``) has to know what TradingView
knows, and TradingView's SPY history starts 1993-01-29. Neither extension is
typed from memory; each is the agreement of TWO INDEPENDENT sources:

  closures, 1993-01-29..2026-09-28 -- the weekdays with NO daily bar in the
    vendor's full SPY 1D history (``tests/fixtures/vendor/harness/vw-clock-close-
    tfchange-spy-1d-2026-09-28.json``, 8,473 sessions) against the NYSE holiday
    RULES (New Year not observed on a Saturday; MLK from 1998; Juneteenth from
    2022; Good Friday by the Easter computus) plus the eleven unscheduled
    closures named on the set below. 309 and 309, identical, no exception either
    way. 1993-01-01..28 and 2026-09-29..2027-12-31 rest on the rules alone, and
    the rules reproduce the 2025-2027 literals that were here before, date for
    date.
  half-days, 2015-01-02..2026-09-28 -- the NYSE half-day rules (July 3 Monday to
    Thursday, the day after Thanksgiving, Dec 24 Monday to Thursday) against the
    days on which the vendor's 60m RTH SPY volume COLLAPSES after 13:00 or the
    bars stop, read off a 20,616-bar capture kept outside git for size. 23 and
    23, identical. No capture shows a half-day before 2015, so the set STOPS
    there rather than being extended by rule alone:
    ``NYSE_EARLY_CLOSES_FROM_YYYYMMDD``.

⛔⛔ WHAT TRADINGVIEW APPLIES IS NOT THIS CALENDAR, AND IT IS WRITTEN DOWN BELOW
RATHER THAN SUBTRACTED FROM IT. The vendor's session ignores every closure
before 2000, two unscheduled ones after it, every half-day before 2019 and two
2020 half-days. Those are facts about the vendor, measured; the NYSE really was
shut and really did close at 13:00 (the late-trading volume says so), and
``breadth_session`` reconstructs from the tape and wants the truth. So this
module holds the truth ONCE and the vendor's exceptions ONCE, and the vendor's
view is DERIVED from the two (``TRADINGVIEW_CLOSURES_YYYYMMDD`` /
``TRADINGVIEW_EARLY_CLOSES_YYYYMMDD``) -- one calendar, annotated, not two.

⛔ HALF-DAYS ARE NOT CLOSURES AND THE TWO SETS MUST NOT BE UNIONED. A 1pm ET
early close is a REAL SESSION that trades; a closure produces no bars at all.
``bars_fetch``'s own comment says half-days are *"intentionally NOT"* in the
closure set, and that is correct for that set -- it is not, and never was, a
statement that this repo does not know them.
"""
from __future__ import annotations

#: NYSE FULL CLOSURES as ``YYYYMMDD`` ints. No bars exist on these dates.
#: 1993-2027, every year complete (the module docstring holds the evidence).
#: The unscheduled ones: 1994-04-27 (Nixon), 2001-09-11..14 (September 11),
#: 2004-06-11 (Reagan), 2007-01-02 (Ford), 2012-10-29/30 (Hurricane Sandy),
#: 2018-12-05 (G. H. W. Bush), 2025-01-09 (Carter).
#: ⚰️ Lived in ``api/services/bars_fetch.py`` until 2026-09-09 and is re-exported
#: from there, so ``bars_fetch._NYSE_HOLIDAYS_YYYYMMDD`` still resolves.
NYSE_HOLIDAYS_YYYYMMDD: frozenset[int] = frozenset({
    # 1993
    19930101, 19930215, 19930409, 19930531, 19930705, 19930906, 19931125,
    19931224,
    # 1994
    19940221, 19940401, 19940427, 19940530, 19940704, 19940905, 19941124,
    19941226,
    # 1995
    19950102, 19950220, 19950414, 19950529, 19950704, 19950904, 19951123,
    19951225,
    # 1996
    19960101, 19960219, 19960405, 19960527, 19960704, 19960902, 19961128,
    19961225,
    # 1997
    19970101, 19970217, 19970328, 19970526, 19970704, 19970901, 19971127,
    19971225,
    # 1998
    19980101, 19980119, 19980216, 19980410, 19980525, 19980703, 19980907,
    19981126, 19981225,
    # 1999
    19990101, 19990118, 19990215, 19990402, 19990531, 19990705, 19990906,
    19991125, 19991224,
    # 2000
    20000117, 20000221, 20000421, 20000529, 20000704, 20000904, 20001123,
    20001225,
    # 2001
    20010101, 20010115, 20010219, 20010413, 20010528, 20010704, 20010903,
    20010911, 20010912, 20010913, 20010914, 20011122, 20011225,
    # 2002
    20020101, 20020121, 20020218, 20020329, 20020527, 20020704, 20020902,
    20021128, 20021225,
    # 2003
    20030101, 20030120, 20030217, 20030418, 20030526, 20030704, 20030901,
    20031127, 20031225,
    # 2004
    20040101, 20040119, 20040216, 20040409, 20040531, 20040611, 20040705,
    20040906, 20041125, 20041224,
    # 2005
    20050117, 20050221, 20050325, 20050530, 20050704, 20050905, 20051124,
    20051226,
    # 2006
    20060102, 20060116, 20060220, 20060414, 20060529, 20060704, 20060904,
    20061123, 20061225,
    # 2007
    20070101, 20070102, 20070115, 20070219, 20070406, 20070528, 20070704,
    20070903, 20071122, 20071225,
    # 2008
    20080101, 20080121, 20080218, 20080321, 20080526, 20080704, 20080901,
    20081127, 20081225,
    # 2009
    20090101, 20090119, 20090216, 20090410, 20090525, 20090703, 20090907,
    20091126, 20091225,
    # 2010
    20100101, 20100118, 20100215, 20100402, 20100531, 20100705, 20100906,
    20101125, 20101224,
    # 2011
    20110117, 20110221, 20110422, 20110530, 20110704, 20110905, 20111124,
    20111226,
    # 2012
    20120102, 20120116, 20120220, 20120406, 20120528, 20120704, 20120903,
    20121029, 20121030, 20121122, 20121225,
    # 2013
    20130101, 20130121, 20130218, 20130329, 20130527, 20130704, 20130902,
    20131128, 20131225,
    # 2014
    20140101, 20140120, 20140217, 20140418, 20140526, 20140704, 20140901,
    20141127, 20141225,
    # 2015
    20150101, 20150119, 20150216, 20150403, 20150525, 20150703, 20150907,
    20151126, 20151225,
    # 2016
    20160101, 20160118, 20160215, 20160325, 20160530, 20160704, 20160905,
    20161124, 20161226,
    # 2017
    20170102, 20170116, 20170220, 20170414, 20170529, 20170704, 20170904,
    20171123, 20171225,
    # 2018
    20180101, 20180115, 20180219, 20180330, 20180528, 20180704, 20180903,
    20181122, 20181205, 20181225,
    # 2019
    20190101, 20190121, 20190218, 20190419, 20190527, 20190704, 20190902,
    20191128, 20191225,
    # 2020
    20200101, 20200120, 20200217, 20200410, 20200525, 20200703, 20200907,
    20201126, 20201225,
    # 2021
    20210101, 20210118, 20210215, 20210402, 20210531, 20210705, 20210906,
    20211125, 20211224,
    # 2022
    20220117, 20220221, 20220415, 20220530, 20220620, 20220704, 20220905,
    20221124, 20221226,
    # 2023
    20230102, 20230116, 20230220, 20230407, 20230529, 20230619, 20230704,
    20230904, 20231123, 20231225,
    # 2024
    20240101, 20240115, 20240219, 20240329, 20240527, 20240619, 20240704,
    20240902, 20241128, 20241225,
    # 2025
    20250101, 20250109, 20250120, 20250217, 20250418, 20250526, 20250619,
    20250704, 20250901, 20251127, 20251225,
    # 2026
    20260101, 20260119, 20260216, 20260403, 20260525, 20260619, 20260703,
    20260907, 20261126, 20261225,
    # 2027
    20270101, 20270118, 20270215, 20270326, 20270531, 20270618, 20270705,
    20270906, 20271125, 20271224,
})

#: NYSE 1pm ET HALF-DAYS as ``YYYYMMDD`` ints. Real sessions, short ones.
#: 2015-2027 (from ``NYSE_EARLY_CLOSES_FROM_YYYYMMDD``; see the docstring).
#: ⚰️ Lived in ``api/services/liveflow_monitor.py`` until 2026-09-09 and is
#: re-exported from there, so its five existing read sites are untouched.
NYSE_EARLY_CLOSES_YYYYMMDD: frozenset[int] = frozenset({
    20151127, 20151224,           # 2015
    20161125,                     # 2016
    20170703, 20171124,           # 2017
    20180703, 20181123, 20181224, # 2018
    20190703, 20191129, 20191224, # 2019
    20201127, 20201224,           # 2020
    20211126,                     # 2021
    20221125,                     # 2022
    20230703, 20231124,           # 2023
    20240703, 20241129, 20241224, # 2024
    20250703, 20251128, 20251224, # 2025
    20261127, 20261224,           # 2026
    20271126,                     # 2027
})

#: The first day each set is complete from. Before it, a date's absence from
#: the set means UNKNOWN, not "a regular session" -- a reader that must tell the
#: two apart (``breadth_session``) reads these rather than ``min(set)``.
NYSE_HOLIDAYS_FROM_YYYYMMDD = 19930101
NYSE_EARLY_CLOSES_FROM_YYYYMMDD = 20150101


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
    y, m, d = ymd // 10000, (ymd // 100) % 100, ymd % 100
    # Sakamoto's weekday, 0 = Sunday: this module imports nothing, ``datetime``
    # included.
    yy = y - 1 if m < 3 else y
    dow = (yy + yy // 4 - yy // 100 + yy // 400
           + (0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4)[m - 1] + d) % 7
    if dow in (0, 6) or ymd in TRADINGVIEW_CLOSURES_YYYYMMDD:
        return None
    if ymd in TRADINGVIEW_EARLY_CLOSES_YYYYMMDD:
        return EARLY_CLOSE_MINUTE
    return SESSION_CLOSE_MINUTE


#: ⚠️⚠️ HYPOTHESIS, NOT A MEASUREMENT — the hour TradingView appears to CONFIRM a
#: daily bar at. Kept here because it is a property of the trading calendar and
#: this module is where calendar literals live, NOT because it is established.
#:
#: ⭐ WHAT IS MEASURED: on 2026-09-10 the vendor's daily SPY bar read
#: ``isconfirmed = 0`` at 19:22 ET and ``isconfirmed = 1`` at 20:55 ET, in the SAME
#: page load. Five earlier rows from 16:17 to 19:22 all read 0, so it does not
#: confirm at the 16:00 regular close. The transition is bracketed to
#: **(19:22, 20:55) ET** and nothing narrower. See
#: ``tests/fixtures/vendor/barstate-daily-timeline.json``.
#:
#: ⛔ 20:00 IS THE GUESS THAT FITS THE BRACKET — the end of the extended-hours
#: session — and 17:00 is the same guess transposed onto a half-day (13:00 regular
#: close + the same four hours). NEITHER IS OBSERVED. The half-day figure is a
#: guess about a guess and is the first thing to check on the next early-close day.
#:
#: ⛔⛔ NOTHING MEMBER-FACING READS THESE YET. They exist so ``vendor`` mode can be
#: BUILT and replayed against the timeline; the shipped derivation is unchanged and
#: the flag defaults to ``calendar``. A reader who finds these and assumes the
#: product follows them is reading a switch that is off.
EXTENDED_CLOSE_HOUR = 20

#: The same hypothesis on an early-close day. See above: a guess about a guess.
EARLY_EXTENDED_CLOSE_HOUR = 17
