"""FINNHUB_STREAM_ENABLED: the switch for the Finnhub trade socket (api/services/realtime_stream.py).

A kill switch, default ON: unset keeps the behaviour before it existed. Off, `start_stream` opens no
connection and starts no thread, and the status says the socket is off by setting, which is not a
fault. The gate sits at the startup entry point, before the local-run guard, never inside the
reconnect loop.
"""
import logging
import threading

import pytest

from api.services import realtime_stream as rs


@pytest.fixture()
def no_thread(monkeypatch):
    """Record a thread start instead of starting one; a local run is treated as production."""
    started = []

    class _Thread:
        def __init__(self, *a, **k):
            self.name = k.get("name")

        def start(self):
            started.append(self.name)

    monkeypatch.setattr(threading, "Thread", _Thread)
    from api.services import vendor_socket_guard
    asked = []
    monkeypatch.setattr(vendor_socket_guard, "refuse_if_local", lambda name: asked.append(name) or False)
    return started, asked


@pytest.mark.parametrize("value", [None, "", "1", "true", "yes", "on", "anything"])
def test_unset_or_any_other_word_is_ON(monkeypatch, no_thread, value):
    started, asked = no_thread
    if value is None:
        monkeypatch.delenv("FINNHUB_STREAM_ENABLED", raising=False)
    else:
        monkeypatch.setenv("FINNHUB_STREAM_ENABLED", value)
    assert rs.stream_enabled() is True
    rs.start_stream()
    assert started == ["realtime-stream"]
    assert asked == ["finnhub"]


@pytest.mark.parametrize("value", ["0", "false", "no", "off", " OFF ", "False", "No"])
def test_an_off_word_opens_no_connection_and_starts_no_thread(monkeypatch, no_thread, caplog, value):
    started, asked = no_thread
    monkeypatch.setenv("FINNHUB_STREAM_ENABLED", value)
    assert rs.stream_enabled() is False
    with caplog.at_level(logging.INFO):
        rs.start_stream()
    assert started == []
    # decided before the local-run guard is even asked: the switch is the first question
    assert asked == []
    said = [r.getMessage() for r in caplog.records if "switched off" in r.getMessage()]
    assert len(said) == 1 and "FINNHUB_STREAM_ENABLED" in said[0]


def test_the_status_says_off_by_setting(monkeypatch):
    monkeypatch.setenv("FINNHUB_STREAM_ENABLED", "0")
    off = rs.get_stream_status()
    assert off["enabled"] is False
    monkeypatch.delenv("FINNHUB_STREAM_ENABLED")
    on = rs.get_stream_status()
    assert on["enabled"] is True
    # additive: every key a reader had before is still there
    assert {"connected", "provider", "subscribed_count", "prices_cached", "subscribed_tickers", "last_seen_ages"} <= set(on)


def test_the_gate_is_at_the_entry_point_not_in_the_reconnect_loop():
    import inspect
    assert "stream_enabled()" in inspect.getsource(rs.start_stream)
    assert "stream_enabled" not in inspect.getsource(rs._run_websocket)
