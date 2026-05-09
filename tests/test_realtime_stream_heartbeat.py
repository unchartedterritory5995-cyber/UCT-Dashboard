import time
from unittest.mock import patch

from api.services import realtime_stream


def setup_function(fn):
    """Reset module state between tests."""
    with realtime_stream._lock:
        realtime_stream._last_seen.clear()


def test_record_tick_updates_last_seen():
    """Calling _record_tick should populate _last_seen for the ticker."""
    realtime_stream._record_tick("QQQ", price=700.0, ts=int(time.time()))
    last_seen = realtime_stream.get_last_seen("QQQ")
    assert last_seen is not None
    assert int(time.time()) - last_seen <= 1


def test_get_last_seen_uppercases():
    realtime_stream._record_tick("qqq", price=700.0, ts=1700000000)
    assert realtime_stream.get_last_seen("QQQ") == 1700000000
    assert realtime_stream.get_last_seen("qqq") == 1700000000


def test_get_last_seen_unknown_ticker():
    assert realtime_stream.get_last_seen("ZZZZZ") is None


def test_get_last_seen_ages():
    now = int(time.time())
    realtime_stream._record_tick("QQQ", price=700.0, ts=now - 5)
    realtime_stream._record_tick("SPY", price=730.0, ts=now - 10)
    ages = realtime_stream.get_last_seen_ages(now=now)
    assert ages.get("QQQ") == 5
    assert ages.get("SPY") == 10


def test_stream_status_includes_last_seen_ages():
    realtime_stream._record_tick("QQQ", price=700.0, ts=int(time.time()))
    status = realtime_stream.get_stream_status()
    assert "last_seen_ages" in status
    assert isinstance(status["last_seen_ages"], dict)
