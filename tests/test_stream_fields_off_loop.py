"""`bar_contract.stream_fields` never reads the bars store on the caller's thread.

It runs on the stream event loop for EVERY frame of `/api/stream/bars` (stream._contract_event),
on web and on stream-edge. Until 2026-11-25 a stale cache entry (TTL 1 s, per symbol and series)
called `bars_sqlite.series_meta` right there: a synchronous SQLite read, once a second per pair,
on the loop that sends every member's frames; the very first call also imported and opened the
store (~2 s in the test suite, see test_stream_bars_event_driven's fixture). A slow read held
every frame on that pod behind it. Now the read runs on a worker thread and the frame takes the
value the cache holds (stale-while-revalidate); `series_rev` may lag the store by one read, which
the contract already allowed (it was cached ~1 s).
"""
import asyncio
import threading
import time

import pytest

from api.services import bar_contract as bc


SLOW_S = 0.4


@pytest.fixture
def slow_store(monkeypatch):
    """bars_sqlite.series_meta answers after SLOW_S with the rev in `state`, and counts its calls."""
    from api.services import bars_sqlite
    state = {"rev": 7, "calls": 0, "threads": set()}

    def series_meta(sym, series):
        state["calls"] += 1
        state["threads"].add(threading.current_thread().name)
        time.sleep(SLOW_S)
        return {"rev": state["rev"]}

    monkeypatch.setattr(bars_sqlite, "series_meta", series_meta)
    # what the route guarantees before a stream's first frame (test_the_route_warms_...)
    getattr(bc, "warm_imports", lambda: None)()
    reset = getattr(bc, "reset_stream_rev_for_tests", None)
    if reset:
        reset()
    else:
        bc._stream_rev_cache.clear()
    yield state
    settle = getattr(bc, "stream_rev_settle", None)
    if settle:
        settle(5)


def _settle():
    # the read in flight lands (a helper, so a test never sleeps a guessed time)
    assert bc.stream_rev_settle(5), "the background read did not finish"


def test_a_frame_never_waits_on_the_store(slow_store):
    t0 = time.perf_counter()
    out = bc.stream_fields("AAA", "5", "rth")
    took = time.perf_counter() - t0
    assert took < 0.05, f"stream_fields waited {took * 1000:.0f} ms on the store"
    assert out["cache_key"] == bc.cache_key("AAA", "5", "rth")
    assert "series_rev" in out


def test_the_event_loop_is_never_blocked_while_the_store_is_slow(slow_store, monkeypatch):
    monkeypatch.setattr(bc, "_STREAM_REV_TTL_S", 0.0)  # every frame finds its entry stale

    async def go():
        gaps = []

        async def heartbeat():
            last = time.perf_counter()
            for _ in range(60):
                await asyncio.sleep(0.01)
                now = time.perf_counter()
                gaps.append(now - last)
                last = now

        async def frames():
            for i in range(30):
                bc.stream_fields("AAA" if i % 2 else "BBB", "5", "rth")
                await asyncio.sleep(0.02)

        await asyncio.gather(heartbeat(), frames())
        return max(gaps)

    worst = asyncio.run(go())
    assert worst < 0.15, f"the loop stalled {worst * 1000:.0f} ms behind a store read"


def test_the_read_lands_off_the_loop_and_later_frames_carry_it(slow_store):
    bc.stream_fields("AAA", "5", "rth")
    _settle()
    assert bc.stream_fields("AAA", "5", "rth")["series_rev"] == 7
    assert threading.main_thread().name not in slow_store["threads"]


def test_one_read_in_flight_per_series(slow_store, monkeypatch):
    monkeypatch.setattr(bc, "_STREAM_REV_TTL_S", 0.0)
    for _ in range(50):
        bc.stream_fields("AAA", "5", "rth")
    _settle()
    assert slow_store["calls"] <= 2, slow_store["calls"]   # the one in flight (+ at most one after it lands)


def test_a_stale_value_is_served_while_it_refreshes(slow_store, monkeypatch):
    bc.stream_fields("AAA", "5", "rth")
    _settle()
    assert bc.stream_fields("AAA", "5", "rth")["series_rev"] == 7
    slow_store["rev"] = 9
    monkeypatch.setattr(bc, "_STREAM_REV_TTL_S", 0.0)
    t0 = time.perf_counter()
    assert bc.stream_fields("AAA", "5", "rth")["series_rev"] == 7   # the last value, not None, not a wait
    assert time.perf_counter() - t0 < 0.05
    _settle()
    assert bc.stream_fields("AAA", "5", "rth")["series_rev"] == 9


def test_a_read_from_before_a_reset_never_lands_after_it(slow_store):
    bc.stream_fields("AAA", "5", "rth")          # a read starts (SLOW_S)
    bc.reset_stream_rev_for_tests()               # the next test's store begins
    _settle()
    assert ("AAA", bc.source_series("5", "rth")) not in bc._stream_rev_cache


def test_the_route_starts_the_reads_when_the_stream_opens(monkeypatch):
    """The pairs' reads start at subscribe, so the first frames of a new chart carry the rev."""
    from fastapi.responses import StreamingResponse
    from api.routers import stream
    from api.services import bar_broadcaster as bb

    class _Q(asyncio.Queue):
        pass

    class _B:
        def subscribe(self, sym, tf):
            return _Q()

        def unsubscribe(self, sym, tf, q):
            pass

    asked = []
    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(stream, "_event_seq", {"prices": 0, "bars": 0})
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    monkeypatch.setattr(bb, "get_broadcaster", lambda: _B())
    monkeypatch.setattr(bc, "prefetch_stream_fields", lambda pairs, session: asked.append((sorted(pairs), session)))

    class _Req:
        headers = {}

        async def is_disconnected(self):
            return True

    async def go():
        resp = await stream.stream_bars(_Req(), bars="AAPL:5,MSFT:1")
        assert isinstance(resp, StreamingResponse)
        async for _ in resp.body_iterator:
            pass

    asyncio.run(go())
    assert asked == [([("AAPL", "5"), ("MSFT", "1")], "rth")], asked


def test_the_route_warms_the_contract_imports_off_the_loop(monkeypatch):
    """bars_fetch's first import (~1.5-2 s) happens on a worker thread when the first stream opens,
    never under a frame on the event loop."""
    from fastapi.responses import StreamingResponse
    from api.routers import stream
    from api.services import bar_broadcaster as bb

    class _B:
        def subscribe(self, sym, tf):
            return asyncio.Queue()

        def unsubscribe(self, sym, tf, q):
            pass

    ran = []
    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(stream, "_event_seq", {"prices": 0, "bars": 0})
    monkeypatch.setattr(stream, "_contract_warm", {"done": False})
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    monkeypatch.setattr(bb, "get_broadcaster", lambda: _B())
    monkeypatch.setattr(bc, "warm_imports", lambda: ran.append(threading.current_thread() is threading.main_thread()))

    class _Req:
        headers = {}

        async def is_disconnected(self):
            return True

    async def go():
        for _ in range(2):
            resp = await stream.stream_bars(_Req(), bars="AAPL:5")
            assert isinstance(resp, StreamingResponse)
            async for _ in resp.body_iterator:
                pass

    asyncio.run(go())
    assert ran == [False], ran   # once, and not on the loop's thread


def test_a_failing_warm_up_never_fails_the_stream(monkeypatch):
    """(review of #2748, F1) the warm-up import raising (an ImportError in bars_fetch, a pod without
    its databases) must not 500 every /api/stream/bars open: the stream opens and serves its frames,
    without identity fields, as it did when that import failed inside _contract_event's catch-all."""
    from fastapi.responses import StreamingResponse
    from api.routers import stream
    from api.services import bar_broadcaster as bb

    queues = {}

    class _B:
        def subscribe(self, sym, tf):
            q = asyncio.Queue()
            queues[(sym, tf)] = q
            return q

        def unsubscribe(self, sym, tf, q):
            pass

    def boom():
        raise ImportError("bars_fetch cannot import here")

    def no_identity(sym, tf, session):
        raise ImportError("bars_fetch cannot import here")

    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(stream, "_event_seq", {"prices": 0, "bars": 0})
    monkeypatch.setattr(stream, "_contract_warm", {"done": False})
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    monkeypatch.setattr(bb, "get_broadcaster", lambda: _B())
    monkeypatch.setattr(bc, "warm_imports", boom)
    monkeypatch.setattr(bc, "stream_fields", no_identity)

    class _Req:
        headers = {}

        def __init__(self):
            self.stop = False

        async def is_disconnected(self):
            return self.stop

    async def go():
        req = _Req()
        resp = await stream.stream_bars(req, bars="AAPL:5")
        assert isinstance(resp, StreamingResponse)
        chunks = []

        async def reader():
            async for c in resp.body_iterator:
                chunks.append(c)

        task = asyncio.ensure_future(reader())
        await asyncio.sleep(0.05)
        queues[("AAPL", "5")].put_nowait({"sym": "AAPL", "tf": "5", "bar": {"t": 1, "c": 1.5}})
        await asyncio.sleep(0.2)
        req.stop = True
        await asyncio.wait_for(task, timeout=5)
        return chunks

    chunks = asyncio.run(go())
    bars_out = [c for c in chunks if "event: bar" in c]
    assert len(bars_out) == 1 and '"c": 1.5' in bars_out[0], chunks
    assert stream._contract_warm["done"] is True   # tried once; the next open does not park another thread
