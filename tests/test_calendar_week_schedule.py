"""The Saturday firing itself — the one path that had never been exercised.

Everything else about this feature was verified through manual `post_week(
target='test')` calls. That leaves the part that actually runs unattended
completely untested: does the cron fire at 4:30 AM ET on a Saturday, does the
job target LIVE, and — the load-bearing assumption behind the whole design —
does a Saturday resolve to NEXT week via the live EarningsWhispers path rather
than to the week that just ended?
"""
from datetime import date, datetime
from unittest import mock
from zoneinfo import ZoneInfo

from apscheduler.triggers.cron import CronTrigger

from api.routers import calendar as cal
from api.services import calendar_week_poster as poster

_ET = ZoneInfo("America/New_York")


# ── The cron itself ──────────────────────────────────────────────────────────

def test_the_trigger_fires_saturday_0430_et_and_not_an_hour_off_in_winter():
    """Pinned to America/New_York, so it stays 4:30 LOCAL across the DST flip
    rather than drifting to 5:30 (lesson_apscheduler_cron_utc_trap)."""
    trig = CronTrigger(day_of_week="sat", hour=4, minute=30, timezone=_ET)

    # Mid-week in summer (EDT) -> the coming Saturday.
    nxt = trig.get_next_fire_time(None, datetime(2026, 7, 30, 12, 0, tzinfo=_ET))
    assert (nxt.year, nxt.month, nxt.day) == (2026, 8, 1)
    assert nxt.weekday() == 5 and (nxt.hour, nxt.minute) == (4, 30)
    assert nxt.tzinfo.key == "America/New_York"

    # And in winter (EST) it is still 4:30 local, not 3:30 or 5:30.
    win = trig.get_next_fire_time(None, datetime(2026, 1, 7, 12, 0, tzinfo=_ET))
    assert win.weekday() == 5 and (win.hour, win.minute) == (4, 30)


def test_a_saturday_run_lands_before_the_market_week_it_describes():
    """4:30 AM Saturday is ahead of the Monday it is announcing — the card must
    never describe a week that has already started trading."""
    trig = CronTrigger(day_of_week="sat", hour=4, minute=30, timezone=_ET)
    fire = trig.get_next_fire_time(None, datetime(2026, 7, 30, 12, 0, tzinfo=_ET))
    with mock.patch.object(cal, "_today_et", return_value=fire.date()):
        monday = cal._week_dates()[0]
    assert monday > fire.date()


# ── What a Saturday resolves to ──────────────────────────────────────────────

def test_saturday_resolves_to_next_week_not_the_one_that_just_ended():
    """The load-bearing assumption of the whole feature. Sat 2026-08-01 must
    resolve to Mon 2026-08-03, not back to Jul 27."""
    with mock.patch.object(cal, "_today_et", return_value=date(2026, 8, 1)):
        week = cal._week_dates()
    assert week[0] == date(2026, 8, 3)
    assert week[-1] == date(2026, 8, 7)


def test_sunday_resolves_to_the_same_week_as_saturday():
    """A retry or a manual run the next morning must not shift the target."""
    with mock.patch.object(cal, "_today_et", return_value=date(2026, 8, 2)):
        assert cal._week_dates()[0] == date(2026, 8, 3)


def test_saturday_builds_from_the_LIVE_path_so_the_rings_stay_attention_driven():
    """Because Saturday's `_week_dates()` IS next week, build_payloads takes the
    `monday == cur_monday` branch -> get_calendar() with NO week arg -> the live
    EarningsWhispers path, which is the only source carrying `ew` anticipation.
    Take the range branch instead and every ring falls back to raw size."""
    saturday, monday = date(2026, 8, 1), date(2026, 8, 3)
    seen = {}

    def _fake_get_calendar(week=None):
        seen["week_arg"] = week
        return {"days": {}}

    with mock.patch.object(cal, "_today_et", return_value=saturday), \
         mock.patch.object(cal, "get_calendar", side_effect=_fake_get_calendar), \
         mock.patch.object(cal, "get_day_metrics", return_value={}):
        poster.build_payloads(monday)

    assert seen["week_arg"] is None, (
        "a Saturday run must use the live EW path, not the range path")


# ── The job function ─────────────────────────────────────────────────────────

def test_the_scheduled_job_targets_LIVE(monkeypatch):
    monkeypatch.setenv("CALENDAR_WEEK_POST_ENABLED", "1")
    with mock.patch.object(poster, "post_week") as m:
        poster.run_scheduled_post()
    m.assert_called_once()
    assert m.call_args.kwargs.get("target") == "live"


def test_the_scheduled_job_is_inert_while_the_flag_is_off(monkeypatch):
    monkeypatch.delenv("CALENDAR_WEEK_POST_ENABLED", raising=False)
    with mock.patch.object(poster, "post_week") as m:
        poster.run_scheduled_post()
    m.assert_not_called()


def test_the_scheduler_block_is_registered_and_flag_gated():
    """The job body lives in main.py; a merge that drops the registration would
    leave every unit test above green while nothing ever fires."""
    import inspect
    import api.main as main
    src = inspect.getsource(main)
    assert 'id="calendar_week_post"' in src
    assert 'CALENDAR_WEEK_POST_ENABLED' in src
    assert 'day_of_week="sat", hour=4, minute=30, timezone=_ET' in src
    assert "run_scheduled_post" in src
