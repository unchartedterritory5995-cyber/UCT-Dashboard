"""`/api/stream/bars?ahead=`: the rows a member is about to reach, on the SAME connection, shed first (2026-11-25).

The watchlist puts the next 1-2 rows on the bars stream so the first press after a minute roll finds that row's copy as
current as the chart on screen.
(review of #2721) Ahead pairs are sent at about 1 Hz: their developing bar at most AHEAD_INTERVAL_S behind, every final
and a new bucket's first frame at the next poll (AHEAD_POLL_S); the chart's own pairs are untouched. A failure before
streaming starts releases the ahead budget and the connection's admission. Those pairs are speculative, so the pod admits them only within a pod-wide budget
(`STREAM_MAX_AHEAD_PAIRS`) and never under load (the bars subscriber registry at or past `AHEAD_LOAD_FRACTION` of its cap);
a refused ahead pair is simply not subscribed (the client keeps its old rule for that row). Admitted ahead pairs are
counted until their connection ends.
"""
import asyncio
import os

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
        self.queues = {}
        self.fail_on = None

    def subscribe(self, sym, tf, **kw):
        if self.fail_on == (sym, tf):
            raise RuntimeError("subscribe failed")
        q = asyncio.Queue()
        self.subs.append((sym, tf))
        self.queues[(sym, tf)] = q
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


def _frame(sym, tf, t, c, final=False):
    return {"sym": sym, "tf": tf, "bar": {"t": t, "o": 1, "h": 2, "l": 0.5, "c": c, "v": 10, "final": final}}


def _stream(fake, script, bars="AAPL:1", ahead="MSFT:1"):
    """Run `script(fake, got)` beside one open connection; `got` collects (monotonic, sym, t, c, final) per bar frame."""
    import json as _json
    import time as _t

    async def go():
        req = _Req()
        resp = await stream.stream_bars(req, bars=bars, ahead=ahead)
        got = []

        async def reader():
            async for chunk in resp.body_iterator:
                # a wake's frames leave in ONE chunk (serialise-once, 2026-11-25): read each SSE event in it
                for event in chunk.split("\n\n"):
                    if "event: bar" in event:
                        d = _json.loads(event.split("data: ", 1)[1].strip())
                        got.append((_t.monotonic(), d["sym"], d["bar"]["t"], d["bar"]["c"], bool(d["bar"].get("final"))))

        task = asyncio.ensure_future(reader())
        try:
            await asyncio.sleep(0.05)
            await script(fake, got)
        finally:
            req.stop = True
            await asyncio.wait_for(task, timeout=5)
        return got
    return asyncio.run(go())


def test_ahead_developing_frames_go_at_most_once_a_second_the_charts_every_one(fake):
    assert stream.AHEAD_INTERVAL_S == 1.0

    async def script(f, got):
        for i in range(16):                                    # 1.6 s of a forming minute, a frame every 100 ms
            f.queues[("AAPL", "1")].put_nowait(_frame("AAPL", "1", 60_000, 10 + i))
            f.queues[("MSFT", "1")].put_nowait(_frame("MSFT", "1", 60_000, 20 + i))
            await asyncio.sleep(0.1)
        await asyncio.sleep(0.4)

    got = _stream(fake, script)
    chart = [g for g in got if g[1] == "AAPL"]
    ahead = [g for g in got if g[1] == "MSFT"]
    assert len(chart) == 16, len(chart)
    assert 2 <= len(ahead) <= 3, [round(g[0] - ahead[0][0], 2) for g in ahead]
    assert ahead[0][3] == 20                                   # the first frame at once
    gaps = [b[0] - a[0] for a, b in zip(ahead, ahead[1:])]
    assert all(g >= 0.95 for g in gaps), gaps
    assert ahead[-1][3] >= 33                                  # the newest value, never an old one


def test_ahead_finals_and_a_new_buckets_first_frame_go_at_once(fake):
    async def script(f, got):
        q = f.queues[("MSFT", "1")]
        q.put_nowait(_frame("MSFT", "1", 60_000, 20))
        await asyncio.sleep(0.4)
        q.put_nowait(_frame("MSFT", "1", 60_000, 21))           # held: inside the second
        t0 = asyncio.get_running_loop().time()
        q.put_nowait(_frame("MSFT", "1", 60_000, 22, final=True))
        q.put_nowait(_frame("MSFT", "1", 120_000, 30))
        f.t0 = t0
        await asyncio.sleep(0.5)

    import time as _t
    got = _stream(fake, script)
    ahead = [g for g in got if g[1] == "MSFT"]
    fin = [g for g in ahead if g[4]]
    assert len(fin) == 1 and fin[0][3] == 22
    assert [g[3] for g in ahead] == [20, 22, 30], ahead        # the held 21 is superseded by its bucket's final
    assert fin[0][0] - ahead[0][0] < 0.4 + stream.AHEAD_POLL_S + 0.15


def test_a_failure_before_streaming_releases_the_ahead_budget_and_the_connection(fake):
    fake.fail_on = ("NVDA", "1")

    async def go():
        with pytest.raises(RuntimeError):
            await stream.stream_bars(_Req(), bars="AAPL:1", ahead="MSFT:1,NVDA:1")
    asyncio.run(go())
    assert stream.ahead_stats()["live"] == 0
    assert stream.subscriber_count("bars") == 0
    assert fake.subs == []                                     # the queues it made are gone too


# ⭐ (review of #2721, 2026-11-25) THE POD BUDGET AT 1 Hz IS THE LOAD LINE. A connection holds at most AHEAD_MAX_PER_CONN
# ahead pairs (the client's own page cap, barsStreamManager AHEAD_MAX_PAIRS), and the pod admits them only below
# AHEAD_LOAD_FRACTION of MAX_SUBSCRIBERS; so the most that can ever be live is ceil(0.8 x 300) x 4 = 960, and the default
# budget is exactly that: below the load line it never refuses (the 80% shed is what binds).
def test_a_connection_holds_at_most_the_per_connection_cap(fake):
    async def script():
        req, go = _open("AAPL:1", "M1:1,M2:1,M3:1,M4:1,M5:1,M6:1")
        _r, task = await go()
        ahead = [p for p in fake.subs if p[0] != "AAPL"]
        assert ahead == [("M1", "1"), ("M2", "1"), ("M3", "1"), ("M4", "1")], fake.subs
        assert stream.ahead_stats()["live"] == 4
        req.stop = True
        await asyncio.wait_for(task, timeout=5)
    _run(script)


def test_the_per_connection_cap_is_the_clients_page_cap():
    import pathlib
    import re
    js = (pathlib.Path(__file__).resolve().parents[1] / "app" / "src" / "lib" / "barsStreamManager.js").read_text("utf-8")
    m = re.search(r"export const AHEAD_MAX_PAIRS = (\d+)", js)
    assert m, "barsStreamManager.js no longer exports AHEAD_MAX_PAIRS"
    assert stream.AHEAD_MAX_PER_CONN == int(m.group(1))


def test_the_default_budget_is_the_load_line_times_the_per_connection_cap(monkeypatch):
    monkeypatch.setattr(stream, "MAX_SUBSCRIBERS", 300)
    monkeypatch.setattr(stream, "AHEAD_LOAD_FRACTION", 0.8)
    assert stream._default_max_ahead_pairs() == 960
    if "STREAM_MAX_AHEAD_PAIRS" not in os.environ:
        assert stream.MAX_AHEAD_PAIRS == 960


def test_below_the_load_line_the_default_budget_never_refuses(fake, monkeypatch):
    monkeypatch.setattr(stream, "MAX_SUBSCRIBERS", 10)               # load line 8: connections 1..7 may hold rows ahead
    monkeypatch.setattr(stream, "MAX_AHEAD_PAIRS", stream._default_max_ahead_pairs())

    async def script():
        open_ = []
        for c in range(8):
            req, go = _open(f"C{c}:1", ",".join(f"A{c}x{k}:1" for k in range(4)))
            _r, task = await go()
            open_.append((req, task))
        st = stream.ahead_stats()
        assert st["live"] == 7 * 4, st                                 # every connection below the line got all four
        assert st["refused"] == 4, st                                  # only the 8th, by the shed, never by the budget
        for req, task in open_:
            req.stop = True
            await asyncio.wait_for(task, timeout=5)
        assert stream.ahead_stats()["live"] == 0
    _run(script)
