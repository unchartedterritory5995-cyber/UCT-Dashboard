"""The NYSE calendar held to the evidence it was extended from (2026-09-28).

The one calendar (``app/src/lib/marketClock/market_calendar.json``, read by
``nyse_calendar`` and ``nyseCalendar.js``) runs back to 2000, and the clock layer
(``tradingview_session`` / ``tradingViewSession.js``) derives TradingView's view
of it. The historical rows came from two calendar libraries that agree, and this
file keeps them true against the vendor's OWN SPY history -- a date added,
dropped or moved in the dataset reddens here against the captures, not against a
second typed list.

Evidence (committed): ``tests/fixtures/vendor/harness/vw-clock-close-tfchange-spy-
{1d,1w}-2026-09-28.json`` (8,473 daily bars from the 1993-01-29 listing; 1,758
weekly bars). The 20,616-bar 60m capture that evidences the half-days is kept
outside git for size; its rail skips, by name, when the file is absent.
"""
from __future__ import annotations

import json
import pathlib
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from api.services import nyse_calendar as nyse
from api.services import tradingview_session as cal

_ET = ZoneInfo("America/New_York")
_HARNESS = pathlib.Path(__file__).resolve().parent / "fixtures" / "vendor" / "harness"
_D1 = _HARNESS / "vw-clock-close-tfchange-spy-1d-2026-09-28.json"
_W1 = _HARNESS / "vw-clock-close-tfchange-spy-1w-2026-09-28.json"
_H60 = pathlib.Path(
    "C:/Users/Patrick/AppData/Local/uct-vendor-batch/runs/probes2-2026-09-28/"
    "captures/vw-clock-close-tfchange-spy-60-2026-09-28.json")


def _load(p: pathlib.Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def _col(cap: dict, k: str) -> int:
    titles = [p["title"] for p in cap["study"]["plots"]]
    return 1 + next(i for i, t in enumerate(titles) if t.startswith(f"{k}_"))


def _et(t: float) -> datetime:
    return datetime.fromtimestamp(t, _ET)


def _ymd(d: date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _at(d: date, minute: int) -> float:
    return datetime(d.year, d.month, d.day, minute // 60, minute % 60, tzinfo=_ET).timestamp()


@pytest.fixture(scope="module")
def d1():
    return _load(_D1)


@pytest.fixture(scope="module")
def w1():
    return _load(_W1)


def test_every_weekday_without_a_vendor_daily_bar_is_a_closure_and_no_other(d1):
    days = {_et(r[0]).date() for r in d1["bars"]["rows"]}
    last = max(days)
    # the dataset's own coverage, never a typed year: before it nothing is held
    first = max(min(days), date.fromisoformat(
        f"{nyse.NYSE_CALENDAR_FROM_YYYYMMDD // 10000}-01-01"))
    absent = set()
    d = first
    while d <= last:
        if d.weekday() < 5 and d not in days:
            absent.add(_ymd(d))
        d += timedelta(days=1)
    held = {h for h in nyse.NYSE_HOLIDAYS_YYYYMMDD if _ymd(first) <= h <= _ymd(last)}
    # ⛔ non-vacuity: 26 years of closures, not a window that happens to be empty
    assert len(absent) > 230
    assert sorted(absent - held) == [], "vendor has no bar on a day the calendar trades"
    assert sorted(held - absent) == [], "calendar closes a day the vendor has a bar on"


def test_the_vendor_daily_close_is_13_00_on_exactly_its_applied_half_days(d1):
    k01 = _col(d1, "K01")
    rows = d1["plotValues"]["rows"]
    early = {_ymd(_et(r[0]).date()) for r in rows if _et(r[k01]).hour == 13}
    first, last = _ymd(_et(rows[0][0]).date()), _ymd(_et(rows[-1][0]).date())
    view = {d for d in cal.TRADINGVIEW_EARLY_CLOSES_YYYYMMDD if first <= d <= last}
    assert len(early) == 13
    assert early == view
    # ...and every close that is not 13:00 is 16:00: the template has no third hour
    assert all(_et(r[k01]).hour in (13, 16) and _et(r[k01]).minute == 0 for r in rows)


def test_a_weekly_bar_opens_on_the_weeks_first_vendor_session_and_closes_on_its_last(w1):
    k01, k08 = _col(w1, "K01"), _col(w1, "K08")
    bad_open, bad_close = [], []
    for r in w1["plotValues"]["rows"]:
        monday = _et(r[0]).date() - timedelta(days=_et(r[0]).weekday())
        week = [monday + timedelta(days=i) for i in range(5)]
        sessions = [(d, cal.tradingview_close_minute(_ymd(d))) for d in week]
        sessions = [(d, c) for d, c in sessions if c is not None]
        if _at(sessions[0][0], cal.SESSION_OPEN_MINUTE) != r[k08]:
            bad_open.append(monday.isoformat())
        if _at(sessions[-1][0], sessions[-1][1]) != r[k01]:
            bad_close.append(monday.isoformat())
    # ⛔ non-vacuity: the rule is not "always Monday / always Friday" -- the
    # vendor's own weeks include 133 late-starting and 46 early-ending ones
    starts = {_et(r[0]).weekday() for r in w1["plotValues"]["rows"]}
    assert starts == {0, 1, 2}
    assert bad_open == [] and bad_close == []


def test_the_vendors_calendar_starts_in_2000_and_ignores_two_unscheduled_closures(w1):
    """The exceptions are MEASURED facts about the vendor, and each one is visible
    in a weekly bar -- so removing one from the calendar reddens here."""
    k01 = _col(w1, "K01")
    by_monday = {}
    for r in w1["plotValues"]["rows"]:
        t = _et(r[0])
        by_monday[t.date() - timedelta(days=t.weekday())] = (t, _et(r[k01]))
    # before 2000: Presidents' Day 1999 is a real closure (the vendor has no daily
    # bar for it), and the vendor still opens the week on that Monday
    assert by_monday[date(1999, 2, 15)][0].date() == date(1999, 2, 15)
    assert cal.tradingview_close_minute(19990215) == 960
    # September 11: the week reads Friday 16:00 though the NYSE was shut Tue-Fri
    assert by_monday[date(2001, 9, 10)][1] == datetime(2001, 9, 14, 16, 0, tzinfo=_ET)
    # Hurricane Sandy: the week is stamped Monday 09:30 though Monday was shut
    assert by_monday[date(2012, 10, 29)][0] == datetime(2012, 10, 29, 9, 30, tzinfo=_ET)
    # and a scheduled one after 2000 IS applied (Ford, a Tuesday after a holiday Monday)
    assert by_monday[date(2007, 1, 1)][0].date() == date(2007, 1, 3)


def test_the_half_day_set_is_the_days_the_vendors_60m_volume_collapses_after_13_00():
    if not _H60.exists():
        pytest.skip(f"the 60m capture is kept outside git: {_H60}")
    cap = _load(_H60)
    by_day = defaultdict(dict)
    for t, _o, _h, _l, _c, v in cap["bars"]["rows"]:
        e = _et(t)
        by_day[e.date()][e.strftime("%H:%M")] = v
    collapsed = set()
    for d, m in by_day.items():
        pre = m.get("12:30", 0)
        post = sum(v for k, v in m.items() if k >= "13:30")
        if len(m) < 7 or (pre and post < 0.15 * pre):
            collapsed.add(_ymd(d))
    lo, hi = _ymd(min(by_day)), _ymd(max(by_day))
    held = {d for d in nyse.NYSE_EARLY_CLOSES_YYYYMMDD if lo <= d <= hi}
    assert len(collapsed) == 23
    assert collapsed == held
