"""`bar_correction` reaches EVERY connected price stream that watches the symbol.

The defect: minute-close reconciliation (`realtime_candle.reconciliation_worker`)
put each correction on ONE process-wide `asyncio.Queue`, and every
`/api/stream/prices` connection drained that same queue with `get_nowait()`.
With several clients connected, a correction reached exactly one of them --
whichever generator woke first -- and could be taken by a connection that was
not even watching that symbol. Every other chart kept the uncorrected bar.

The fix copies `bar_broadcaster`'s fan-out shape: one bounded queue PER
CONNECTION (maxsize, drop-oldest, `call_soon_threadsafe` onto the owner loop),
keyed by the connection's ticker list, unsubscribed in the generator's
`finally`.

Every stream case drives the REAL `stream_prices` handler and reads the frames
its generator yields, like `test_stream_event_ids.py`; nothing asserts that a
helper exists. The request stub stays connected until the test releases it, so
several generators run concurrently inside ONE `asyncio.run`.
"""
import asyncio
import json

import pytest
from fastapi.responses import StreamingResponse

from api.routers import stream
from api.services import realtime_candle


class _GatedReq:
    """Connected until `.close()` -- the generator's only exit."""

    def __init__(self):
        self.headers = {}
        self.closed = False

    def close(self):
        self.closed = True

    async def is_disconnected(self):
        return self.closed


def _parse(chunks):
    frames = []
    for block in "".join(chunks).split("\n\n"):
        if not block.strip():
            continue
        f = {"event": "message"}
        for line in block.split("\n"):
            key, _, val = line.partition(": ")
            f[key] = val
        frames.append(f)
    return frames


async def _drain(resp):
    assert isinstance(resp, StreamingResponse), resp
    return [c async for c in resp.body_iterator]


def _corrections(chunks):
    return [json.loads(f["data"]) for f in _parse(chunks) if f["event"] == "bar_correction"]


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(stream, "_event_seq", {"prices": 0, "bars": 0})
    monkeypatch.setattr(stream, "subscribe_tickers", lambda syms: None)
    monkeypatch.setattr(stream, "unsubscribe_tickers", lambda syms: None)
    monkeypatch.setattr(stream, "get_realtime_prices", lambda syms: {})
    monkeypatch.setattr(stream.realtime_candle, "get_current", lambda sym, tf: None)
    monkeypatch.setattr(stream.realtime_stream, "get_last_seen", lambda sym: None)
    # A fresh fan-out registry per test (the process-wide one is module state).
    monkeypatch.setattr(realtime_candle, "_correction_subscribers", {})
    monkeypatch.setattr(realtime_candle, "_corrections_dropped_total", 0)

    from api.services import bar_broadcaster as bb

    def _no_broadcaster():
        raise RuntimeError("bars overlay not initialised (test)")

    monkeypatch.setattr(bb, "get_broadcaster", _no_broadcaster)
    yield


_BAR = {"t": 1_700_000_040, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 100}


async def _open(tickers_per_conn):
    """Open one real price stream per ticker string; start draining each."""
    reqs, tasks = [], []
    for tickers in tickers_per_conn:
        req = _GatedReq()
        resp = await stream.stream_prices(req, tickers=tickers, last_event_id=None)
        reqs.append(req)
        tasks.append(asyncio.create_task(_drain(resp)))
    # Let every generator start (subscribe) and reach its first 250ms sleep.
    await asyncio.sleep(0.05)
    return reqs, tasks


async def _close(reqs, tasks):
    # Two full 250ms passes so every generator drains, then sees the disconnect.
    await asyncio.sleep(0.6)
    for r in reqs:
        r.close()
    return await asyncio.gather(*tasks)


@pytest.mark.parametrize("n", [2, 3])
def test_one_correction_reaches_every_connected_consumer(n):
    async def go():
        reqs, tasks = await _open(["AAPL,MSFT"] * n)
        realtime_candle.emit_correction_sync("aapl", "1", _BAR)
        return await _close(reqs, tasks)

    results = asyncio.run(go())
    got = [_corrections(chunks) for chunks in results]
    # Every consumer gets exactly the one correction -- not one consumer, once.
    assert [len(g) for g in got] == [1] * n, got
    for g in got:
        assert g[0] == {"type": "bar_correction", "sym": "AAPL", "tf": "1", "bar": _BAR}


def test_correction_is_keyed_by_the_connections_symbols():
    """A connection not watching the symbol neither receives the correction nor
    can steal it from one that is (the shared queue let it do both)."""
    async def go():
        # The MSFT-only stream opens FIRST, so under a shared queue it is the
        # one positioned to take the AAPL correction.
        reqs, tasks = await _open(["MSFT", "AAPL", "NVDA,AAPL"])
        realtime_candle.emit_correction_sync("AAPL", "1", _BAR)
        return await _close(reqs, tasks)

    msft_only, aapl, nvda_aapl = (_corrections(c) for c in asyncio.run(go()))
    assert msft_only == []
    assert len(aapl) == 1 and aapl[0]["sym"] == "AAPL"
    assert len(nvda_aapl) == 1 and nvda_aapl[0]["sym"] == "AAPL"


def test_disconnect_unsubscribes_every_connection():
    async def go():
        reqs, tasks = await _open(["AAPL", "AAPL,MSFT", "MSFT"])
        during = realtime_candle.correction_subscriber_count()
        await _close(reqs, tasks)
        after = realtime_candle.correction_subscriber_count()
        # With no subscriber left, a correction is dropped at the source --
        # nothing accumulates for a connection that no longer exists.
        realtime_candle.emit_correction_sync("AAPL", "1", _BAR)
        await asyncio.sleep(0)
        return during, after, realtime_candle.correction_subscriber_count()

    assert asyncio.run(go()) == (3, 0, 0)


def test_generator_closed_mid_stream_unsubscribes():
    """A client that goes away without the loop ever seeing is_disconnected
    (Starlette cancels / acloses the body iterator) still leaks nothing."""
    async def go():
        resp = await stream.stream_prices(_GatedReq(), tickers="AAPL", last_event_id=None)
        it = resp.body_iterator
        task = asyncio.create_task(it.__anext__())
        await asyncio.sleep(0.05)
        during = realtime_candle.correction_subscriber_count()
        task.cancel()
        with pytest.raises((asyncio.CancelledError, StopAsyncIteration)):
            await task
        await it.aclose()
        return during, realtime_candle.correction_subscriber_count()

    assert asyncio.run(go()) == (1, 0)


def test_slow_consumer_drops_oldest_without_blocking_others():
    maxsize = realtime_candle.CORRECTION_QUEUE_MAXSIZE
    total = maxsize + 36

    async def go():
        slow = realtime_candle.subscribe_corrections(["AAPL"])
        fast = realtime_candle.subscribe_corrections(["AAPL"])
        fast_got = []
        for i in range(total):
            # Sync, never awaits a consumer: a full queue cannot stall the
            # reconciliation worker that calls this.
            realtime_candle.emit_correction_sync("AAPL", "1", {**_BAR, "t": i})
            await asyncio.sleep(0)  # let call_soon_threadsafe deliver
            while not fast.empty():
                fast_got.append(fast.get_nowait()["bar"]["t"])
        slow_got = []
        while not slow.empty():
            slow_got.append(slow.get_nowait()["bar"]["t"])
        realtime_candle.unsubscribe_corrections(slow)
        realtime_candle.unsubscribe_corrections(fast)
        return fast_got, slow_got

    fast_got, slow_got = asyncio.run(go())
    assert fast_got == list(range(total))                 # the fast one lost nothing
    assert slow_got == list(range(total - maxsize, total))  # newest kept, oldest dropped
    assert realtime_candle._corrections_dropped_total == total - maxsize
    assert realtime_candle.correction_subscriber_count() == 0


def test_unsubscribe_is_idempotent_and_tolerates_none():
    async def go():
        q = realtime_candle.subscribe_corrections(["AAPL"])
        realtime_candle.unsubscribe_corrections(q)
        realtime_candle.unsubscribe_corrections(q)
        realtime_candle.unsubscribe_corrections(None)
        return realtime_candle.correction_subscriber_count()

    assert asyncio.run(go()) == 0
