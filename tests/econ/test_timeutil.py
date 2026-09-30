from datetime import date

import pytest

from api.services.econ import timeutil as tu


def test_month_labels():
    want = (date(2026, 8, 1), date(2026, 8, 31))
    assert tu.parse_month("2026-08") == want
    assert tu.parse_month("202608") == want
    assert tu.parse_month("2026M08") == want
    assert tu.parse_month("2026-08-01") == want
    assert tu.parse_month("M08", year=2026) == want
    assert tu.parse_month("2024-02") == (date(2024, 2, 1), date(2024, 2, 29))
    for bad in ("2026-13", "M13", "Aug 2026", "2026-8"):
        with pytest.raises(ValueError):
            tu.parse_month(bad, year=2026)
    with pytest.raises(ValueError):
        tu.parse_month("M08")          # needs a year


def test_quarter_labels():
    want = (date(2026, 4, 1), date(2026, 6, 30))
    for s in ("2026Q2", "2026-Q2", "2026 Q2", "2026:q2", "Q2 2026", "Q2-2026"):
        assert tu.parse_quarter(s) == want, s
    assert tu.parse_quarter("Q2", year=2026) == want
    assert tu.parse_quarter("2026Q4") == (date(2026, 10, 1), date(2026, 12, 31))
    with pytest.raises(ValueError):
        tu.parse_quarter("2026Q5")


def test_week_bounds_and_anchor():
    assert tu.week_bounds("2026-09-19", "SAT") == (date(2026, 9, 13), date(2026, 9, 19))
    with pytest.raises(ValueError):
        tu.week_bounds("2026-09-18", "SAT")     # a Friday
    assert tu.period_bounds("2026-09-18", "W", week_anchor="FRI")[1] == date(2026, 9, 18)


def test_shift_period():
    assert tu.shift_period("2026-01-01", "M", -12) == date(2025, 1, 1)
    assert tu.shift_period("2026-03-01", "M", -1) == date(2026, 2, 1)
    assert tu.shift_period("2026-01-01", "Q", -1) == date(2025, 10, 1)
    assert tu.shift_period("2026-09-13", "W", -52) == date(2025, 9, 14)
    with pytest.raises(ValueError):
        tu.shift_period("2026-09-14", "D", -1)


def test_federal_holidays_2026():
    h = tu.federal_holidays(2026)
    assert set(h) == {
        date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 5, 25),
        date(2026, 6, 19), date(2026, 7, 3),   # July 4 is a Saturday -> Friday
        date(2026, 9, 7), date(2026, 10, 12), date(2026, 11, 11), date(2026, 11, 26),
        date(2026, 12, 25)}
    assert "observed" in h[date(2026, 7, 3)]


def test_observance_crosses_year_boundary():
    # Jan 1 2022 was a Saturday: observed Friday Dec 31 2021
    assert tu.is_federal_holiday("2021-12-31")
    assert date(2021, 12, 31) in tu.federal_holidays(2021)
    assert not tu.is_federal_holiday("2022-01-01") or tu.is_weekend("2022-01-01")
    # Christmas 2022 Sunday -> Monday 26th
    assert tu.is_federal_holiday("2022-12-26")


def test_juneteenth_starts_2021_and_not_nyse():
    assert not tu.is_federal_holiday("2020-06-19")
    assert tu.is_federal_holiday("2021-06-18")          # Sat 19th -> Fri 18th
    # Good Friday is an NYSE holiday but a FEDERAL business day
    assert tu.is_business_day("2026-04-03")
    # Columbus Day: markets open, federal closed
    assert not tu.is_business_day("2026-10-12")


def test_business_day_stepping():
    assert tu.next_business_day("2026-07-02") == date(2026, 7, 6)   # skip Fri obs + weekend
    assert tu.prev_business_day("2026-07-06") == date(2026, 7, 2)
    assert tu.next_business_day("2026-11-25") == date(2026, 11, 27)
    assert tu.add_business_days("2026-09-04", 1) == date(2026, 9, 8)  # Labor Day
    assert tu.add_business_days("2026-09-08", -1) == date(2026, 9, 4)
    assert tu.on_or_after_business_day("2026-09-07") == date(2026, 9, 8)


def test_et_utc_round_trip_and_dst():
    # 08:30 ET in September = EDT (UTC-4) -> 12:30Z
    ts = tu.et_to_utc("2026-09-10", "08:30")
    assert ts == 1789043400
    assert tu.utc_to_et(ts).strftime("%H:%M") == "08:30"
    # January = EST (UTC-5) -> 13:30Z
    jan = tu.et_to_utc("2026-01-13", "08:30")
    assert (jan % 86400) == 13 * 3600 + 30 * 60
    assert tu.et_date(tu.et_to_utc("2026-03-08", "23:59")) == date(2026, 3, 8)
