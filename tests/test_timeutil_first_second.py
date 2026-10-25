"""Task 10.7 fix round 1 (m-4): the one ET-day authority and the first second of a UTC day.

Only a bare date, or an EXACT UTC midnight with no fraction (how manual and CSV entries store a date
with no time, `trades.py`, `csv_import.py`), is date-only. A server stamp carries microseconds, so
one made at 20:00:00.123 ET (00:00:00.123 UTC) is that ET evening, at 20:00.
"""
from __future__ import annotations

import pytest

from api.services.journal_two.timeutil import compute_hour_et, compute_trading_day_et


@pytest.mark.parametrize("iso,day,hour", [
    ("2026-10-28", "2026-10-28", None),                        # bare date: date-only
    ("2026-10-28T00:00:00Z", "2026-10-28", None),              # the stored date-only form
    ("2026-10-28T00:00:00+00:00", "2026-10-28", None),         # the other stored form
    ("2026-10-28T00:00:00.123456Z", "2026-10-27", 20),         # a server stamp: 20:00 ET Oct 27
    ("2026-10-28T00:00:00.123456+00:00", "2026-10-27", 20),
    ("2026-10-27T23:59:59-04:00", "2026-10-27", 23),           # an offset stamp, as typed
    ("2026-12-01T00:00:00.5+00:00", "2026-11-30", 19),         # EST: 19:00 ET
])
def test_the_first_second_of_a_utc_day(iso, day, hour):
    assert compute_trading_day_et(iso) == day, iso
    assert compute_hour_et(iso) == hour, iso
