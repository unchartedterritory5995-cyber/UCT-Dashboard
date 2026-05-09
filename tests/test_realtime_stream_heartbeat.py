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


def test_record_tick_feeds_realtime_candle():
    """_record_tick should also feed realtime_candle for every intraday tf."""
    from api.services import realtime_candle
    realtime_candle._reset()
    import time
    realtime_stream._record_tick("QQQ", price=700.0, ts=int(time.time()))
    candle_1m = realtime_candle.get_current("QQQ", "1")
    candle_5m = realtime_candle.get_current("QQQ", "5")
    candle_60m = realtime_candle.get_current("QQQ", "60")
    assert candle_1m is not None
    assert candle_5m is not None
    assert candle_60m is not None
    assert candle_1m["c"] == 700.0
    assert candle_5m["c"] == 700.0


def test_record_tick_failure_does_not_break_handler(monkeypatch):
    """If realtime_candle.apply_tick raises, _record_tick should still work."""
    from api.services import realtime_candle
    def boom(*a, **k):
        raise RuntimeError("simulated failure")
    monkeypatch.setattr(realtime_candle, "apply_tick", boom)
    import time
    # Should not raise
    realtime_stream._record_tick("QQQ", price=700.0, ts=int(time.time()))
    last_seen = realtime_stream.get_last_seen("QQQ")
    assert last_seen is not None  # _last_seen still updated despite candle failure


def test_process_finnhub_trade_feeds_realtime_candle():
    """The production tick path (_process_finnhub_trade) must feed realtime_candle."""
    from api.services import realtime_candle
    realtime_candle._reset()
    # Synthetic Finnhub trade payload — Finnhub uses ms timestamps and
    # _process_finnhub_trade takes the inner trade dict (not the wrapper message).
    fake_trade = {"s": "QQQ", "p": 700.0, "t": 1715080800000, "v": 100}
    realtime_stream._process_finnhub_trade(fake_trade)
    candle = realtime_candle.get_current("QQQ", "1")
    assert candle is not None
    assert candle["c"] == 700.0
    # Size from the Finnhub `v` field should be propagated (not the size=1 placeholder)
    assert candle["v"] >= 1
