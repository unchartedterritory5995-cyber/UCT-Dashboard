"""Economic data -- period math, the US FEDERAL business-day calendar, ET<->UTC.

Three jobs, all pure (no I/O, no clock unless you pass one):

  PERIODS     provider labels -> (period_start, period_end) as `date`s.
              'YYYY-MM' | 'YYYYMM' | 'YYYYMmm' | ('M08' + year) for months,
              '2026Q2' | '2026-Q2' | '2026 Q2' | 'Q2 2026' | ('Q2' + year) for
              quarters, week-ending ISO dates for weeks (anchor-checked).
              `shift_period` moves a period start by n periods on its grid.

  CALENDAR    the US FEDERAL holiday calendar (OPM rules: Saturday holiday is
              observed Friday, Sunday holiday observed Monday). This is NOT the
              NYSE calendar -- agencies (BLS/BEA/Census/Fed) publish on federal
              business days, and e.g. Good Friday is a federal business day while
              Columbus/Veterans Day are not.

  ZONES       ET <-> UTC through zoneinfo('America/New_York'); agency release
              times are stated in ET and `available_at` is unix seconds UTC.

Historical rules are honoured where they changed: the Monday-holiday rules
(Presidents/Memorial/Columbus) start 1971, Veterans Day moved to 4th Monday of
October 1971-1977, MLK Day starts 1986, Juneteenth starts 2021. One-off closures
(presidential funerals, Christmas Eve executive orders, inaugurations) are NOT
modelled -- a date-only schedule never needs them to be exact, and the lag rules
that use this calendar are deliberately conservative (late side).
"""
from __future__ import annotations

import calendar as _cal
import re
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from typing import Optional, Union
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

DateLike = Union[date, str]

# ─────────────────────────────── periods ────────────────────────────────────


def as_date(d: DateLike) -> date:
    """date | datetime | 'YYYY-MM-DD' -> date (ValueError on anything else)."""
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    if isinstance(d, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d.strip()):
        return date.fromisoformat(d.strip())
    raise ValueError(f"not an ISO date: {d!r}")


def month_bounds(year: int, month: int) -> tuple[date, date]:
    if not (1 <= month <= 12):
        raise ValueError(f"month out of range: {month}")
    return date(year, month, 1), date(year, month, _cal.monthrange(year, month)[1])


def quarter_bounds(year: int, quarter: int) -> tuple[date, date]:
    if not (1 <= quarter <= 4):
        raise ValueError(f"quarter out of range: {quarter}")
    m0 = 3 * (quarter - 1) + 1
    return date(year, m0, 1), month_bounds(year, m0 + 2)[1]


def year_bounds(year: int) -> tuple[date, date]:
    return date(year, 1, 1), date(year, 12, 31)


def quarter_of(d: DateLike) -> tuple[int, int]:
    d = as_date(d)
    return d.year, (d.month - 1) // 3 + 1


def quarter_bounds_of(d: DateLike) -> tuple[date, date]:
    return quarter_bounds(*quarter_of(d))


_WEEKDAY = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}


def _anchor_code(anchor) -> str:
    return str(getattr(anchor, "value", anchor) or "").upper()


def week_bounds(week_end: DateLike, anchor=None) -> tuple[date, date]:
    """A week ENDING on `week_end` (inclusive, 7 days). If `anchor` is given
    ('SAT'|'FRI'|'WED'|'MON' or a WeekAnchor) the end date must fall on it."""
    end = as_date(week_end)
    code = _anchor_code(anchor)
    if code:
        if code not in _WEEKDAY:
            raise ValueError(f"unknown week anchor: {anchor!r}")
        if end.weekday() != _WEEKDAY[code]:
            raise ValueError(f"week ending {end.isoformat()} is not a {code}")
    return end - timedelta(days=6), end


def parse_month(label: str, year: Optional[int] = None) -> tuple[date, date]:
    s = str(label).strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})(?:-01)?", s) or re.fullmatch(r"(\d{4})(\d{2})", s) \
        or re.fullmatch(r"(\d{4})M(\d{2})", s, re.I)
    if m:
        return month_bounds(int(m.group(1)), int(m.group(2)))
    m = re.fullmatch(r"M(\d{2})", s, re.I)           # BLS period code
    if m:
        if year is None:
            raise ValueError(f"month label {s!r} needs a year")
        if m.group(1) == "13":
            raise ValueError("M13 is an annual average, not a month")
        return month_bounds(int(year), int(m.group(1)))
    raise ValueError(f"unrecognised month label: {s!r}")


def parse_quarter(label: str, year: Optional[int] = None) -> tuple[date, date]:
    s = str(label).strip().upper()
    m = re.fullmatch(r"(\d{4})[\s\-:]?Q([1-4])", s)
    if m:
        return quarter_bounds(int(m.group(1)), int(m.group(2)))
    m = re.fullmatch(r"Q([1-4])[\s\-]?(\d{4})", s)
    if m:
        return quarter_bounds(int(m.group(2)), int(m.group(1)))
    m = re.fullmatch(r"Q0?([1-4])", s)
    if m:
        if year is None:
            raise ValueError(f"quarter label {s!r} needs a year")
        return quarter_bounds(int(year), int(m.group(1)))
    raise ValueError(f"unrecognised quarter label: {s!r}")


def period_bounds(label, frequency, *, year: Optional[int] = None,
                  week_anchor=None) -> tuple[date, date]:
    """Dispatch on frequency ('D'|'W'|'M'|'Q'|'A' or a model.Frequency)."""
    f = str(getattr(frequency, "value", frequency)).upper()
    if f == "M":
        return parse_month(label, year)
    if f == "Q":
        return parse_quarter(label, year)
    if f == "A":
        s = str(label).strip()
        if re.fullmatch(r"\d{4}", s):
            return year_bounds(int(s))
        raise ValueError(f"unrecognised annual label: {s!r}")
    if f == "W":
        return week_bounds(label, week_anchor)
    if f in ("D", "IRREG"):
        d = as_date(label)
        return d, d
    raise ValueError(f"unknown frequency: {frequency!r}")


def add_months(d: date, n: int) -> date:
    """Shift by n months, clamping the day to the target month's length."""
    y, m0 = divmod(d.month - 1 + n, 12)
    y += d.year
    return date(y, m0 + 1, min(d.day, _cal.monthrange(y, m0 + 1)[1]))


def shift_period(period_start: DateLike, frequency, n: int) -> date:
    """Move a PERIOD START by n periods on its calendar grid (n may be negative).
    Daily is not a calendar shift (observations are business days with holes)
    -- callers step daily series positionally."""
    d = as_date(period_start)
    f = str(getattr(frequency, "value", frequency)).upper()
    if f == "M":
        return add_months(d, n)
    if f == "Q":
        return add_months(d, 3 * n)
    if f == "A":
        return add_months(d, 12 * n)
    if f == "W":
        return d + timedelta(days=7 * n)
    raise ValueError(f"shift_period does not support frequency {frequency!r}")


# ─────────────────────────── federal holidays ───────────────────────────────


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """n-th (1-based) `weekday` of the month; n = -1 -> the last one."""
    if n > 0:
        first = date(year, month, 1)
        return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))
    last = month_bounds(year, month)[1]
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _observed(d: date) -> date:
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


@lru_cache(maxsize=512)
def _holidays_nominal(year: int) -> tuple[tuple[date, str], ...]:
    """Holidays by their ACTUAL (un-observed) date for `year`."""
    MON = 0
    h: list[tuple[date, str]] = [(date(year, 1, 1), "New Year's Day")]
    if year >= 1986:
        h.append((_nth_weekday(year, 1, MON, 3), "Birthday of Martin Luther King, Jr."))
    h.append(((_nth_weekday(year, 2, MON, 3) if year >= 1971 else date(year, 2, 22)),
              "Washington's Birthday"))
    h.append(((_nth_weekday(year, 5, MON, -1) if year >= 1971 else date(year, 5, 30)),
              "Memorial Day"))
    if year >= 2021:
        h.append((date(year, 6, 19), "Juneteenth National Independence Day"))
    h.append((date(year, 7, 4), "Independence Day"))
    h.append((_nth_weekday(year, 9, MON, 1), "Labor Day"))
    if year >= 1971:
        h.append((_nth_weekday(year, 10, MON, 2), "Columbus Day"))
    elif year >= 1937:
        h.append((date(year, 10, 12), "Columbus Day"))
    if 1971 <= year <= 1977:
        h.append((_nth_weekday(year, 10, MON, 4), "Veterans Day"))
    elif year >= 1938:
        h.append((date(year, 11, 11), "Veterans Day"))
    h.append(((_nth_weekday(year, 11, 3, 4) if year >= 1942 else _nth_weekday(year, 11, 3, -1)),
              "Thanksgiving Day"))
    h.append((date(year, 12, 25), "Christmas Day"))
    return tuple(h)


@lru_cache(maxsize=512)
def _observed_map(year: int) -> dict:
    """Observed federal holidays FALLING IN `year` (a Saturday Jan 1 of year+1
    is observed on Dec 31 of `year`)."""
    out: dict[date, str] = {}
    for y in (year, year + 1):
        for d, name in _holidays_nominal(y):
            o = _observed(d) if y >= 1971 or d.weekday() == 6 else d
            if o.year == year:
                out[o] = name + ("" if o == d else " (observed)")
    return out


def federal_holidays(year: int) -> dict[date, str]:
    """{observed date: name} for federal holidays observed in calendar `year`."""
    return dict(sorted(_observed_map(year).items()))


def is_federal_holiday(d: DateLike) -> bool:
    d = as_date(d)
    return d in _observed_map(d.year)


def is_weekend(d: DateLike) -> bool:
    return as_date(d).weekday() >= 5


def is_business_day(d: DateLike) -> bool:
    d = as_date(d)
    return d.weekday() < 5 and d not in _observed_map(d.year)


def next_business_day(d: DateLike) -> date:
    """The first federal business day STRICTLY after d."""
    d = as_date(d) + timedelta(days=1)
    while not is_business_day(d):
        d += timedelta(days=1)
    return d


def prev_business_day(d: DateLike) -> date:
    """The last federal business day STRICTLY before d."""
    d = as_date(d) - timedelta(days=1)
    while not is_business_day(d):
        d -= timedelta(days=1)
    return d


def add_business_days(d: DateLike, n: int) -> date:
    d = as_date(d)
    step = next_business_day if n >= 0 else prev_business_day
    for _ in range(abs(n)):
        d = step(d)
    return d


def on_or_after_business_day(d: DateLike) -> date:
    d = as_date(d)
    return d if is_business_day(d) else next_business_day(d)


# ─────────────────────────────── ET <-> UTC ─────────────────────────────────


def _parse_hhmm(t) -> time:
    if isinstance(t, time):
        return t
    m = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", str(t).strip())
    if not m:
        raise ValueError(f"not a HH:MM time: {t!r}")
    return time(int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


def et_to_utc(d: DateLike, hhmm="00:00") -> int:
    """Wall-clock ET on date d -> unix seconds UTC (DST handled by zoneinfo)."""
    local = datetime.combine(as_date(d), _parse_hhmm(hhmm), tzinfo=ET)
    return int(local.timestamp())


def utc_to_et(ts: Union[int, float]) -> datetime:
    """unix seconds UTC -> aware datetime in America/New_York. Epoch arithmetic, not
    fromtimestamp: Windows' C runtime refuses negative (pre-1970) timestamps."""
    return (_EPOCH + timedelta(seconds=ts)).astimezone(ET)


def et_date(ts: Union[int, float]) -> date:
    return utc_to_et(ts).date()


def utc_ts(dt: datetime) -> int:
    if dt.tzinfo is None:
        raise ValueError("naive datetime -- attach a timezone")
    return int(dt.timestamp())


def iso(d: DateLike) -> str:
    return as_date(d).isoformat()
