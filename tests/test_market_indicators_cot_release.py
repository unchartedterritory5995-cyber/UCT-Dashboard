"""COT knowledge time: a report may be USED only from the moment CFTC published it.

Every expected date below is CFTC's own: the 2026 release schedule's holiday exceptions,
the 2025-01-09 closure announcement, and the 2025 / 2018-19 catch-up schedules.
"""
from __future__ import annotations

import pytest

from api.services.econ import timeutil as tu
from api.services.market_indicators import cot_release as cr


def et(d, hhmm):
    return tu.et_to_utc(d, hhmm)


# ── the Tuesday → Friday 15:30 boundary ─────────────────────────────────────

@pytest.mark.parametrize("when,public", [
    (("2026-09-22", "16:00"), False),   # as-of Tuesday, after its own close
    (("2026-09-23", "12:00"), False),   # Wednesday
    (("2026-09-24", "23:59"), False),   # Thursday
    (("2026-09-25", "15:29"), False),   # Friday, one minute before publication
    (("2026-09-25", "15:30"), True),    # Friday, published
    (("2026-09-28", "09:30"), True),    # the following Monday
])
def test_a_tuesday_report_is_unknown_until_friday_1530(when, public):
    assert cr.is_public("2026-09-22", et(*when)) is public


def test_the_daily_bar_that_first_knows_a_normal_report_is_friday():
    # Published 15:30, the session closes 16:00: Friday's bar IS the first that knew it.
    assert cr.available_day("2026-09-22") == "2026-09-25"


def test_next_report_before_publication_leaves_the_previous_one_standing():
    asofs = ["2026-09-15", "2026-09-22"]
    assert cr.latest_public(asofs, et("2026-09-24", "12:00")) == "2026-09-15"
    assert cr.latest_public(asofs, et("2026-09-25", "15:29")) == "2026-09-15"
    assert cr.latest_public(asofs, et("2026-09-25", "15:30")) == "2026-09-22"


# ── holidays and closures: CFTC's own dates ─────────────────────────────────

@pytest.mark.parametrize("asof,released", [
    ("2025-12-30", "2026-01-05"),   # New Year's Day Thursday
    ("2026-06-16", "2026-06-22"),   # Juneteenth Friday
    ("2026-06-30", "2026-07-06"),   # July 3 observed, Friday
    ("2026-11-10", "2026-11-16"),   # Veterans Day Wednesday
    ("2026-11-24", "2026-11-30"),   # Thanksgiving
    ("2026-12-22", "2026-12-28"),   # Christmas Friday
    ("2025-01-07", "2025-01-13"),   # Carter day of mourning (closure) Thursday
])
def test_a_wed_to_fri_holiday_moves_release_to_the_next_publication_day(asof, released):
    ts, method = cr.available_at(asof)
    assert method == "rule"
    assert tu.utc_to_et(ts).date().isoformat() == released


def test_a_monday_holiday_does_not_move_the_release():
    # Labor Day 2026-09-07 is a Monday; the as-of 2026-09-08 report is released Friday.
    assert cr.available_day("2026-09-08") == "2026-09-11"


# ── CFTC's delayed schedules ────────────────────────────────────────────────

@pytest.mark.parametrize("asof,released", [
    ("2025-09-30", "2025-11-19"),
    ("2025-10-07", "2025-11-21"),
    ("2025-11-10", "2025-12-10"),
    ("2025-12-23", "2025-12-29"),
    ("2018-12-24", "2019-02-01"),
    ("2019-02-26", "2019-03-05"),
])
def test_lapse_backlogs_use_cftcs_published_schedule(asof, released):
    ts, method = cr.available_at(asof)
    assert method.startswith("schedule:")
    assert tu.utc_to_et(ts).date().isoformat() == released


def test_the_2019_catch_up_meets_the_normal_schedule():
    # The first report after the derived table is back on the rule, one Friday later.
    assert cr.available_at("2019-03-05") == (et("2019-03-08", "15:30"), "rule")


def test_the_2023_ion_outage_is_a_late_side_bound():
    for asof in ("2023-01-31", "2023-02-14", "2023-03-14"):
        ts, method = cr.available_at(asof)
        assert method == "bound:2023-02-ion"
        assert cr.available_day(asof) == "2023-03-22"   # published after the close
    assert cr.available_at("2023-01-24")[1] == "rule"
    assert cr.available_at("2023-03-21")[1] == "rule"


def test_an_unscheduled_lapse_falls_back_late_side():
    ts, method = cr.available_at("2013-10-08")
    assert method == "lapse:2013-10"
    assert ts >= et("2013-12-15", "00:00")


def test_availability_is_never_before_the_as_of_date_and_is_monotone():
    import datetime as dt
    d = dt.date(2017, 1, 3)
    prev = None
    # Real as-of dates are Tuesdays, or the Monday when Tuesday is a holiday — the
    # schedule tables name those Mondays, so use them where they exist.
    tabled = {k for ov in cr.schedule()["overrides"] for k in ov["releases"]}
    while d <= dt.date(2026, 9, 22):
        mon = (d - dt.timedelta(days=1)).isoformat()
        asof = mon if mon in tabled else d
        ts, _ = cr.available_at(asof)
        assert ts > et(asof, "16:00"), asof
        if prev is not None:
            assert ts >= prev, f"{d} became public before the report a week older"
        prev = ts
        d += dt.timedelta(days=7)
