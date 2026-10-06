"""The scheduled Market Cap refresh runs AFTER the session it must append becomes due (owner approval 2026-10-06:
06:15 ET Tue-Sat; the finality boundary stays D+1 06:00 ET). Fires come from APScheduler's real CronTrigger in
America/New_York, across both 2026 DST transitions."""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from api.services.marketcap import currentness as CU, schedule as SCH

ET = ZoneInfo("America/New_York")


def _fires(start: datetime, n: int):
    from apscheduler.triggers.cron import CronTrigger
    hh, mm = SCH._cron()
    trig = CronTrigger(day_of_week="tue-sat", hour=hh, minute=mm, timezone="America/New_York")
    out, prev, now = [], None, start
    for _ in range(n):
        nxt = trig.get_next_fire_time(prev, now)
        out.append(nxt)
        prev, now = nxt, nxt + timedelta(seconds=1)
    return out


def _previous_session(fire: datetime):
    S = CU._cal()
    d = fire.astimezone(ET).date() - timedelta(days=1)
    while not S.is_trading_day(d):
        d -= timedelta(days=1)
    return d


@pytest.mark.parametrize("start", [datetime(2026, 3, 1, tzinfo=ET), datetime(2026, 10, 20, tzinfo=ET)])   # both DST edges
def test_every_scheduled_run_sees_the_just_closed_session_due(monkeypatch, start):
    monkeypatch.delenv("MCAP_PIT_REFRESH_CRON_ET", raising=False)
    assert SCH._cron() == (6, 15) and CU.DUE_ET == "06:00"
    for f in _fires(start, 40):
        assert f.astimezone(ET).weekday() in (1, 2, 3, 4, 5) and (f.astimezone(ET).hour, f.astimezone(ET).minute) == (6, 15)
        d = _previous_session(f)
        assert f >= CU._due(d), (f, d)                                    # after the due boundary
        assert CU.expected_session(f) == d, (f, d)                        # the run's target is the just-closed session


def test_the_old_0115_schedule_could_never_append_the_just_closed_session(monkeypatch):
    monkeypatch.setenv("MCAP_PIT_REFRESH_CRON_ET", "01:15")
    f = _fires(datetime(2026, 10, 6, 12, 0, tzinfo=ET), 1)[0]             # Wed 2026-10-07 01:15 ET
    assert f < CU._due(_previous_session(f)) and CU.expected_session(f) != _previous_session(f)
    assert not SCH.cron_after_due()


def test_a_run_time_before_the_due_boundary_registers_nothing(monkeypatch):
    monkeypatch.setenv("MCAP_PIT_REFRESH_CRON_ET", "05:59")

    class S:
        jobs = []

        def add_job(self, *a, **k):
            self.jobs.append(k.get("id"))
    s = S()
    assert SCH.register(s) == [] and s.jobs == []
    monkeypatch.setenv("MCAP_PIT_REFRESH_CRON_ET", "06:15")
    assert SCH.register(s) == [SCH.JOB_ID] and s.jobs == [SCH.JOB_ID]
