"""Tests for the catalyst read-triggered self-heal decision (_self_heal_due)."""
import datetime as dt
from zoneinfo import ZoneInfo

from api.routers.catalysts import _self_heal_due, _AUTO_REFRESH_COOLDOWN_SECONDS

_ET = ZoneInfo("America/New_York")


def _wed_morning(hour=7):
    # 2026-06-10 is a Wednesday.
    return dt.datetime(2026, 6, 10, hour, 0, tzinfo=_ET)


def test_heals_when_empty_weekday_morning_past_cooldown():
    assert _self_heal_due(False, _wed_morning(7), last_refresh_at=0.0, now=10_000.0) is True


def test_no_heal_when_ranked_rows_exist():
    assert _self_heal_due(True, _wed_morning(7), 0.0, 10_000.0) is False


def test_no_heal_before_6am():
    assert _self_heal_due(False, _wed_morning(5), 0.0, 10_000.0) is False


def test_no_heal_on_weekend():
    sat = dt.datetime(2026, 6, 13, 8, 0, tzinfo=_ET)  # Saturday
    assert _self_heal_due(False, sat, 0.0, 10_000.0) is False


def test_no_heal_within_cooldown():
    now = 10_000.0
    recent = now - (_AUTO_REFRESH_COOLDOWN_SECONDS - 1)
    assert _self_heal_due(False, _wed_morning(7), recent, now) is False
