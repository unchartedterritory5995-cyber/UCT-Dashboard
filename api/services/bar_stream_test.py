"""Unit tests for bar_stream parsing and subscription queue."""
import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from api.services.bar_stream import (
    parse_am_event,
    parse_aggregate_event,
    _build_subscribe_message,
    BarStreamClient,
)


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


@pytest.mark.asyncio
async def test_run_websocket_auth_failure_triggers_hard_backoff(monkeypatch):
    """Auth-fail must NOT reconnect immediately — 60s hard backoff prevents DOS."""
    from api.services import bar_stream

    monkeypatch.setattr(bar_stream, "_API_KEY", "fake-key")

    # ws mock: recv returns auth_failed frame
    ws_mock = AsyncMock()
    ws_mock.send = AsyncMock()
    ws_mock.recv = AsyncMock(return_value='[{"ev":"status","status":"auth_failed","message":"bad key"}]')

    # async context manager wrapping ws_mock
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=ws_mock)
    cm.__aexit__ = AsyncMock(return_value=False)

    fake_websockets = MagicMock()
    fake_websockets.connect = MagicMock(return_value=cm)

    sleep_calls = []

    async def fake_sleep(seconds):
        sleep_calls.append(seconds)
        if 60 in sleep_calls:
            # Hard backoff observed — break the infinite reconnect loop
            raise asyncio.CancelledError()

    with patch.dict("sys.modules", {"websockets": fake_websockets}), \
         patch("api.services.bar_stream.asyncio.sleep", fake_sleep):
        with pytest.raises(asyncio.CancelledError):
            await bar_stream._run_websocket(on_bar=lambda s, b, k: None)

    assert 60 in sleep_calls, f"Expected 60s hard backoff, got sleeps: {sleep_calls}"


# ── Phase 4.5: parse_aggregate_event + subscribe channel tests ───────────────

def test_parse_aggregate_event_returns_kind_AM_for_AM_events():
    raw = {
        "ev": "AM", "sym": "AAPL",
        "o": 150.10, "h": 150.55, "l": 149.95, "c": 150.40,
        "v": 12500, "s": 1746468600000, "e": 1746468660000,
    }
    out = parse_aggregate_event(raw)
    assert out is not None
    assert out["kind"] == "AM"
    assert out["sym"] == "AAPL"
    assert out["bar"]["t"] == 1746468600000
    assert out["bar"]["o"] == 150.10
    assert out["bar"]["v"] == 12500


def test_parse_aggregate_event_returns_kind_A_for_A_events():
    raw = {
        "ev": "A", "sym": "AAPL",
        "o": 150.10, "h": 150.55, "l": 149.95, "c": 150.40,
        "v": 100, "s": 1746468601000, "e": 1746468602000,
    }
    out = parse_aggregate_event(raw)
    assert out is not None
    assert out["kind"] == "A"
    assert out["sym"] == "AAPL"
    assert out["bar"]["t"] == 1746468601000
    assert out["bar"]["v"] == 100


def test_parse_aggregate_event_rejects_non_aggregate_events():
    assert parse_aggregate_event({"ev": "status", "status": "auth_success"}) is None
    assert parse_aggregate_event({"ev": "T", "sym": "AAPL", "p": 150.0}) is None
    assert parse_aggregate_event({"ev": "Q", "sym": "AAPL"}) is None
    assert parse_aggregate_event({}) is None
    assert parse_aggregate_event(None) is None  # type: ignore[arg-type]


def test_subscribe_message_includes_both_AM_and_A_channels():
    msg = _build_subscribe_message(["AAPL", "MSFT"])
    payload = json.loads(msg)
    assert payload["action"] == "subscribe"
    params = payload["params"]
    # Both AM and A channels must be present for each symbol
    assert "AM.AAPL" in params
    assert "A.AAPL" in params
    assert "AM.MSFT" in params
    assert "A.MSFT" in params
