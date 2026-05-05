"""Unit tests for bar_stream parsing and subscription queue."""
import pytest

from api.services.bar_stream import parse_am_event, BarStreamClient


def test_parse_am_event_extracts_ohlcv_and_symbol():
    # Massive/Polygon AM event shape (camel-compatible with Polygon docs):
    # ev=event type, sym=symbol, o/h/l/c=OHLC, v=volume in this minute,
    # s=start of aggregate (ms), e=end of aggregate (ms)
    raw = {
        "ev": "AM", "sym": "AAPL",
        "o": 150.10, "h": 150.55, "l": 149.95, "c": 150.40,
        "v": 12500, "s": 1746468600000, "e": 1746468660000,
    }
    out = parse_am_event(raw)
    assert out == {
        "sym": "AAPL",
        "bar": {"t": 1746468600000, "o": 150.10, "h": 150.55, "l": 149.95, "c": 150.40, "v": 12500},
    }


def test_parse_am_event_returns_none_on_non_am():
    # Status / other event types must be filtered out at the parse layer
    assert parse_am_event({"ev": "status", "status": "auth_success"}) is None
    assert parse_am_event({"ev": "T", "sym": "AAPL", "p": 150.0}) is None  # trade tick


def test_parse_am_event_returns_none_on_missing_fields():
    assert parse_am_event({"ev": "AM", "sym": "AAPL"}) is None  # missing OHLCV


def test_parse_am_event_v_zero_is_valid():
    # v=0 is a legitimate AM event (quiet minute with no trades) — must NOT return None
    raw = {
        "ev": "AM", "sym": "QUIET",
        "o": 100.0, "h": 100.0, "l": 100.0, "c": 100.0,
        "v": 0, "s": 1746468600000, "e": 1746468660000,
    }
    out = parse_am_event(raw)
    assert out is not None
    assert out["bar"]["v"] == 0


def test_queue_subscribe_adds_to_active_and_pending():
    c = BarStreamClient()
    c.queue_subscribe(["AAPL", "msft"])  # mixed-case input must be uppercased
    assert c.active == {"AAPL", "MSFT"}
    assert c.pending_subscribe == {"AAPL", "MSFT"}
    assert c.pending_unsubscribe == set()


def test_queue_subscribe_does_not_re_add_existing():
    c = BarStreamClient()
    c.queue_subscribe(["AAPL"])
    c.pending_subscribe.clear()  # simulate "we already sent the SUB on the wire"
    c.queue_subscribe(["AAPL"])  # idempotent re-add
    assert c.pending_subscribe == set()


def test_queue_unsubscribe_removes_from_active():
    c = BarStreamClient()
    c.queue_subscribe(["AAPL", "MSFT"])
    c.pending_subscribe.clear()
    c.queue_unsubscribe(["AAPL"])
    assert c.active == {"MSFT"}
    assert c.pending_unsubscribe == {"AAPL"}


def test_queue_unsubscribe_then_resubscribe_cancels_unsub():
    c = BarStreamClient()
    c.queue_subscribe(["AAPL"])
    c.pending_subscribe.clear()
    c.queue_unsubscribe(["AAPL"])
    c.queue_subscribe(["AAPL"])
    assert "AAPL" in c.active
    assert c.pending_unsubscribe == set()    # canceled
    assert c.pending_subscribe == {"AAPL"}    # re-queued
