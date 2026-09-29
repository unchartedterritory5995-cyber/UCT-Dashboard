"""TERM-035 -- the market clock as code: ONE session authority, with a horizon.

The dataset is ``app/src/lib/marketClock/market_calendar.json``. This module and
``app/src/lib/marketClock/sessionCalendar.js`` both read THOSE BYTES, so the
server and the browser cannot hold two different lists of holidays or half-days.

Why the file lives under ``app/src``: Vite's dev server refuses to import a file
outside ``app/`` (``server.fs.allow`` defaults to the package root, and this repo
has no workspace marker), while the Python runtime image copies the whole tree
(``Dockerfile.web``: ``COPY . /app``). So ``app/src`` is the one place both
runtimes can read without a build step or a config change.

The API is three functions plus the horizon:

* ``session_at(ts)``   -> ``'pre' | 'rth' | 'post' | 'closed'``
* ``is_trading_day(d)`` -> bool
* ``close_time(d)``    -> tz-aware ET ``datetime`` of the regular close
  (13:00 on a half-day), or ``None`` on a non-trading day
* ``horizon()``        -> the last date the dataset covers

Boundaries, ET, DST-aware via ``zoneinfo``: pre 04:00, RTH 09:30 to 16:00
(13:00 on a half-day), post to 20:00 -- on a half-day too, which is the
convention ``marketClock.js`` (``EXT_END_MIN``) and
``voice_temporal_awareness._session_state`` already ship.
``nyse_calendar.EARLY_EXTENDED_CLOSE_HOUR = 17`` is a labelled, unconfirmed
vendor-bar hypothesis that nothing member-facing reads; it is not followed here.

Outside ``[coverage_start, horizon]`` the answer degrades to weekday + hours,
the same "no throw, no guess about holidays" convention ``marketClock.js`` pins.
``covers(d)`` says whether an answer was calendar-backed. The protection against
that degrade becoming the normal case is the HORIZON RAIL in
``tests/test_session_calendar.py``: it fails while the horizon is still
``MIN_HORIZON_MONTHS`` ahead, because an expired calendar and a correct one look
identical on any single ordinary day.

This module is NOT yet read by any production path. The existing lists
(``nyse_calendar.py``, ``nyseCalendar.js`` and the others named in
``docs/terminal-research/10-roadmap/evidence/2026-09-29-term035-calendar-census/results.md``)
migrate onto it one module at a time, each with a parity assertion. Until then,
the tests hold this dataset EQUAL to ``nyse_calendar.py`` on every year both
cover, so the lists cannot drift apart without a test going red.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, time
from pathlib import Path
from typing import Literal, Mapping
from zoneinfo import ZoneInfo

_logger = logging.getLogger(__name__)

Session = Literal["pre", "rth", "post", "closed"]

ET = ZoneInfo("America/New_York")

DATASET_PATH = (
    Path(__file__).resolve().parents[2]
    / "app" / "src" / "lib" / "marketClock" / "market_calendar.json"
)


def _hm(s: str) -> int:
    """Minutes since midnight for an ``HH:MM`` string."""
    hh, mm = s.split(":")
    return int(hh) * 60 + int(mm)


@dataclass(frozen=True)
class CalendarData:
    """One parsed, validated copy of the dataset."""

    version: str
    coverage_start: date
    horizon: date
    pre_start_min: int
    open_min: int
    close_min: int
    post_end_min: int
    holidays: Mapping[date, str]
    early_closes: Mapping[date, int]  # date -> close minute-of-day

    @classmethod
    def from_dict(cls, raw: dict) -> "CalendarData":
        sessions = raw["sessions"]
        coverage_start = date.fromisoformat(raw["coverage_start"])
        horizon = date.fromisoformat(raw["horizon"])
        holidays = {date.fromisoformat(h["date"]): h["name"] for h in raw["holidays"]}
        early = {date.fromisoformat(e["date"]): _hm(e["close"]) for e in raw["early_closes"]}

        problems = []
        if len(holidays) != len(raw["holidays"]):
            problems.append("duplicate holiday date")
        if len(early) != len(raw["early_closes"]):
            problems.append("duplicate early-close date")
        both = sorted(set(holidays) & set(early))
        if both:
            problems.append(f"both a closure and a half-day: {both}")
        for d in (*holidays, *early):
            if d.weekday() >= 5:
                problems.append(f"{d} is a weekend")
            if not coverage_start <= d <= horizon:
                problems.append(f"{d} is outside [{coverage_start}, {horizon}]")
        if problems:
            raise ValueError(f"market_calendar.json is invalid: {problems}")

        return cls(
            version=raw["version"],
            coverage_start=coverage_start,
            horizon=horizon,
            pre_start_min=_hm(sessions["pre_start"]),
            open_min=_hm(sessions["open"]),
            close_min=_hm(sessions["close"]),
            post_end_min=_hm(sessions["post_end"]),
            holidays=holidays,
            early_closes=early,
        )


def load(path: Path = DATASET_PATH) -> CalendarData:
    return CalendarData.from_dict(json.loads(path.read_text(encoding="utf-8")))


_CAL = load()
_logger.info(
    "[session-calendar] NYSE calendar v%s covers %s..%s",
    _CAL.version, _CAL.coverage_start, _CAL.horizon,
)


# ---------------------------------------------------------------------------
# The authority. Every function takes an optional ``cal`` so tests can inject a
# mutated dataset; production callers never pass it.
# ---------------------------------------------------------------------------

def horizon(cal: CalendarData = _CAL) -> date:
    """The last date the dataset covers."""
    return cal.horizon


def version(cal: CalendarData = _CAL) -> str:
    return cal.version


def covers(d: date, cal: CalendarData = _CAL) -> bool:
    """Whether ``d``'s answer is backed by the published calendar."""
    return cal.coverage_start <= d <= cal.horizon


def is_trading_day(d: date, cal: CalendarData = _CAL) -> bool:
    """True on an NYSE session day (a half-day IS a trading day)."""
    if isinstance(d, datetime):
        raise TypeError("is_trading_day takes an ET calendar date, not a datetime")
    return d.weekday() < 5 and d not in cal.holidays


def is_half_day(d: date, cal: CalendarData = _CAL) -> bool:
    return d in cal.early_closes


def holiday_name(d: date, cal: CalendarData = _CAL) -> str | None:
    return cal.holidays.get(d)


def _close_min(d: date, cal: CalendarData) -> int:
    return cal.early_closes.get(d, cal.close_min)


def close_time(d: date, cal: CalendarData = _CAL) -> datetime | None:
    """The regular-session close of ``d`` as a tz-aware ET datetime (13:00 on a
    half-day), or ``None`` when ``d`` is not a trading day."""
    if not is_trading_day(d, cal):
        return None
    m = _close_min(d, cal)
    return datetime.combine(d, time(m // 60, m % 60), tzinfo=ET)


def session_at(ts: datetime, cal: CalendarData = _CAL) -> Session:
    """``'pre' | 'rth' | 'post' | 'closed'`` at instant ``ts``.

    ``ts`` must be timezone-aware: a naive datetime does not name an instant,
    and guessing its zone is how two services end up an hour apart in March.
    """
    if ts.tzinfo is None or ts.utcoffset() is None:
        raise ValueError("session_at needs a timezone-aware datetime")
    et = ts.astimezone(ET)
    d = et.date()
    if not is_trading_day(d, cal):
        return "closed"
    m = et.hour * 60 + et.minute
    if m < cal.pre_start_min:
        return "closed"
    if m < cal.open_min:
        return "pre"
    if m < _close_min(d, cal):
        return "rth"
    if m < cal.post_end_min:
        return "post"
    return "closed"


# ---------------------------------------------------------------------------
# The horizon rail's check, as a pure function so its control case can be run
# with an injected "today".
# ---------------------------------------------------------------------------

#: The rail fails once the dataset covers fewer than this many months beyond
#: the day the test runs. NYSE publishes about three years ahead, so twelve
#: months leaves a refresh window of roughly two years.
MIN_HORIZON_MONTHS = 12


def add_months(d: date, months: int) -> date:
    """``d`` plus ``months`` calendar months, clamped to the month's last day."""
    y, m0 = divmod(d.month - 1 + months, 12)
    y += d.year
    m = m0 + 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(y, m, day)
        except ValueError:
            continue
    raise AssertionError("unreachable")


def horizon_runway_ok(
    today: date, hz: date | None = None, months: int = MIN_HORIZON_MONTHS
) -> bool:
    """True while ``hz`` (default: the dataset's horizon) is at least ``months``
    months beyond ``today``."""
    hz = _CAL.horizon if hz is None else hz
    return hz >= add_months(today, months)
