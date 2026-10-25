"""The trading-days spine for the widget builder.

One place that answers "which days are sessions" for the widget engine's
trading-days source and its range math. It sits on the market calendar
(``session_calendar``) and the ET day bucketing (``timeutil``); it holds no
holiday list of its own.

Past the calendar's horizon the answer degrades to Monday to Friday, the same
no-throw convention ``session_calendar`` documents. ``sessions`` reports where
that began (``beyond_from``) so a caller can say so with ``beyond_note``.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import NamedTuple

from api.services import session_calendar
from api.services.journal_two import timeutil


class SessionRange(NamedTuple):
    days: list[date]
    # The first day of the range past ``horizon()``; None when the whole range
    # is inside the calendar.
    beyond_from: date | None


def today_et(now: datetime | None = None) -> date:
    """Today's date in New York. ``now`` is for tests; a naive value is read
    as UTC, the same rule ``timeutil`` applies to stored timestamps."""
    if now is None:
        return datetime.now(timeutil.ET).date()
    if now.tzinfo is None:
        now = now.replace(tzinfo=timeutil.UTC)
    return now.astimezone(timeutil.ET).date()


def is_session(d: date) -> bool:
    """A session day: the calendar's answer while it covers ``d``, else a
    weekday."""
    if session_calendar.covers(d):
        return session_calendar.is_trading_day(d)
    return d.weekday() < 5


def sessions(lo: date, hi: date) -> SessionRange:
    """Every session day in ``[lo, hi]``, plus where the calendar ran out."""
    if lo > hi:
        raise ValueError("The start date is after the end date.")
    days: list[date] = []
    d = lo
    while d <= hi:
        if is_session(d):
            days.append(d)
        d += timedelta(days=1)
    first_beyond = session_calendar.horizon() + timedelta(days=1)
    beyond_from = max(lo, first_beyond) if hi >= first_beyond else None
    return SessionRange(days, beyond_from)


def beyond_note(beyond_from: date) -> str:
    """The quiet note for a range that runs past the calendar's horizon."""
    last_covered = beyond_from - timedelta(days=1)
    # No zero-padding on the day, built by hand: %-d is not portable to Windows.
    shown = f"{last_covered.strftime('%b')} {last_covered.day}, {last_covered.year}"
    return f"Market calendar not available past {shown}; counting weekdays."


def entry_day_et(entry_date: str | None, *, estimated: bool) -> str | None:
    """The ET day a position was entered; None when the entry time is an
    estimate, so a guessed day never reaches a day-based measure."""
    if estimated:
        return None
    return timeutil.compute_trading_day_et(entry_date)


def session_on_or_before(d: date) -> date:
    """``d`` if it is a session, else the last session before it."""
    while not is_session(d):
        d -= timedelta(days=1)
    return d


def session_on_or_after(d: date) -> date:
    """``d`` if it is a session, else the first session after it."""
    while not is_session(d):
        d += timedelta(days=1)
    return d


def next_session_after(d: date) -> date:
    """The first session strictly after ``d`` (a session is never its own next)."""
    return session_on_or_after(d + timedelta(days=1))


def nth_session_before(d: date, n: int) -> date:
    """The ``n``-th session strictly before ``d``; ``n`` counts from 1. Counted in sessions, so a
    holiday or a long weekend never shortens the span."""
    if n < 1:
        raise ValueError("Count at least one session back.")
    cur = d
    for _ in range(n):
        cur = session_on_or_before(cur - timedelta(days=1))
    return cur
