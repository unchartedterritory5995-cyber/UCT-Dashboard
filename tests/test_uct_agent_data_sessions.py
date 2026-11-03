"""agent-qa F-23 (owner agent-md): the most recent COMPLETED session counts a half day from ITS OWN close (13:00 ET),
not 16:00, and is otherwise exactly bars_fetch's answer. Real NYSE calendar; explicit clocks; no wall clock."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch
from api.services.uct_agent.marketdata.sessions import last_completed_session

ET = ZoneInfo("America/New_York")


def _at(ymd: str, h: int, m: int) -> datetime:
    y, mo, d = map(int, ymd.split("-"))
    return datetime(y, mo, d, h, m, tzinfo=ET)


@pytest.mark.parametrize("ymd,hm,want", [
    ("2026-11-27", (12, 59), 20261125),   # half day before its close: the prior session (11-26 is Thanksgiving)
    ("2026-11-27", (13, 0), 20261127),    # F-23: the half day IS completed at 13:00 …
    ("2026-11-27", (15, 30), 20261127),   # … and through 16:00, where bars_fetch still says 11-25
    ("2026-11-27", (16, 0), 20261127),
    ("2026-12-24", (13, 5), 20261224),    # Christmas Eve half day
    ("2026-11-02", (15, 59), 20261030),   # a full day before 16:00: the prior session (Fri)
    ("2026-11-02", (16, 0), 20261102),
    ("2026-10-31", (12, 0), 20261030),    # Saturday
    ("2026-11-26", (17, 0), 20261125),    # a holiday
])
def test_last_completed_session(ymd, hm, want):
    assert last_completed_session(_at(ymd, *hm)) == want


def test_the_half_day_gap_was_real_in_bars_fetch_and_is_closed_here():
    t = _at("2026-11-27", 14, 0)
    assert bars_fetch._last_closed_session_yyyymmdd(now=t) == 20261125           # the F-23 behaviour, unchanged there
    assert last_completed_session(t) == 20261127


def test_an_unreadable_calendar_falls_back_to_bars_fetch(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_session_close_minutes", lambda ymd: (_ for _ in ()).throw(RuntimeError("x")))
    t = _at("2026-11-27", 14, 0)
    assert last_completed_session(t) == bars_fetch._last_closed_session_yyyymmdd(now=t)
