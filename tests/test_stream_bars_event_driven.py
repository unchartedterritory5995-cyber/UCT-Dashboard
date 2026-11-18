"""`/api/stream/bars` sends a frame the moment its queue receives it, and an idle connection
does not spin.

The loop used to poll every queue and sleep 250 ms whenever nothing was ready, so a bar
landing during the sleep waited up to 250 ms before leaving the pod (production 2026-11-16:
exchange -> pod at most 100 ms at the median, ~310 ms exchange -> browser). It now holds one
pending `get()` per pair and wakes on the first one to complete.
"""
import asyncio
import time as _real_time

import pytest
from fastapi.responses import StreamingResponse

from api.routers import stream


class _Req:
    """Connected until `stop` is set; counts how often the loop asks."""

    def __init__(self):
        self.stop = False
        self.asked = 0
        self.headers = {}

    async def is_disconnected(self):
        self.asked += 1
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


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(stream, "_event_seq", {"prices": 0, "bars": 0})
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    # The loop is under test, not the contract lookup: its first call imports and opens the
    # bars store (~2 s here), which would be charged to the first frame.
    from api.services import bar_contract
    monkeypatch.setattr(bar_contract, "stream_fields", lambda sym, tf, session: {})
    from api.services import bar_broadcaster as bb
    fake = _Broadcaster()
    monkeypatch.setattr(bb, "get_broadcaster", lambda: fake)
    yield fake


def _run(fake, script):
    """Open the stream, run `script(req, fake, frames)` beside it, return the frames with the
    monotonic time each arrived."""
    async def go():
        req = _Req()
        resp = await stream.stream_bars(req, bars="AAPL:5,MSFT:1")
        assert isinstance(resp, StreamingResponse)
        frames = []

        async def reader():
            async for chunk in resp.body_iterator:
                frames.append((_real_time.monotonic(), chunk))

        task = asyncio.ensure_future(reader())
        try:
            await script(req, fake, frames)
        finally:
            req.stop = True
            await asyncio.wait_for(task, timeout=5)
        return req, frames
    return asyncio.run(go())


def test_a_bar_leaves_the_moment_its_queue_receives_it(isolated):
    puts = []

    async def script(req, fake, frames):
        await asyncio.sleep(0.05)
        # Offsets that fall at different points of a 250 ms poll: the old loop would have held
        # these for ~190, 30, 120, 210 and 50 ms.
        for i, at in enumerate((0.31, 0.47, 0.63, 0.79, 0.95)):
            await asyncio.sleep(at - (puts[-1][0] - start if puts else 0.0))
            q = fake.queues[("AAPL", "5") if i % 2 == 0 else ("MSFT", "1")]
            puts.append((_real_time.monotonic(), i))
            q.put_nowait({"sym": "X", "tf": "5", "bar": {"t": i, "c": i}})
        await asyncio.sleep(0.2)

    start = _real_time.monotonic()
    _req, frames = _run(isolated, script)
    bars = [(t, c) for t, c in frames if "event: bar" in c]
    assert len(bars) == 5, frames
    lags = [bars[n][0] - puts[n][0] for n in range(5)]
    assert max(lags) < 0.1, [round(x * 1000) for x in lags]


def test_an_idle_connection_wakes_about_once_a_second_not_four_times(isolated):
    async def script(req, fake, frames):
        await asyncio.sleep(2.2)

    req, frames = _run(isolated, script)
    # One check before the first wait, then one per second of idle: 3, maybe 4 with timing slop.
    # The 250 ms poll asked 9 times in the same 2.2 s.
    assert 2 <= req.asked <= 4, req.asked


def test_frames_queued_behind_each_other_keep_their_order_and_all_leave(isolated):
    async def script(req, fake, frames):
        await asyncio.sleep(0.05)
        q = fake.queues[("AAPL", "5")]
        for i in range(5):
            q.put_nowait({"sym": "AAPL", "tf": "5", "bar": {"t": i, "c": i}})
        await asyncio.sleep(0.2)

    _req, frames = _run(isolated, script)
    import json
    ts = [json.loads(c.split("data: ", 1)[1].split("\n", 1)[0])["bar"]["t"]
          for _t, c in frames if "event: bar" in c]
    assert ts == [0, 1, 2, 3, 4], ts
