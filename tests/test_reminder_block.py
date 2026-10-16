"""Tier 2 part B, item 12 (R-T2B-13): the Reminder a journal style places. An ordinary unticked task
whose own paragraph holds a dateMention, so note_tasks reads its due date with no new reader."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from api.services import session_calendar
from api.services.journal_two import journal_styles as js
from api.services.journal_two import note_tasks, reminder_block as rb


def _weekday_holiday(year: int, month: int) -> date:
    d = date(year, month, 1)
    while d.month == month:
        if d.weekday() < 5 and not session_calendar.is_trading_day(d):
            return d
        d += timedelta(days=1)
    raise AssertionError(f"no weekday holiday in {year}-{month:02d}")      # non-vacuity


def test_add_trading_days_skips_weekends_and_a_holiday():
    assert rb.add_trading_days(date(2026, 10, 16), 1) == date(2026, 10, 19)   # Friday -> Monday
    h = _weekday_holiday(2026, 11)
    before = h - timedelta(days=1)
    while not session_calendar.is_trading_day(before):
        before -= timedelta(days=1)
    got = rb.add_trading_days(before, 1)
    assert got > h and session_calendar.is_trading_day(got)


def test_create_mode_builds_a_task_that_note_tasks_reads_as_due():
    now = datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)          # Wednesday, 11:00 ET
    node, reason = rb.build_reminder({"block": "reminder", "settings": {"days": "5"}}, {"now": now, "mode": "create"})
    assert reason is None
    tasks = note_tasks.extract_tasks({"type": "doc", "content": [node]})
    assert len(tasks) == 1 and tasks[0]["checked"] is False
    assert tasks[0]["due"] == rb.add_trading_days(date(2026, 10, 14), 5).isoformat()
    assert tasks[0]["text"].startswith("Follow up by")


def test_the_clock_is_eastern_time():
    late = datetime(2026, 10, 15, 2, 0, tzinfo=timezone.utc)            # still Oct 14 in ET
    node, _ = rb.build_reminder({"settings": {"days": "1"}}, {"now": late, "mode": "create"})
    assert note_tasks.extract_tasks({"type": "doc", "content": [node]})[0]["due"] == "2026-10-15"


def test_an_unknown_days_setting_is_the_default():
    now = datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)
    a, _ = rb.build_reminder({"settings": {"days": "99"}}, {"now": now, "mode": "create"})
    b, _ = rb.build_reminder({"settings": {}}, {"now": now, "mode": "create"})
    c, _ = rb.build_reminder({}, {"now": now, "mode": "create"})
    assert a == b == c


def test_update_mode_builds_nothing():
    node, reason = rb.build_reminder({"settings": {}}, {"now": datetime.now(timezone.utc), "mode": "update"})
    assert node is None and reason == rb.CREATE_ONLY_REASON


def test_the_block_is_catalogued_with_a_builder_and_is_create_only():
    assert "reminder" in js.KNOWN_BLOCKS
    assert js.BLOCK_BUILDERS["reminder"] is rb.build_reminder
    assert js._BLOCK_BY_ID["reminder"]["settings"][0] == {"key": "days", "options": rb.DAYS_OPTIONS,
                                                          "default": rb.DEFAULT_DAYS}
    assert "search" not in js._BLOCK_BY_ID["reminder"]     # not a widget: no searchText
    assert js.CREATE_ONLY_BLOCKS == frozenset({"reminder"})


# ── the horizon guard: never a date the calendar dataset cannot vouch for ──────────────────────────────────────────

def test_add_trading_days_refuses_past_the_calendar_dataset():
    edge = session_calendar.horizon()                           # the last covered day (a Sunday: 2028-12-31)
    last = edge
    while not session_calendar.is_trading_day(last):
        last -= timedelta(days=1)                               # the last covered SESSION
    before_last = last - timedelta(days=1)
    while not session_calendar.is_trading_day(before_last):
        before_last -= timedelta(days=1)
    assert rb.add_trading_days(before_last, 1) == last          # the last covered session is still reachable
    with pytest.raises(rb.CalendarRangeError):
        rb.add_trading_days(last, 1)                            # the next one lies beyond the dataset
    with pytest.raises(rb.CalendarRangeError):
        rb.add_trading_days(edge + timedelta(days=3), 1)        # a start already beyond it
    with pytest.raises(rb.CalendarRangeError):
        rb.add_trading_days(session_calendar.calendar().coverage_start - timedelta(days=1), 1)
    assert issubclass(rb.CalendarRangeError, ValueError)


def test_a_weekday_guess_past_the_range_would_have_been_a_holiday():
    """Non-vacuity for the guard: Jan 1 2029 is a Monday NYSE holiday. is_trading_day, past the dataset, answers
    from the weekday alone, so without the guard the walk would hand back a holiday."""
    day = date(2029, 1, 1)
    assert day.weekday() == 0 and not session_calendar.covers(day)
    assert session_calendar.is_trading_day(day) is True         # the unvouched-for answer the guard refuses to use
    with pytest.raises(rb.CalendarRangeError):
        rb.add_trading_days(date(2028, 12, 29), 1)


def test_the_reminder_block_is_skipped_not_dated_past_the_range():
    edge = session_calendar.horizon()
    now = datetime(edge.year, edge.month, edge.day, 15, 0, tzinfo=timezone.utc)
    node, reason = rb.build_reminder({"settings": {"days": "1"}}, {"now": now, "mode": "create"})
    assert node is None and reason == rb.CALENDAR_RANGE_REASON
