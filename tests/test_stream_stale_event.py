from unittest.mock import patch

from api.routers import stream


def test_build_stale_events_flags_stale_ticker():
    """When is_stale is True for a subscribed ticker, emit a stale event."""
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=1715000000), \
         patch("api.routers.stream.bars_liveness.is_stale", return_value=True):
        events = stream._build_stale_events(["QQQ"], now=1715001000)
        assert len(events) == 1
        assert events[0]["type"] == "stale"
        assert events[0]["sym"] == "QQQ"
        assert events[0]["last_seen"] == 1715000000


def test_build_stale_events_skips_fresh_ticker():
    """When is_stale is False, no event emitted."""
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=1715001000), \
         patch("api.routers.stream.bars_liveness.is_stale", return_value=False):
        events = stream._build_stale_events(["QQQ"], now=1715001000)
        assert events == []


def test_build_stale_events_skips_ticker_with_no_last_seen():
    """A ticker that's never had a tick (last_seen = None) shouldn't emit stale."""
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=None), \
         patch("api.routers.stream.bars_liveness.is_stale", return_value=True):
        events = stream._build_stale_events(["QQQ"], now=1715001000)
        assert events == []


def test_build_stale_events_handles_multiple_tickers():
    """Mix of stale and fresh — only stale ones emit events."""
    def fake_last_seen(sym):
        return {"QQQ": 1715000000, "SPY": 1715001000}.get(sym.upper())

    def fake_is_stale(last_bar_time, tf, market_open=None):
        return last_bar_time == 1715000000  # only QQQ is stale

    with patch("api.routers.stream.realtime_stream.get_last_seen", side_effect=fake_last_seen), \
         patch("api.routers.stream.bars_liveness.is_stale", side_effect=fake_is_stale):
        events = stream._build_stale_events(["QQQ", "SPY"], now=1715001000)
        assert len(events) == 1
        assert events[0]["sym"] == "QQQ"
