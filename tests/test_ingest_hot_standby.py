"""HOT STANDBY (INGEST_HOT_STANDBY=1): two Massive sockets with the same subscriptions, each event
applied once, and a drop of either socket is not a gap.

Massive confirmed (support, 2026-11-19) that both of our stocks connections may carry the same channels
at once. bar_stream runs both inside stream-ingest (one process, so the serving tier never sees two
feeds), and:
  * every AM/A/T event arrives twice and reaches on_bar ONCE (ingest_core.EventDedup);
  * a corrected aggregate (same window, new values) is NOT a duplicate;
  * while one socket is down the other keeps delivering;
  * only a connect while NO socket was live is a gap: the tier's new epoch (mark_connected) and the
    runtime's re-seed (policy.on_connected) happen then, never when the standby (re)connects under a
    live primary;
  * a (un)subscribe queued while both are live reaches BOTH sockets;
  * flag off: exactly one socket, as before.
"""
import asyncio
import json

import pytest

from api.services import bar_stream as bs
from api.services import ingest_core
from api.services import massive_reconnect as mr

AUTH_OK = '[{"ev":"status","status":"auth_success"}]'


def trade(q, sym="AAPL", p=100.0):
    return json.dumps([{"ev": "T", "sym": sym, "p": p, "s": 10, "t": 1795000000000 + q, "q": q, "i": str(q), "x": 4}])


# ── the duplicate filter ─────────────────────────────────────────────────────────────────────────────
class TestEventDedup:
    def test_an_identical_event_is_applied_once(self):
        d = ingest_core.EventDedup()
        ev = json.loads(trade(1))[0]
        assert d.first(ev) is True
        assert d.first(dict(ev)) is False
        assert d.stats()["dropped"] == 1

    def test_a_corrected_aggregate_for_the_same_window_is_not_a_duplicate(self):
        d = ingest_core.EventDedup()
        am = {"ev": "AM", "sym": "AAPL", "s": 1, "e": 2, "o": 1, "h": 2, "l": 1, "c": 1.5, "v": 100}
        assert d.first(am) is True
        assert d.first({**am, "c": 1.6, "v": 120}) is True       # re-sent with corrected values
        assert d.first(dict(am)) is False                        # the exact copy is still dropped

    def test_status_and_unknown_events_always_pass(self):
        d = ingest_core.EventDedup()
        st = {"ev": "status", "status": "success"}
        assert d.first(st) and d.first(dict(st)) and d.first("not a dict")

    def test_memory_is_bounded_by_the_window(self):
        t = [0.0]
        d = ingest_core.EventDedup(window_s=10.0, monotonic=lambda: t[0])
        ev = json.loads(trade(7))[0]
        assert d.first(ev) is True
        t[0] = 4.0
        assert d.first(ev) is False                  # within the window
        t[0] = 30.0
        assert d.first(ev) is True                   # long gone: remembered at most `window_s`
        assert d.stats()["remembered"] == 1


def test_apply_frame_with_the_filter_applies_each_event_once():
    got, counted = [], []
    ctx = ingest_core.FrameContext(on_bar=lambda s, b, k: got.append((s, k, b.get("t"))), active=set(),
                                   trade_listeners=[], count_event=lambda ec, ev: counted.append(ec),
                                   dedup=ingest_core.EventDedup().first)
    for frame in (trade(1), trade(1), trade(2), trade(2)):    # each delivered by both sockets
        ingest_core.apply_frame(frame, ctx)
    assert [g[2] for g in got] == [1795000000001, 1795000000002]
    assert counted == ["T", "T"]                              # telemetry counts unique events


# ── two sockets over fakes ───────────────────────────────────────────────────────────────────────────
class FakeSocket:
    def __init__(self, name):
        self.name = name
        self.sent = []
        self.q = asyncio.Queue()
        self.replies = [AUTH_OK]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def send(self, msg):
        self.sent.append(msg)

    async def recv(self):
        return self.replies.pop(0)

    async def ping(self):
        f = asyncio.get_running_loop().create_future()
        f.set_result(None)
        return f

    async def close(self):
        await self.q.put(None)

    def __aiter__(self):
        async def gen():
            while True:
                f = await self.q.get()
                if f is None:
                    return
                if f == "DROP":
                    raise ConnectionError("dropped")
                yield f
        return gen()


@pytest.fixture
def world(monkeypatch):
    import websockets
    from api.services import bars_live_ingest
    sockets = []

    def connect(*a, **k):
        s = FakeSocket(f"s{len(sockets) + 1}")
        sockets.append(s)
        return s

    marks = []
    monkeypatch.setattr(websockets, "connect", connect)
    monkeypatch.setattr(bs, "_API_KEY", "k-not-real")
    monkeypatch.setattr(bs, "_universe_stream_enabled", lambda: True)
    monkeypatch.setattr(bars_live_ingest, "mark_connected", lambda *a, **k: marks.append(1))
    monkeypatch.setattr(bars_live_ingest, "start_flusher", lambda *a, **k: None)
    monkeypatch.setattr(bars_live_ingest, "on_am", lambda *a, **k: None)
    monkeypatch.setattr(bs, "STANDBY_START_DELAY_S", 0.05)
    monkeypatch.setattr(bs, "_PING_EVERY_S", 3600)
    monkeypatch.setattr(bs, "_live_sockets", set())
    monkeypatch.setattr(bs, "_hot", {"enabled": False, "dedup": None, "connects": [0, 0], "gaps": 0})
    with bs._state_lock:
        bs._pending_subscribe.clear()
        bs._pending_unsubscribe.clear()
    return {"sockets": sockets, "marks": marks}


async def _until(cond, timeout=3.0):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while not cond():
        if loop.time() > end:
            raise AssertionError("condition not reached")
        await asyncio.sleep(0.01)


def test_two_sockets_each_event_once_a_drop_is_not_a_gap(world, monkeypatch):
    monkeypatch.setenv("INGEST_HOT_STANDBY", "1")
    got = []
    primary = mr.MaxConnLadder(min_gap_s=0.05)
    standby = mr.MaxConnLadder(min_gap_s=0.05)
    reseeds = []
    primary.on_connected = reseeds.append
    standby.on_connected = lambda n: reseeds.append(("standby", n))
    S = world["sockets"]

    async def go():
        task = asyncio.create_task(bs._run_websocket(lambda s, b, k: got.append(b.get("t")),
                                                     policy=primary, standby_policy=standby))
        try:
            await _until(lambda: len(bs._live_sockets) == 2)
            a, b = S[0], S[1]
            # the same event on both sockets: applied once
            await a.q.put(trade(1)); await b.q.put(trade(1))
            await _until(lambda: len(got) >= 1)
            await asyncio.sleep(0.05)
            assert got == [1795000000001]
            # a subscription queued while both are live reaches BOTH
            bs.subscribe_symbols(["XYZ"], owner="test")
            await _until(lambda: any("XYZ" in m for m in a.sent) and any("XYZ" in m for m in b.sent))
            # the primary drops; the standby keeps delivering
            await a.q.put("DROP")
            await _until(lambda: len(bs._live_sockets) == 1)
            await b.q.put(trade(2))
            await _until(lambda: 1795000000002 in got)
            # the primary comes back under the live standby: no gap, no epoch, no re-seed
            await _until(lambda: len(S) == 3 and len(bs._live_sockets) == 2)
            await S[2].q.put(trade(3)); await b.q.put(trade(3))
            await _until(lambda: 1795000000003 in got)
            await asyncio.sleep(0.05)
        finally:
            task.cancel()
            try:
                await task
            except BaseException:
                pass

    asyncio.run(go())
    assert got == [1795000000001, 1795000000002, 1795000000003]
    assert reseeds == [1], "only the first connect (a real gap) re-seeds"
    assert world["marks"] == [1], "only a gap starts a new epoch on the serving tier"
    st = bs.hot_standby_status()
    assert st["enabled"] and st["connects"] == [2, 1] and st["gaps"] == 1
    assert st["dedup"]["dropped"] == 2
    # the reconnected primary resubscribed the active set (it holds XYZ)
    assert any("XYZ" in m for m in S[2].sent)


def test_both_down_is_a_gap_again(world, monkeypatch):
    monkeypatch.setenv("INGEST_HOT_STANDBY", "1")
    primary = mr.MaxConnLadder(min_gap_s=0.05)
    standby = mr.MaxConnLadder(min_gap_s=0.05)
    reseeds = []
    primary.on_connected = reseeds.append
    S = world["sockets"]

    async def go():
        task = asyncio.create_task(bs._run_websocket(lambda *a: None, policy=primary, standby_policy=standby))
        try:
            await _until(lambda: len(bs._live_sockets) == 2)
            await S[0].q.put("DROP"); await S[1].q.put("DROP")
            await _until(lambda: len(S) >= 4 and len(bs._live_sockets) == 2)
        finally:
            task.cancel()
            try:
                await task
            except BaseException:
                pass

    asyncio.run(go())
    st = bs.hot_standby_status()
    assert st["gaps"] == 2, "both sockets down, then one back: that IS a gap"
    assert len(world["marks"]) == 2


def test_flag_off_opens_exactly_one_socket(world, monkeypatch):
    monkeypatch.delenv("INGEST_HOT_STANDBY", raising=False)
    primary = mr.MaxConnLadder(min_gap_s=0.05)
    standby = mr.MaxConnLadder(min_gap_s=0.05)
    got = []
    S = world["sockets"]

    async def go():
        task = asyncio.create_task(bs._run_websocket(lambda s, b, k: got.append(b.get("t")),
                                                     policy=primary, standby_policy=standby))
        try:
            await _until(lambda: len(S) == 1 and bs._running)
            await S[0].q.put(trade(1)); await S[0].q.put(trade(1))
            await _until(lambda: len(got) == 2)       # no filter with one socket: as before
            await asyncio.sleep(0.2)
        finally:
            task.cancel()
            try:
                await task
            except BaseException:
                pass

    asyncio.run(go())
    assert len(S) == 1
    assert bs.hot_standby_status()["enabled"] is False


def test_a_reconnect_does_not_swallow_a_subscription_the_other_socket_still_has_to_send(world, monkeypatch):
    """The historic single socket cleared the queue on (re)connect: its resubscribe carried the whole
    set. With two, a queue cleared by the reconnecting socket would never reach the LIVE one."""
    monkeypatch.setenv("INGEST_HOT_STANDBY", "1")
    primary = mr.MaxConnLadder(min_gap_s=0.0)
    standby = mr.MaxConnLadder(min_gap_s=0.05)
    S = world["sockets"]

    # The drain is HELD until the primary has reconnected, so the reconnect provably runs first.
    gate = {}
    real_drain = bs._drain_pending_broadcast

    async def gated_drain():
        await gate["open"].wait()
        await real_drain()
    monkeypatch.setattr(bs, "_drain_pending_broadcast", gated_drain)

    async def go():
        gate["open"] = asyncio.Event()
        task = asyncio.create_task(bs._run_websocket(lambda *a: None, policy=primary, standby_policy=standby))
        try:
            await _until(lambda: len(bs._live_sockets) == 2)
            b = S[1]
            await S[0].q.put("DROP")
            await _until(lambda: len(bs._live_sockets) == 1)
            bs.subscribe_symbols(["ZZZ"], owner="test")             # queued, the drain held
            await _until(lambda: len(S) == 3 and len(bs._live_sockets) == 2)   # the primary is back first
            assert any("ZZZ" in m for m in S[2].sent)                # (its resubscribe carried it)
            gate["open"].set()                                        # now the drain runs
            await _until(lambda: any("ZZZ" in m for m in b.sent))   # ...and the live standby still gets it
        finally:
            task.cancel()
            try:
                await task
            except BaseException:
                pass

    asyncio.run(go())


def test_liveness_counts_only_this_sockets_frames(monkeypatch):
    """A dead socket must be closed even while the OTHER socket's traffic moves the global counter."""
    monkeypatch.setattr(bs, "_PING_EVERY_S", 0.02)
    monkeypatch.setattr(bs, "LIVENESS_S", 0.1)

    class Dead:
        closed = False

        async def ping(self):
            return asyncio.get_running_loop().create_future()      # a pong that never comes

        async def close(self):
            self.closed = True

    async def go():
        ws, frames = Dead(), [0]
        watch = asyncio.create_task(bs._liveness_watch(ws, frames=frames))
        for _ in range(100):                                         # the other socket keeps sending
            bs._feed_frames += 1                                     # for the WHOLE wait (1 s)
            await asyncio.sleep(0.01)
            if watch.done():
                break
        done = watch.done()
        watch.cancel()
        return done and ws.closed

    assert asyncio.run(go()) is True
