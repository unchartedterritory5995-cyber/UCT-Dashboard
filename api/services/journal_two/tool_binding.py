"""Template day binding and search text for routine and tracker blocks (spec 6.2 and 16.3,
ruling W11-R14).

When a template makes a note, each routine or tracker slot binds to a day: ``note-day`` is the
note's own day, ``next-trading-day`` the session after it, and ``week`` the last session of the
Monday-to-Sunday week containing it (so a weekend review binds the week just ended). "Follow
today" is never a template value.

This is the server twin of the wave 9 client helpers in ``lib/blocks/toolDays.js``
(``forDayLabel``, ``toolSearchText``, ``noteDayOf``). Neither side re-derives the other's
answer: both run over ``tests/fixtures/toolBindingVectors.json``. Pure: no I/O beyond
``trading_days``.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from api.services.journal_two import trading_days

BINDS = ("note-day", "next-trading-day", "week")
KINDS = ("routine", "tracker")

_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _parse_day(day) -> date | None:
    """A ``YYYY-MM-DD`` that is a real calendar day, else None."""
    if not isinstance(day, str) or len(day) != 10:
        return None
    try:
        return date.fromisoformat(day)
    except ValueError:
        return None


def note_day(*, daily_date: str | None, created_at: str | None, now: datetime) -> str:
    """The day a new note belongs to: its daily date when that is a real ``YYYY-MM-DD``, else
    the ET day it was created, else today in New York."""
    d = _parse_day(daily_date)
    if d is not None:
        return d.isoformat()
    created = trading_days.et_day_of(created_at)
    if created is not None:
        return created
    return trading_days.today_et(now).isoformat()


def bind_day(note_day: str, bind: str) -> str:
    """The day a template slot binds to, from the note's day. Raises ``ValueError`` for a bind
    outside ``BINDS`` (a template never follows today) or a note day that is not a date."""
    if bind not in BINDS:
        raise ValueError("A template binds to the note's day, the next trading day or the week.")
    d = _parse_day(note_day)
    if d is None:
        raise ValueError("The note's day is not a date.")
    if bind == "note-day":
        return d.isoformat()
    if bind == "next-trading-day":
        return trading_days.next_session_after(d).isoformat()
    return trading_days.last_session_of_week(d).isoformat()


def week_monday(day: str) -> str:
    """The Monday on or before ``day``, from the date parts (no time zone); '' for a non-day."""
    d = _parse_day(day)
    if d is None:
        return ""
    return (d - timedelta(days=d.weekday())).isoformat()


def _short(d: date) -> str:
    return f"{_MONTHS[d.month - 1]} {d.day}"


def for_day_label(day: str, bind: str) -> str:
    """``For Tue Oct 27``; for ``week``, ``For the week of Oct 19`` (that week's Monday). The
    client's ``forDayLabel`` words, exactly; '' for a non-day."""
    d = _parse_day(day)
    if d is None:
        return ""
    if bind == "week":
        return f"For the week of {_short(date.fromisoformat(week_monday(day)))}"
    return f"For {_WEEKDAYS[d.weekday()]} {_short(d)}"


def search_text(kind: str, name: str, day: str, bind: str) -> str:
    """The line a routine or tracker block adds to a note's search text, e.g.
    ``[routine: Pre-market routine · For Tue Oct 27]`` (the client's ``toolSearchText``)."""
    if kind not in KINDS:
        raise ValueError("A tool block is a routine or a tracker.")
    return f"[{kind}: {name} · {for_day_label(day, bind)}]"
