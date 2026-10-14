"""The Massive socket is closed only when it is really dead (2026-10-14): neither a
data frame nor a pong for LIVENESS_S of time the loop was actually running. The
library keepalive it replaced dropped live connections whenever the pong queued
behind inbound data."""
import asyncio

from api.services import bar_stream


class _WS:
    def __init__(self, answer_pings: bool):
        self.answer = answer_pings
        self.closed = False
        self.pings = 0

    async def ping(self):
        self.pings += 1
        fut = asyncio.get_running_loop().create_future()
        if self.answer:
            fut.set_result(0.01)
        return fut

    async def close(self):
        self.closed = True


def _run(ws, monkeypatch, seconds):
    monkeypatch.setattr(bar_stream, "_PING_EVERY_S", 0.01)
    monkeypatch.setattr(bar_stream, "LIVENESS_S", 0.05)

    async def go():
        task = asyncio.create_task(bar_stream._liveness_watch(ws))
        try:
            await asyncio.wait_for(asyncio.shield(task), seconds)
        except asyncio.TimeoutError:
            task.cancel()
    asyncio.run(go())


def test_a_silent_peer_that_never_answers_a_ping_is_closed(monkeypatch):
    ws = _WS(answer_pings=False)
    _run(ws, monkeypatch, 1.0)
    assert ws.closed is True


def test_a_quiet_peer_that_answers_pings_is_kept(monkeypatch):
    ws = _WS(answer_pings=True)
    _run(ws, monkeypatch, 0.3)
    assert ws.closed is False and ws.pings >= 3


def test_a_peer_sending_data_is_kept_even_without_pongs(monkeypatch):
    ws = _WS(answer_pings=False)

    async def feed():
        for _ in range(60):
            bar_stream._feed_frames += 1
            await asyncio.sleep(0.005)
    monkeypatch.setattr(bar_stream, "_PING_EVERY_S", 0.01)
    monkeypatch.setattr(bar_stream, "LIVENESS_S", 0.05)

    async def go():
        task = asyncio.create_task(bar_stream._liveness_watch(ws))
        await feed()
        task.cancel()
    asyncio.run(go())
    assert ws.closed is False


def test_the_library_keepalive_is_off():
    import inspect
    src = inspect.getsource(bar_stream._run_websocket)
    assert "ping_interval=None" in src and "ping_timeout=None" in src
    assert "_liveness_watch(ws)" in src


def test_minute_bar_lag_is_measured(monkeypatch):
    monkeypatch.setattr(bar_stream, "_am_lag", {"window_start": 0.0, "max_ms": 0,
                                                "prev_window_max_ms": 0, "worst_ms": 0})
    import time
    bar_stream._note_am_lag(int(time.time() * 1000) - 4000)
    assert 3500 <= bar_stream._am_lag["max_ms"] <= 6000
    bar_stream._note_am_lag(None)          # a missing end stamp is ignored, never raises
