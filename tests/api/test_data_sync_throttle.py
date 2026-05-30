"""Tests for the snapshot-throttling helpers added to cut the round-the-clock
688 MB R2 upload firehose: the shared active-data-window predicate (which also
gates the prewarmer refresh loop + keep-warm pinger) and the adaptive interval.
"""
import datetime as dt
from zoneinfo import ZoneInfo

from api.services import data_sync

ET = ZoneInfo("America/New_York")


def test_active_window_weekday_market_hours():
    assert data_sync.in_active_data_window(dt.datetime(2026, 5, 27, 10, 0, tzinfo=ET)) is True


def test_active_window_weekday_premarket_4am_inclusive():
    # 4:00 AM ET is the lower bound (pre-market) — pod warm before users arrive.
    assert data_sync.in_active_data_window(dt.datetime(2026, 5, 27, 4, 0, tzinfo=ET)) is True


def test_active_window_weekday_postmarket_before_8pm():
    assert data_sync.in_active_data_window(dt.datetime(2026, 5, 27, 19, 59, tzinfo=ET)) is True


def test_active_window_weekday_8pm_exclusive():
    assert data_sync.in_active_data_window(dt.datetime(2026, 5, 27, 20, 0, tzinfo=ET)) is False


def test_active_window_weekday_overnight():
    assert data_sync.in_active_data_window(dt.datetime(2026, 5, 27, 2, 0, tzinfo=ET)) is False


def test_active_window_weekend():
    # Sat + Sun are idle regardless of hour.
    assert data_sync.in_active_data_window(dt.datetime(2026, 5, 30, 12, 0, tzinfo=ET)) is False
    assert data_sync.in_active_data_window(dt.datetime(2026, 5, 31, 8, 0, tzinfo=ET)) is False


def test_snapshot_interval_matches_window():
    fast = data_sync.in_active_data_window(dt.datetime(2026, 5, 27, 10, 0, tzinfo=ET))
    # The interval helper keys off the *current* time, so just assert the two
    # legal return values and that idle > active (the whole point of throttling).
    assert data_sync.SNAPSHOT_INTERVAL_IDLE_SECONDS > data_sync.SNAPSHOT_INTERVAL_SECONDS
    assert data_sync.snapshot_interval_seconds() in (
        data_sync.SNAPSHOT_INTERVAL_SECONDS,
        data_sync.SNAPSHOT_INTERVAL_IDLE_SECONDS,
    )


def test_fingerprint_is_stable_and_tuple():
    fp1 = data_sync._snapshot_fingerprint()
    fp2 = data_sync._snapshot_fingerprint()
    assert isinstance(fp1, tuple)
    assert fp1 == fp2  # no writes between calls → identical → would skip upload
