"""`/api/stream/prices` and `/api/stream/bars` refuse at the subscriber cap.

⛔ THE GUARD IS THE ONLY THING UNDER TEST, SO THE CAP IS REACHED FOR REAL. These
two endpoints are the only sleep-polling SSE loops in the codebase and were the
only streams without admission control (`massive_stream` 300, `massive_curated_stream`
300, `chat_stream` 400 all had one). A test that asserted "the constant exists"
would stay green with the `if _token is None` deleted — so every case here drives
the handler and reads what it RETURNED.

⚠️ The handler is called directly rather than through `TestClient`: Starlette's
test client BUFFERS the response body, and these generators never end, so a
client-driven admitted case hangs forever and measures nothing.
"""
import asyncio

import pytest
from fastapi.responses import JSONResponse, StreamingResponse

from api.routers import stream


class _Req:
    """Enough Request for the handler's synchronous half — the generator (which
    is the only thing that touches `is_disconnected`) is never started."""

    async def is_disconnected(self):        # pragma: no cover — never reached
        return True


@pytest.fixture(autouse=True)
def clean_registry(monkeypatch):
    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    # /api/stream/bars reaches the broadcaster singleton before its generator
    # starts. Patched rather than `init_broadcaster()`d so this module cannot
    # install a process-wide singleton other tests would then inherit.
    from api.services import bar_broadcaster as bb
    monkeypatch.setattr(bb, "_singleton", bb.BarBroadcaster(), raising=False)
    yield


def _call(which):
    if which == "prices":
        return asyncio.run(stream.stream_prices(_Req(), tickers="AAPL,MSFT"))
    return asyncio.run(stream.stream_bars(_Req(), bars="AAPL:5"))


@pytest.mark.parametrize("which", ["prices", "bars"])
def test_the_stream_REFUSES_the_connection_that_would_exceed_the_cap(monkeypatch, which):
    """Plant an over-cap subscribe and capture the refusal.

    The cap is lowered rather than 300 connections opened — the number is not
    what is under test, the wall is.
    """
    monkeypatch.setattr(stream, "MAX_SUBSCRIBERS", 3)

    admitted = [_call(which) for _ in range(3)]
    assert all(isinstance(r, StreamingResponse) for r in admitted), (
        "a connection under the cap was refused")
    assert stream.subscriber_count(which) == 3

    refused = _call(which)
    assert isinstance(refused, JSONResponse), (
        "the over-cap connection was ADMITTED — the guard is gone")
    assert refused.status_code == 503
    body = refused.body.decode()
    assert "at_capacity" in body and which in body, body
    # …and the refusal did not consume a slot, so the cap does not creep down.
    assert stream.subscriber_count(which) == 3


@pytest.mark.parametrize("which", ["prices", "bars"])
def test_a_disconnect_RELEASES_the_slot_so_the_cap_is_not_a_ratchet(monkeypatch, which):
    """A cap that only ever fills is an outage on a timer. The token is released
    in the generator's `finally`; here the release is driven directly, which is
    what that `finally` calls."""
    monkeypatch.setattr(stream, "MAX_SUBSCRIBERS", 2)
    _call(which)
    _call(which)
    assert isinstance(_call(which), JSONResponse)

    for token in list(stream._subscribers[which]):
        stream.unsubscribe(which, token)
    assert stream.subscriber_count(which) == 0
    assert isinstance(_call(which), StreamingResponse), (
        "a released slot was never reusable")


def test_the_two_streams_DO_NOT_SHARE_one_pool(monkeypatch):
    """⛔ A wall of chart tabs on /api/stream/bars must not be able to lock every
    member out of price quotes. Each stream carries its own registry, like the
    two massive streams do."""
    monkeypatch.setattr(stream, "MAX_SUBSCRIBERS", 2)
    _call("bars")
    _call("bars")
    assert isinstance(_call("bars"), JSONResponse), "the bars cap never engaged"
    assert isinstance(_call("prices"), StreamingResponse), (
        "a full bars stream refused a price connection — one shared pool")


def test_the_cap_is_PUBLISHED_so_hitting_it_is_observable(monkeypatch):
    """A cap nobody can see hit is a cap nobody knows they hit — `chat_stream.stats()`
    and `/curated-stream-status` already publish theirs."""
    monkeypatch.setattr(stream, "MAX_SUBSCRIBERS", 7)
    _call("prices")
    out = stream.stream_status()
    assert out["max_subscribers"] == 7
    assert out["subscribers"]["prices"] == 1
