"""Tests for the catalyst read-triggered self-heal decision (_self_heal_due)."""
import datetime as dt
from zoneinfo import ZoneInfo

from api.routers.catalysts import (
    _self_heal_due, _AUTO_REFRESH_COOLDOWN_SECONDS, _STALE_HEAL_SECONDS,
)

_ET = ZoneInfo("America/New_York")


def _wed_morning(hour=7):
    # 2026-06-10 is a Wednesday.
    return dt.datetime(2026, 6, 10, hour, 0, tzinfo=_ET)


def test_heals_when_empty_weekday_morning_past_cooldown():
    assert _self_heal_due(False, None, _wed_morning(7),
                          last_refresh_at=0.0, now=10_000.0) is True


def test_no_heal_when_fresh_ranked_rows_exist():
    # Ranked rows present and only 5 min old → not stale → no heal.
    fresh_age = 5 * 60
    assert _self_heal_due(True, fresh_age, _wed_morning(7), 0.0, 10_000.0) is False


def test_heals_when_ranked_but_stale():
    # The fix: ranked rows present but older than the stale threshold → heal
    # (recovers a missed cron / mid-morning redeploy).
    stale_age = _STALE_HEAL_SECONDS + 60
    assert _self_heal_due(True, stale_age, _wed_morning(11), 0.0, 10_000.0) is True


def test_no_heal_just_under_stale_threshold():
    assert _self_heal_due(True, _STALE_HEAL_SECONDS - 60, _wed_morning(11),
                          0.0, 10_000.0) is False


def test_no_heal_before_6am():
    assert _self_heal_due(False, None, _wed_morning(5), 0.0, 10_000.0) is False


def test_no_heal_after_8pm():
    assert _self_heal_due(False, None, _wed_morning(20), 0.0, 10_000.0) is False


def test_no_heal_on_weekend():
    sat = dt.datetime(2026, 6, 13, 8, 0, tzinfo=_ET)  # Saturday
    assert _self_heal_due(False, None, sat, 0.0, 10_000.0) is False


def test_no_heal_within_cooldown():
    now = 10_000.0
    recent = now - (_AUTO_REFRESH_COOLDOWN_SECONDS - 1)
    # Even a stale board waits out the cooldown so we don't stampede the engine.
    assert _self_heal_due(True, _STALE_HEAL_SECONDS + 999, _wed_morning(11),
                          recent, now) is False
