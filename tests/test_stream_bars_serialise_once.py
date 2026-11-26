"""/api/stream/bars serialises each frame ONCE for every member connection that receives it (2026-11-25).

stream-edge puts the SAME frame dict in every subscriber queue of a pair (RemoteBroadcaster._put), and each
connection's generator used to enrich it (_contract_event) and json.dumps it again: the per-frame work grew
with members x frames. Now a member frame is encoded once (cached by the frame object and the connection's
session) and every connection writes the same `event: bar` + `data:` text behind its own `id:` line; the frames a
connection has ready at one wake leave in ONE write, in order. A `?lat=1` connection (the measurement harness)
gets its own encode with its instruments; members never pay for it. The per-connection bound is unchanged: the
broadcaster's conflating queue (a forming frame replaces the waiting one).
"""
import asyncio
import json

import pytest
from fastapi.responses import StreamingResponse

from api.routers import stream


class _B:
    def __init__(self):
        self.queues = {}

    def subscribe(self, sym, tf):
        q = asyncio.Queue()
        self.queues.setdefault((sym, tf), []).append(q)
        return q

    def unsubscribe(self, sym, tf, q):
        pass


class _Req:
    headers = {}

    def __init__(self):
        self.stop = False

    async def is_disconnected(self):
        return self.stop


@pytest.fixture
def env(monkeypatch):
    from api.services import bar_broadcaster as bb
    from api.services import bar_contract as bc
    fake = _B()
    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(stream, "_event_seq", {"prices": 0, "bars": 0})
    if hasattr(stream, "_contract_warm"):
        monkeypatch.setattr(stream, "_contract_warm", {"done": True})
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    monkeypatch.setattr(bb, "get_broadcaster", lambda: fake)
    monkeypatch.setattr(bc, "stream_fields", lambda sym, tf, session: {"contract": 1, "series_rev": 7})
    calls = {"n": 0}
    real = stream._contract_event

    def counting(bar_contract, msg, session):
        calls["n"] += 1
        return real(bar_contract, msg, session)

    monkeypatch.setattr(stream, "_contract_event", counting)
    if hasattr(stream, "_reset_encode_cache_for_tests"):
        stream._reset_encode_cache_for_tests()
    return fake, calls


MSG = {"sym": "AAPL", "tf": "5", "bar": {"t": 1_800_000_000_000, "o": 1, "h": 1, "l": 1, "c": 1.5, "v": 1,
                                         "final": False, "trade_ts": 1_799_999_999_900},
       "rev": 1_800_000_000_050, "ingest_ms": 1_800_000_000_010}


def _run(fake, conns, script):
    """Open `conns` streams ([(bars, lat)]), run script(fake), return each connection's chunks."""
    async def go():
        reqs, outs, tasks = [], [], []
        for bars, lat in conns:
            r = _Req()
            kw = {"lat": "1"} if lat else {}
            resp = await stream.stream_bars(r, bars=bars, **kw)
            assert isinstance(resp, StreamingResponse)
            got = []

            async def reader(it=resp.body_iterator, got=got):
                async for c in it:
                    got.append(c)

            reqs.append(r)
            outs.append(got)
            tasks.append(asyncio.ensure_future(reader()))
        await asyncio.sleep(0.05)
        await script(fake)
        await asyncio.sleep(0.2)
        for r in reqs:
            r.stop = True
        await asyncio.wait_for(asyncio.gather(*tasks), timeout=5)
        return outs
    return asyncio.run(go())


def _bars_of(chunks):
    out = []
    for c in chunks:
        for block in c.split("\n\n"):
            if "event: bar" in block:
                lines = block.split("\n")
                out.append(({l.split(": ", 1)[0]: l.split(": ", 1)[1] for l in lines if ": " in l}))
    return out


def test_one_frame_for_many_member_connections_is_encoded_once(env):
    fake, calls = env

    async def script(fake):
        for q in fake.queues[("AAPL", "5")]:
            q.put_nowait(MSG)             # the SAME dict in every queue, as the broadcaster does

    outs = _run(fake, [("AAPL:5", False)] * 10, script)
    frames = [_bars_of(o) for o in outs]
    assert all(len(f) == 1 for f in frames), frames
    assert calls["n"] == 1, f"encoded {calls['n']} times for 10 connections"
    datas = {f[0]["data"] for f in frames}
    assert len(datas) == 1                                    # the same bytes behind each connection's id
    assert len({f[0]["id"] for f in frames}) == 10            # each frame keeps its own id
    body = json.loads(datas.pop())
    assert body["series_rev"] == 7 and body["bar"]["c"] == 1.5
    assert "sent_ms" not in body and "ingest_ms" not in body  # a member pays for no instrument


def test_a_lat_connection_gets_its_own_encode_with_its_instruments(env):
    fake, calls = env

    async def script(fake):
        for q in fake.queues[("AAPL", "5")]:
            q.put_nowait(MSG)

    outs = _run(fake, [("AAPL:5", False), ("AAPL:5", False), ("AAPL:5", True)], script)
    member1, member2, harness = (json.loads(_bars_of(o)[0]["data"]) for o in outs)
    assert member1 == member2 and "sent_ms" not in member1
    assert isinstance(harness.get("sent_ms"), int) and harness["ingest_ms"] == 1_800_000_000_010
    assert calls["n"] == 2                                    # one for the members, one for the harness


def test_frames_ready_together_leave_in_one_write_in_order(env):
    fake, calls = env

    async def script(fake):
        q = fake.queues[("AAPL", "5")][0]
        for i in range(5):
            q.put_nowait({**MSG, "bar": {**MSG["bar"], "c": 1.0 + i / 10}})

    outs = _run(fake, [("AAPL:5", False)], script)
    bar_chunks = [c for c in outs[0] if "event: bar" in c]
    assert len(bar_chunks) == 1, f"{len(bar_chunks)} writes for 5 ready frames"
    cs = [json.loads(f["data"])["bar"]["c"] for f in _bars_of(bar_chunks)]
    assert cs == [1.0, 1.1, 1.2, 1.3, 1.4]


def test_the_encode_cache_is_bounded():
    for i in range(stream._ENCODE_CACHE_MAX + 500):
        stream._encode_member_frame(_Contract(), {**MSG, "rev": i}, "rth")
    assert len(stream._ENCODE_CACHE) <= stream._ENCODE_CACHE_MAX


class _Contract:
    def stream_fields(self, sym, tf, session):
        return {"contract": 1}


def test_the_same_frame_on_an_eth_connection_is_its_own_encode(env):
    fake, calls = env

    async def script(fake):
        for q in fake.queues[("AAPL", "5")]:
            q.put_nowait(MSG)

    async def go():
        pass

    # one rth and one eth connection: the session is part of the frame's identity fields
    outs = []

    async def run_both():
        reqs, tasks = [], []
        for sess in ("rth", "eth"):
            r = _Req()
            resp = await stream.stream_bars(r, bars="AAPL:5", session=sess)
            got = []

            async def reader(it=resp.body_iterator, got=got):
                async for c in it:
                    got.append(c)

            reqs.append(r)
            outs.append(got)
            tasks.append(asyncio.ensure_future(reader()))
        await asyncio.sleep(0.05)
        await script(fake)
        await asyncio.sleep(0.2)
        for r in reqs:
            r.stop = True
        await asyncio.wait_for(asyncio.gather(*tasks), timeout=5)

    asyncio.run(run_both())
    assert all(len(_bars_of(o)) == 1 for o in outs)
    assert calls["n"] == 2
