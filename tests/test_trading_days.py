"""Task 8.2: the trading-days spine over the market calendar."""
from datetime import date, datetime, timedelta, timezone

import pytest

from api.services import session_calendar
from api.services.journal_two import trading_days as td


def test_weekend_and_holiday_are_not_sessions():
    days = td.sessions(date(2026, 11, 23), date(2026, 11, 29)).days
    assert date(2026, 11, 26) not in days  # Thanksgiving
    assert date(2026, 11, 28) not in days  # Saturday
    assert date(2026, 11, 29) not in days  # Sunday
    assert date(2026, 11, 23) in days


def test_half_day_is_a_session():
    assert date(2026, 11, 27) in td.sessions(date(2026, 11, 23), date(2026, 11, 29)).days


def test_beyond_horizon_counts_weekdays():
    hz = session_calendar.horizon()
    res = td.sessions(hz - timedelta(days=3), hz + timedelta(days=10))
    assert res.beyond_from == hz + timedelta(days=1)
    after = [d for d in res.days if d > hz]
    assert after, "weekdays past the horizon must be counted"
    assert all(d.weekday() < 5 for d in after)
    expected = [
        hz + timedelta(days=i) for i in range(1, 11)
        if (hz + timedelta(days=i)).weekday() < 5
    ]
    assert after == expected


def test_inside_the_horizon_has_no_beyond_from():
    assert td.sessions(date(2026, 11, 23), date(2026, 11, 29)).beyond_from is None


def test_range_wholly_past_horizon_starts_beyond_at_lo():
    hz = session_calendar.horizon()
    lo = hz + timedelta(days=5)
    assert td.sessions(lo, lo + timedelta(days=3)).beyond_from == lo


def test_reversed_range_raises_with_sentence():
    with pytest.raises(ValueError, match=r"^The start date is after the end date\.$"):
        td.sessions(date(2026, 11, 30), date(2026, 11, 23))


def test_beyond_note_names_the_last_covered_day_without_zero_padding():
    # beyond_from is the first day past the calendar; the note names the day
    # before it, the last one the calendar covers.
    assert td.beyond_note(date(2029, 1, 1)) == (
        "Market calendar not available past Dec 31, 2028; counting weekdays."
    )
    assert td.beyond_note(date(2029, 1, 6)) == (
        "Market calendar not available past Jan 5, 2029; counting weekdays."
    )
    hz = session_calendar.horizon()
    res = td.sessions(hz, hz + timedelta(days=3))
    assert td.beyond_note(res.beyond_from).startswith(
        f"Market calendar not available past {hz.strftime('%b')} {hz.day}, {hz.year};"
    )


def test_entry_day_estimated_is_none():
    assert td.entry_day_et("2026-10-20T01:30:00Z", estimated=True) is None


def test_entry_day_uses_et_not_utc():
    assert td.entry_day_et("2026-10-20T01:30:00Z", estimated=False) == "2026-10-19"


def test_session_on_or_before_saturday_is_friday():
    assert td.session_on_or_before(date(2026, 11, 28)) == date(2026, 11, 27)


def test_session_on_or_before_holiday_and_session():
    assert td.session_on_or_before(date(2026, 11, 26)) == date(2026, 11, 25)
    assert td.session_on_or_before(date(2026, 11, 25)) == date(2026, 11, 25)


def test_is_session():
    assert td.is_session(date(2026, 11, 27)) is True
    assert td.is_session(date(2026, 11, 26)) is False
    assert td.is_session(date(2026, 11, 28)) is False


def test_today_et_uses_et_not_utc():
    # 01:30 UTC Oct 20 is still Oct 19 in New York.
    assert td.today_et(datetime(2026, 10, 20, 1, 30, tzinfo=timezone.utc)) == date(2026, 10, 19)
    assert isinstance(td.today_et(), date)
