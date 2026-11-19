"""`/api/stream/bars` tells the browser when the Massive socket behind it goes down (2026-11-18).

A mirror of stream-ingest (web in remote mode, stream-edge) knows it (`feed_fresh`). Without an
`event: status`, a chart kept `delivering` for up to 150 s of silence with its Finnhub fallback
suppressed: a frozen candle. The stream sends {"live": bool} once at the start and on every change,
nothing from a broadcaster that cannot tell, and a failing read never ends the stream.
"""
import asyncio
import json

import pytest

from api.routers import stream


class _Req:
    def __init__(self):
        self.stop = False
        self.headers = {}

    async def is_disconnected(self):
        return self.stop


class _Broadcaster:
    def __init__(self):
        self.queues = {}

    def subscribe(self, sym, tf):
        q = asyncio.Queue()
        self.queues[(sym, tf)] = q
        return q

    def unsubscribe(self, sym, tf, q):
        pass


class _Mirror(_Broadcaster):
    """RemoteBroadcaster's shape: `feed_fresh()` is its word on the vendor socket."""

    def __init__(self):
        super().__init__()
        self.live = True
        self.fail = False

    def feed_fresh(self):
        if self.fail:
            raise RuntimeError("status read failed")
        return self.live


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(stream, "_event_seq", {"prices": 0, "bars": 0})
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    from api.services import bar_contract
    monkeypatch.setattr(bar_contract, "stream_fields", lambda sym, tf, session: {})


def _run(monkeypatch, fake, script):
    from api.services import bar_broadcaster as bb
    monkeypatch.setattr(bb, "get_broadcaster", lambda: fake)

    async def go():
        req = _Req()
        resp = await stream.stream_bars(req, bars="AAPL:5")
        chunks = []

        async def reader():
            async for chunk in resp.body_iterator:
                chunks.append(chunk)

        task = asyncio.ensure_future(reader())
        try:
            await script(fake, chunks)
        finally:
            req.stop = True
            await asyncio.wait_for(task, timeout=5)
        return chunks
    return asyncio.run(go())


def _statuses(chunks):
    out = []
    for c in chunks:
        if "event: status" in c:
            data = next(line for line in c.splitlines() if line.startswith("data: "))
            out.append(json.loads(data[len("data: "):]))
    return out


def test_status_goes_out_at_the_start_and_on_each_change_only(monkeypatch):
    async def script(fake, chunks):
        await asyncio.sleep(1.3)          # several loop turns while live: one status
        fake.live = False
        await asyncio.sleep(1.3)          # the vendor socket drops: one status
        fake.live = True
        await asyncio.sleep(1.3)          # back: one status
    chunks = _run(monkeypatch, _Mirror(), script)
    assert _statuses(chunks) == [{"live": True}, {"live": False}, {"live": True}]


def test_a_bar_still_flows_beside_the_status(monkeypatch):
    async def script(fake, chunks):
        await asyncio.sleep(0.2)
        fake.queues[("AAPL", "5")].put_nowait({"sym": "AAPL", "tf": "5", "bar": {"t": 1, "c": 1.0}})
        await asyncio.sleep(0.3)
    chunks = _run(monkeypatch, _Mirror(), script)
    assert any("event: bar" in c for c in chunks) and _statuses(chunks) == [{"live": True}]


def test_a_broadcaster_that_cannot_tell_sends_no_status(monkeypatch):
    async def script(fake, chunks):
        await asyncio.sleep(1.2)
    chunks = _run(monkeypatch, _Broadcaster(), script)
    assert _statuses(chunks) == []


def test_a_failing_status_read_never_ends_the_stream(monkeypatch):
    mirror = _Mirror()
    mirror.fail = True                   # failing from the first turn of the loop

    async def script(fake, chunks):
        await asyncio.sleep(1.2)
        fake.fail = False
        fake.live = False
        await asyncio.sleep(1.2)
    chunks = _run(monkeypatch, mirror, script)
    assert _statuses(chunks) == [{"live": False}]
