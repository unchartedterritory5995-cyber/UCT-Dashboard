"""Regression test for the 2026-08-05 cache-poison sweep: `run_miss_retry()`
existed but had NO scheduler entry, so a ticker logo that failed once during
a transient provider blip stayed a monogram for its full retry window (up to
7 days for a genuine miss) even after the source recovered -- nothing was
ever calling the retry pass. This proves the job is actually wired in.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import api.main as m

_ET = ZoneInfo("America/New_York")


class _FakeSched:
    def __init__(self):
        self.jobs = []

    def add_job(self, func, *a, **kw):
        self.jobs.append((func, a, kw))


def _registered():
    sched = _FakeSched()
    assert m.register_logo_miss_retry_job(sched) is True
    assert len(sched.jobs) == 1
    return sched.jobs[0]


def test_logo_miss_retry_job_is_registered_under_a_stable_id():
    _func, _a, kw = _registered()
    assert kw["id"] == "logo_miss_retry"
    assert kw["replace_existing"] is True
    assert kw["max_instances"] == 1


def test_logo_miss_retry_job_actually_calls_run_miss_retry(monkeypatch):
    """Not just registered -- the wired callable must reach
    ticker_logos.run_miss_retry(), the function this whole task is about."""
    from api.services import ticker_logos
    calls = {"n": 0}
    monkeypatch.setattr(ticker_logos, "run_miss_retry",
                        lambda: calls.__setitem__("n", calls["n"] + 1) or {"total": 0})
    func, _a, _kw = _registered()
    func()
    assert calls["n"] == 1


def test_logo_miss_retry_job_can_be_disabled(monkeypatch):
    monkeypatch.setenv("LOGO_MISS_RETRY_ENABLED", "0")
    sched = _FakeSched()
    assert m.register_logo_miss_retry_job(sched) is False
    assert sched.jobs == []


def test_logo_miss_retry_cron_fires_at_0325_et_daily():
    """`timezone=_ET` is load-bearing (lesson_apscheduler_cron_utc_trap) -- a
    naive/UTC cron passes structural checks and then runs an hour off for
    half the year."""
    _f, _a, kw = _registered()
    trig = kw["trigger"]

    summer = trig.get_next_fire_time(None, datetime(2026, 8, 3, 12, 0, tzinfo=_ET))
    assert (summer.hour, summer.minute) == (3, 25)
    assert summer.tzinfo.key == "America/New_York"

    winter = trig.get_next_fire_time(None, datetime(2026, 1, 5, 12, 0, tzinfo=_ET))
    assert (winter.hour, winter.minute) == (3, 25)
