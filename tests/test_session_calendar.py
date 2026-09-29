"""TERM-035 -- the session authority (api/services/session_calendar.py).

Four things are railed here:

1. THE HORIZON RAIL. Fails while the dataset's horizon is still
   ``MIN_HORIZON_MONTHS`` ahead of the day the suite runs, so an expiring calendar
   goes red a year early instead of quietly answering wrongly the day after it
   lapses. Its control cases inject "today" to prove the check can go red.
2. THE SHARED FIXTURE. ``tests/fixtures/market_calendar_cases.json`` is read here
   AND by ``app/src/lib/marketClock/sessionCalendar.test.js``; both must agree
   with every row, which is the client/server parity the ticket asks for.
3. NO SECOND LIST. On every year both cover, the dataset equals
   ``api/services/nyse_calendar.py`` exactly (full closures and half-days).
   Since TERM-035 follow-up #1 that module DERIVES its sets from this dataset,
   so this now pins the derivation; the independent check is the shared
   fixture, which ``tests/test_nyse_calendar_parity.py`` also puts to the
   backend sets.
4. THE DATASET IS HONEST ABOUT ITS HORIZON: every year it claims is populated.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import pytest

from api.services import session_calendar as sc
from api.services.nyse_calendar import (
    NYSE_EARLY_CLOSES_YYYYMMDD,
    NYSE_HOLIDAYS_YYYYMMDD,
)

_ROOT = Path(__file__).resolve().parents[1]
_FIXTURE = json.loads((_ROOT / "tests" / "fixtures" / "market_calendar_cases.json").read_text(encoding="utf-8"))
_RAW = json.loads(sc.DATASET_PATH.read_text(encoding="utf-8"))


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# --------------------------------------------------------------------------
# 1. The horizon rail
# --------------------------------------------------------------------------

def _assert_runway(today: date, hz: date) -> None:
    """The rail's assertion, parameterised so its control can run it."""
    required = sc.add_months(today, sc.MIN_HORIZON_MONTHS)
    assert sc.horizon_runway_ok(today, hz), (
        f"market_calendar.json horizon is {hz}, but the rail requires coverage "
        f"through at least {required} ({sc.MIN_HORIZON_MONTHS} months past {today}). "
        "Add the next published NYSE year from nyse.com/markets/hours-calendars "
        "(holidays AND early closes), move `horizon`, bump `version`, and add a "
        "fixture row for every new half-day."
    )


def test_horizon_rail_the_dataset_covers_min_months_beyond_today():
    print(f"session calendar v{sc.version()} horizon={sc.horizon()} "
          f"min_months={sc.MIN_HORIZON_MONTHS} today={date.today()}")
    _assert_runway(date.today(), sc.horizon())


def test_horizon_rail_control_goes_red_on_a_dataset_expiring_inside_the_window():
    """Injected today: 11 months before the horizon. The rail MUST fail."""
    hz = sc.horizon()
    today = sc.add_months(hz, -(sc.MIN_HORIZON_MONTHS - 1))
    with pytest.raises(AssertionError, match="horizon is"):
        _assert_runway(today, hz)


def test_horizon_rail_control_boundary_is_exactly_min_months():
    hz = date(2028, 12, 31)
    assert sc.horizon_runway_ok(date(2027, 12, 31), hz)       # exactly 12 months: ok
    assert not sc.horizon_runway_ok(date(2028, 1, 1), hz)     # one day inside: red


def test_min_horizon_months_is_twelve():
    assert sc.MIN_HORIZON_MONTHS == 12


def test_add_months_clamps_to_month_end():
    assert sc.add_months(date(2027, 1, 31), 1) == date(2027, 2, 28)
    assert sc.add_months(date(2027, 12, 31), 12) == date(2028, 12, 31)
    assert sc.add_months(date(2028, 12, 31), -11) == date(2028, 1, 31)


# --------------------------------------------------------------------------
# 2. The shared fixture (client/server parity)
# --------------------------------------------------------------------------

@pytest.mark.parametrize("case", _FIXTURE["sessions"], ids=lambda c: f"{c['ts']}-{c['expect']}")
def test_shared_fixture_session_at(case):
    assert sc.session_at(_ts(case["ts"])) == case["expect"], case["why"]


@pytest.mark.parametrize("case", _FIXTURE["days"], ids=lambda c: c["date"])
def test_shared_fixture_days(case):
    d = date.fromisoformat(case["date"])
    assert sc.is_trading_day(d) is case["trading_day"], case["why"]
    got = sc.close_time(d)
    if case["close_utc"] is None:
        assert got is None, case["why"]
    else:
        assert got == _ts(case["close_utc"]), case["why"]


def test_fixture_is_not_vacuous():
    tags = [c["tag"] for c in _FIXTURE["sessions"]]
    assert tags.count("half-day") >= 10
    assert tags.count("dst") >= 15
    assert tags.count("holiday") >= 8
    assert {c["expect"] for c in _FIXTURE["sessions"]} == {"pre", "rth", "post", "closed"}


def test_every_half_day_in_the_dataset_is_exercised_by_the_fixture():
    """A half-day is where scattered implementations disagree, so none may ship
    without a fixture row that both runtimes must answer."""
    fixture_days = {c["date"] for c in _FIXTURE["days"] if c["close_utc"]}
    fixture_session_days = {c["ts"][:10] for c in _FIXTURE["sessions"] if c["tag"] == "half-day"}
    for e in _RAW["early_closes"]:
        assert e["date"] in fixture_days, f"half-day {e['date']} has no `days` fixture row"
        assert e["date"] in fixture_session_days, f"half-day {e['date']} has no session fixture row"


# --------------------------------------------------------------------------
# 3. No second list: equal to nyse_calendar.py wherever both cover
# --------------------------------------------------------------------------

def _iso(yyyymmdd: int) -> str:
    return f"{yyyymmdd // 10000:04d}-{(yyyymmdd // 100) % 100:02d}-{yyyymmdd % 100:02d}"


_LEGACY_YEARS = sorted({d // 10000 for d in NYSE_HOLIDAYS_YYYYMMDD})


def test_legacy_years_are_read_from_the_legacy_table():
    assert _LEGACY_YEARS, "nyse_calendar.py parsed to no years; the parity below would be vacuous"


@pytest.mark.parametrize("year", _LEGACY_YEARS)
def test_dataset_equals_nyse_calendar_py_full_closures(year):
    ours = {h["date"] for h in _RAW["holidays"] if h["date"].startswith(str(year))}
    theirs = {_iso(d) for d in NYSE_HOLIDAYS_YYYYMMDD if d // 10000 == year}
    assert ours == theirs, (
        f"{year}: only in market_calendar.json {sorted(ours - theirs)}; "
        f"only in nyse_calendar.py {sorted(theirs - ours)}"
    )


@pytest.mark.parametrize("year", _LEGACY_YEARS)
def test_dataset_equals_nyse_calendar_py_half_days(year):
    ours = {e["date"] for e in _RAW["early_closes"] if e["date"].startswith(str(year))}
    theirs = {_iso(d) for d in NYSE_EARLY_CLOSES_YYYYMMDD if d // 10000 == year}
    assert ours == theirs, (
        f"{year}: only in market_calendar.json {sorted(ours - theirs)}; "
        f"only in nyse_calendar.py {sorted(theirs - ours)}"
    )


# --------------------------------------------------------------------------
# 4. The dataset itself
# --------------------------------------------------------------------------

def test_every_year_the_horizon_claims_is_populated():
    """A horizon moved forward without the year's dates is the quiet failure."""
    cal = sc.load()
    for year in range(cal.coverage_start.year, cal.horizon.year + 1):
        n = sum(1 for d in cal.holidays if d.year == year)
        assert n >= 8, f"{year} is inside the horizon but lists only {n} closures"
        assert any(d.year == year and d.month == 11 for d in cal.holidays), f"{year}: no Thanksgiving"
    assert cal.horizon == date(cal.horizon.year, 12, 31), "the horizon is a whole published year"


def test_dataset_rejects_a_date_past_its_horizon():
    raw = json.loads(json.dumps(_RAW))
    raw["holidays"].append({"date": "2029-01-01", "name": "x"})
    with pytest.raises(ValueError, match="outside"):
        sc.CalendarData.from_dict(raw)


def test_dataset_rejects_a_date_that_is_both_closure_and_half_day():
    raw = json.loads(json.dumps(_RAW))
    raw["early_closes"].append({"date": raw["holidays"][0]["date"], "name": "x", "close": "13:00"})
    with pytest.raises(ValueError, match="both"):
        sc.CalendarData.from_dict(raw)


def test_version_is_present():
    assert sc.version() == _RAW["version"] and sc.version()


# --------------------------------------------------------------------------
# Contract edges
# --------------------------------------------------------------------------

def test_naive_datetime_is_refused():
    with pytest.raises(ValueError, match="timezone-aware"):
        sc.session_at(datetime(2026, 9, 29, 10, 0))


def test_is_trading_day_refuses_a_datetime():
    with pytest.raises(TypeError):
        sc.is_trading_day(datetime(2026, 9, 29, 10, 0, tzinfo=sc.ET))


def test_outside_coverage_degrades_to_weekday_and_says_so():
    mlk_2029 = date(2029, 1, 15)
    assert not sc.covers(mlk_2029)
    assert sc.is_trading_day(mlk_2029)   # no guess about an unpublished year
    assert sc.covers(date(2028, 12, 29))


def test_half_day_and_holiday_name_helpers():
    assert sc.is_half_day(date(2026, 11, 27))
    assert not sc.is_half_day(date(2026, 11, 26))
    assert sc.holiday_name(date(2026, 11, 26)) == "Thanksgiving Day"
