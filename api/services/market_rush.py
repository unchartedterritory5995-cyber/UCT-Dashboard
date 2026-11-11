"""Keep heavy background work out of the market's opening and closing rush
(desktop speed plan Step 10.5).

MEASURED 2026-11-11 (the Wednesday measurement window, api/services/measurement_window.py):
`company_news_percompany` ran 09:38:58-09:45:28 ET, 390 s wall and 42.5 s of the web
process's CPU, inside the minutes members load every page after the open, on the same pod
that answers them. It runs every 20 minutes and takes 6-8 minutes; news coverage minutes
late costs nobody anything, a slow app at 09:30 costs every member.

So a heavy job asks `should_wait(now, expected_minutes)` before it starts, and skips that
run when it would START inside a rush or within its own expected length before one. The
next interval runs it after the rush. Time-critical jobs (breaking news, live data) do not
ask: only work whose value does not depend on the minute.

The rush windows are the deploy freeze's (tools/deploy_freeze.py BURST_WINDOWS_ET, the
times a deploy may not restart the pod). They are restated here because api/ cannot import
tools/; tests/test_market_rush.py fails if the two ever disagree.
"""
from __future__ import annotations

import datetime as _dt
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

#: Weekday rushes, ET wall clock, half-open [start, end). Same as the deploy freeze.
RUSH_WINDOWS_ET = (("opening", (9, 20), (9, 45)), ("closing", (15, 30), (16, 15)))


def _minutes(hm: tuple[int, int]) -> int:
    return hm[0] * 60 + hm[1]


def should_wait(now: _dt.datetime, expected_minutes: float) -> str | None:
    """The rush a job starting `now` and running `expected_minutes` would overlap, or None.

    Weekends never wait. A naive `now` is read as ET."""
    et = now.astimezone(_ET) if now.tzinfo else now.replace(tzinfo=_ET)
    if et.weekday() >= 5:
        return None
    start = et.hour * 60 + et.minute + et.second / 60
    end = start + max(0.0, float(expected_minutes))
    for name, a, b in RUSH_WINDOWS_ET:
        if start < _minutes(b) and end > _minutes(a):
            return name
    return None
