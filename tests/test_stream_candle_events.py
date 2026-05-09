from unittest.mock import patch
from api.routers import stream


def test_build_candle_events_emits_tick_on_price_change():
    """When candle has new price/vol vs last seen state, emit a tick event."""
    cur = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000, "last_tick_ts": 1715080805}
    last_state = {"QQQ": (1715080800, 700.0, 1000000)}  # different price/vol
    with patch("api.routers.stream.realtime_candle.get_current", return_value=cur):
        events = stream._build_candle_events(["QQQ"], last_state)
    tick_events = [e for e in events if e["type"] == "tick"]
    assert len(tick_events) == 1
    assert tick_events[0]["sym"] == "QQQ"
    assert tick_events[0]["price"] == 702.5


def test_build_candle_events_emits_bar_close_on_t_advance():
    """When candle's t advanced, emit a bar_close for the prior bar."""
    cur = {"t": 1715080860, "o": 705, "h": 705, "l": 705, "c": 705, "v": 1000}
    last_state = {"QQQ": (1715080800, 702.5, 1500000)}  # prior bar's t
    with patch("api.routers.stream.realtime_candle.get_current", return_value=cur):
        events = stream._build_candle_events(["QQQ"], last_state)
    close_events = [e for e in events if e["type"] == "bar_close"]
    assert len(close_events) == 1
    assert close_events[0]["sym"] == "QQQ"


def test_build_candle_events_emits_nothing_when_unchanged():
    cur = {"t": 1715080800, "c": 702.5, "v": 1500000}
    last_state = {"QQQ": (1715080800, 702.5, 1500000)}
    with patch("api.routers.stream.realtime_candle.get_current", return_value=cur):
        events = stream._build_candle_events(["QQQ"], last_state)
    assert events == []


def test_build_candle_events_handles_no_candle():
    """Ticker with no candle yet — no events."""
    with patch("api.routers.stream.realtime_candle.get_current", return_value=None):
        events = stream._build_candle_events(["QQQ"], {})
    assert events == []


def test_build_candle_events_updates_last_state():
    """The helper updates last_state in place so caller can track transitions."""
    cur = {"t": 1715080800, "c": 702.5, "v": 1500000}
    last_state = {}
    with patch("api.routers.stream.realtime_candle.get_current", return_value=cur):
        stream._build_candle_events(["QQQ"], last_state)
    assert last_state.get("QQQ") == (1715080800, 702.5, 1500000)
