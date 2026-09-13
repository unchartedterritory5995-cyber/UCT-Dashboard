"""Eastern-time helpers and the session calendar (docs/wisdom/CONTRACTS.md §2.4).

The holiday authority is api/services/bars_fetch._NYSE_HOLIDAYS_YYYYMMDD, read
through its own function and never copied. That table covers 2025–2027 only;
holiday_table_covers() lets historical code say "holiday-awareness unknown"
instead of silently treating an old holiday as a session.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
MARKET_OPEN = time(9, 30)


def now_et() -> datetime:
    return datetime.now(ET)


def to_et(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=ET)
    return dt.astimezone(ET)


def iso_et(dt: datetime) -> str:
    return to_et(dt).isoformat(timespec="seconds")


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return to_et(datetime.fromisoformat(str(value)))
    except ValueError:
        return None


def holiday_table_covers(d: date) -> bool:
    return 2025 <= d.year <= 2027


def is_trading_day(d: date) -> bool:
    if d.weekday() >= 5:
        return False
    from api.services.bars_fetch import _is_nyse_holiday

    return not _is_nyse_holiday(int(d.strftime("%Y%m%d")))


def previous_session(d: date) -> date:
    cur = d - timedelta(days=1)
    for _ in range(14):
        if is_trading_day(cur):
            return cur
        cur -= timedelta(days=1)
    return cur


def session_for(dt: datetime) -> date:
    """The session a statement at `dt` belongs to: pre-open and non-trading-day
    statements belong to the previous session (W1 §6.1)."""
    et = to_et(dt)
    d = et.date()
    if not is_trading_day(d) or et.time() < MARKET_OPEN:
        return previous_session(d)
    return d


def non_trading_days_between(start: date, end: date) -> int:
    count, cur = 0, start + timedelta(days=1)
    while cur <= end:
        if not is_trading_day(cur):
            count += 1
        cur += timedelta(days=1)
    return count
