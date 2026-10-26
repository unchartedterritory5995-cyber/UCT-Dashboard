"""Task 11.2: template day binding and search text (spec 6.2 and 16.3, ruling W11-R14)."""
from datetime import datetime, timezone

import pytest

from api.services.journal_two import tool_binding as tb


def test_today_is_refused_for_a_template():
    assert "today" not in tb.BINDS
    with pytest.raises(ValueError):
        tb.bind_day("2026-10-27", "today")
    with pytest.raises(ValueError):
        tb.bind_day("2026-10-27", "tomorrow")
    with pytest.raises(ValueError):
        tb.bind_day("2026-10-27", None)


def test_week_on_saturday_binds_the_friday_before():
    assert tb.bind_day("2026-10-24", "week") == "2026-10-23"
    assert tb.for_day_label(tb.bind_day("2026-10-24", "week"), "week") == "For the week of Oct 19"


def test_week_with_a_friday_holiday_binds_thursday():
    # 2026-07-03 is the observed Independence Day holiday.
    assert tb.bind_day("2026-07-04", "week") == "2026-07-02"


def test_next_trading_day_skips_thanksgiving():
    assert tb.bind_day("2026-11-25", "next-trading-day") == "2026-11-27"


def test_midnight_utc_note_dates_to_the_et_day():
    now = datetime(2026, 10, 30, 15, tzinfo=timezone.utc)
    assert tb.note_day(daily_date=None, created_at="2026-10-28T00:00:00Z", now=now) == "2026-10-27"
    assert tb.note_day(daily_date=None, created_at="2026-10-28T03:30:00Z", now=now) == "2026-10-27"


def test_a_bad_note_day_is_refused():
    with pytest.raises(ValueError):
        tb.bind_day("2026-02-30", "note-day")
    with pytest.raises(ValueError):
        tb.bind_day("not a day", "week")


def test_week_monday_is_from_the_date_parts():
    assert tb.week_monday("2026-10-25") == "2026-10-19"  # Sunday
    assert tb.week_monday("2026-10-19") == "2026-10-19"  # Monday
    assert tb.week_monday("2026-02-30") == ""


def test_search_text_refuses_an_unknown_kind():
    with pytest.raises(ValueError):
        tb.search_text("widget", "x", "2026-10-27", "note-day")
