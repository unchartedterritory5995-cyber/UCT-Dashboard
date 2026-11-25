"""`/api/stream/bars?ahead=`: the rows a member is about to reach, on the SAME connection, shed first (2026-11-25).

The watchlist puts the next 1-2 rows on the bars stream so the first press after a minute roll finds that row's copy as
current as the chart on screen. Those pairs are speculative, so the pod admits them only within a pod-wide budget
(`STREAM_MAX_AHEAD_PAIRS`) and never under load (the bars subscriber registry at or past `AHEAD_LOAD_FRACTION` of its cap);
a refused ahead pair is simply not subscribed (the client keeps its old rule for that row). Admitted ahead pairs are
counted until their connection ends.
"""
import asyncio

import pytest
from fastapi.responses import StreamingResponse

from api.routers import stream


class _Req:
    def __init__(self):
        self.stop = False
        self.headers = {}

    async def is_disconnected(self):
        return self.stop


class _Broadcaster:
    def __init__(self):
        self.subs = []

    def subscribe(self, sym, tf, **kw):
        q = asyncio.Queue()
        self.subs.append((sym, tf))
        return q

    def unsubscribe(self, sym, tf, q, *a):
        self.subs.remove((sym, tf))


@pytest.fixture(autouse=True)
def fake(monkeypatch):
    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(stream, "_event_seq", {"prices": 0, "bars": 0})
    monkeypatch.setattr(stream, "_ahead", {"live": 0, "admitted": 0, "refused": 0}, raising=False)
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    from api.services import bar_contract
    monkeypatch.setattr(bar_contract, "stream_fields", lambda sym, tf, session: {})
    from api.services import bar_broadcaster as bb
    f = _Broadcaster()
    monkeypatch.setattr(bb, "get_broadcaster", lambda: f)
    yield f


def _open(bars, ahead=None):
    """Open one connection (its generator started), return (request, response, reader task)."""
    req = _Req()

    async def go():
        resp = await stream.stream_bars(req, bars=bars, ahead=ahead)
        assert isinstance(resp, StreamingResponse)
        it = resp.body_iterator

        async def reader():
            async for _chunk in it:
                pass

        task = asyncio.ensure_future(reader())
        await asyncio.sleep(0.05)
        return resp, task
    return req, go


def _run(script):
    return asyncio.run(script())


def test_ahead_pairs_ride_the_same_connection_and_are_counted_until_it_ends(fake):
    async def script():
        req, go = _open("AAPL:1,AAPL:15", "MSFT:1,MSFT:15")
        _resp, task = await go()
        assert sorted(fake.subs) == sorted([("AAPL", "1"), ("AAPL", "15"), ("MSFT", "1"), ("MSFT", "15")])
        assert stream.ahead_stats()["live"] == 2
        req.stop = True
        await asyncio.wait_for(task, timeout=5)
        assert fake.subs == []
        assert stream.ahead_stats()["live"] == 0
    _run(script)


def test_the_pod_budget_admits_up_to_its_cap_and_refuses_the_rest(fake, monkeypatch):
    monkeypatch.setattr(stream, "MAX_AHEAD_PAIRS", 3)

    async def script():
        r1, go1 = _open("AAPL:1", "MSFT:1,NVDA:1")
        _a, t1 = await go1()
        r2, go2 = _open("TSLA:1", "AMD:1,AMZN:1")
        _b, t2 = await go2()
        ahead_subs = [p for p in fake.subs if p[0] in ("MSFT", "NVDA", "AMD", "AMZN")]
        assert len(ahead_subs) == 3, fake.subs
        assert ("TSLA", "1") in fake.subs                  # the chart's own pair is never refused
        st = stream.ahead_stats()
        assert st["live"] == 3 and st["refused"] == 1
        r1.stop = True
        await asyncio.wait_for(t1, timeout=5)
        assert stream.ahead_stats()["live"] == 1
        r2.stop = True
        await asyncio.wait_for(t2, timeout=5)
        assert stream.ahead_stats()["live"] == 0
    _run(script)


def test_under_load_no_ahead_pair_is_admitted(fake, monkeypatch):
    monkeypatch.setattr(stream, "MAX_SUBSCRIBERS", 10)
    stream._subscribers["bars"].update(range(1000, 1008))   # 8 of 10 connections in use: past the load line

    async def script():
        req, go = _open("AAPL:1", "MSFT:1")
        _r, task = await go()
        assert fake.subs == [("AAPL", "1")]
        assert stream.ahead_stats()["refused"] == 1
        req.stop = True
        await asyncio.wait_for(task, timeout=5)
    _run(script)


def test_an_ahead_pair_already_on_the_chart_is_not_doubled_and_the_50_pair_cap_counts_both(fake):
    async def script():
        bars = ",".join(f"S{i:02d}:1" for i in range(49))
        req, go = _open(bars, "S00:1,MSFT:1,NVDA:1")
        _r, task = await go()
        assert len(fake.subs) == 50, len(fake.subs)
        assert fake.subs.count(("S00", "1")) == 1
        assert ("MSFT", "1") in fake.subs and ("NVDA", "1") not in fake.subs
        req.stop = True
        await asyncio.wait_for(task, timeout=5)
    _run(script)


def test_a_request_without_ahead_is_exactly_as_before(fake):
    async def script():
        req, go = _open("AAPL:1")
        _r, task = await go()
        assert fake.subs == [("AAPL", "1")]
        assert stream.ahead_stats()["live"] == 0
        req.stop = True
        await asyncio.wait_for(task, timeout=5)
    _run(script)


def test_stream_status_reports_the_ahead_counters(fake):
    out = stream.stream_status()
    assert set(out["ahead"]) >= {"live", "admitted", "refused", "max"}
