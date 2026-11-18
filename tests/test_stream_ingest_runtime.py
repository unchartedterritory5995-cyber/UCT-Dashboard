"""stream-ingest PR4b: the Massive reader + data plane (ingest_runtime), and its seams.

Prices and symbols here are synthetic (ZZ*), never market data."""
from __future__ import annotations

import asyncio
import copy
import json
import socket
import threading
from datetime import datetime, timezone

import pytest

from api.services import bar_broadcaster as bbm
from api.services import bar_stream as bs
from api.services import feed_protocol as fp
from api.services import ingest_feed_server as ifs
from api.services import ingest_runtime as ir
from api.services import massive_reconnect as mr
from tests import golden_tape_harness as H
from tests.test_stream_ingest_skeleton import FakeConn, desired, enc, hello, run_until

SECRET = "test-secret-not-real"
T0 = int(datetime(2026, 11, 12, 14, 30, tzinfo=timezone.utc).timestamp() * 1000)
MIN = 60_000


@pytest.fixture(autouse=True)
def _env_and_state(monkeypatch):
    monkeypatch.setattr(ifs, "BATCH_INTERVAL_S", 0.005)
    monkeypatch.setattr(ifs, "HELLO_TIMEOUT_S", 0.5)
    for v in ("STREAM_INGEST_CONNECT", "STREAM_SCOPED_CHANNELS"):
        monkeypatch.delenv(v, raising=False)
    names = ("_active", "_active_channels", "_sub_owners", "_pending_subscribe", "_pending_unsubscribe")
    saved = {n: copy.deepcopy(getattr(bs, n)) for n in names}
    saved_running = bs._running
    yield
    for n in names:
        cur = getattr(bs, n)
        cur.clear()
        cur.update(saved[n])
    bs._running = saved_running


class Rig:
    """A runtime + feed server on an injected clock (ms) with manual timers."""

    def __init__(self, seeding=False, fetcher=None, lookback_ms=None):
        self.now = [T0]
        self.timers = []
        self.rt = ir.IngestRuntime(
            broadcaster_kw={"clock_ms": lambda: self.now[0],
                            "scheduler": lambda d, fn: self.timers.append(fn),
                            "seed_fetcher": lambda s: []},
            seed_fetcher=fetcher or (lambda s: []), seeding=seeding,
            snapshot_lookback_ms=lookback_ms)
        self.srv = ifs.IngestFeedServer(secret=SECRET, lease_s=30.0, epoch=3,
                                        monotonic=lambda: self.now[0] / 1000.0,
                                        on_delta=self.rt.on_delta, data=self.rt,
                                        limits=ir.BUFFER_LIMITS)

    def trade(self, sym, t, p, s=100):
        self.now[0] = max(self.now[0], t)
        self.rt.on_bar(sym, {"t": t, "p": p, "s": s, "c": []}, "T")

    def am(self, sym, m, o, h, l, c, v):
        self.now[0] = max(self.now[0], m + MIN)
        self.rt.on_bar(sym, {"t": m, "o": o, "h": h, "l": l, "c": c, "v": v}, "AM")

    def flush_timers(self):
        while self.timers:
            self.timers.pop(0)()


def bars_in(conn, key=None):
    out = []
    for b in conn.sent:
        for u in b.bars:
            if key is None or (u.sym, u.key) == key:
                out.append(u)
    return out


def prices_in(conn, sym):
    return [b.prices[sym] for b in conn.sent if sym in b.prices]


async def until(cond, timeout=2.0):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while not cond():
        if loop.time() > end:
            raise AssertionError("condition not reached")
        await asyncio.sleep(0.005)


OWN = {"bars": {"ZZA": frozenset({"AM", "A", "T"})}}


# ── reconnect policy (pure) ────────────────────────────────────────────────────

def test_max_connections_ladder_and_young_cap():
    t = [0.0]
    p = mr.MaxConnLadder(monotonic=lambda: t[0])
    t[0] = 10_000.0                                   # an old process: no cap
    waits = [p.auth_failed_delay("Auth rejected: status='max_connections'") for _ in range(7)]
    assert waits == [30, 60, 120, 300, 600, 600, 600] and p.strikes == 7
    p.connected()                                     # authenticating alone resets nothing
    t[0] += 5
    assert p.auth_failed_delay("max_connections") == 600
    p.connected()
    t[0] += mr.HEALTHY_S                              # ... a connection that stayed up does
    assert p.disconnect_delay(ConnectionError("reset"), 1) == mr.MIN_GAP_S and p.strikes == 0
    assert p.auth_failed_delay("max_connections") == 30

    young = mr.MaxConnLadder(monotonic=lambda: 5.0)
    assert [young.auth_failed_delay("max_connections") for _ in range(4)] == [30, 60, 60, 60]


def test_other_failures_and_disconnect_gap():
    p = mr.MaxConnLadder(monotonic=lambda: 10_000.0)
    assert p.auth_failed_delay("Auth rejected: status='auth_failed'") == 60
    assert p.disconnect_delay(ConnectionError("reset"), 1) == mr.MIN_GAP_S
    assert p.disconnect_delay(ConnectionError("reset"), 32) == 32
    assert p.disconnect_delay(RuntimeError("policy violation: max_connections"), 1) == 30
    with pytest.raises(ValueError):
        mr.MaxConnLadder(ladder=(5.0,))


def test_min_gap_comes_from_the_env_with_a_floor(monkeypatch):
    """INGEST_RECONNECT_MIN_GAP_S (2026-11-18, the second stocks connection): the wait
    after a disconnect or a clean close. Unset or junk keeps the 10 s default; nothing
    takes it under the 1 s floor; and it is what a policy built at boot uses."""
    import importlib
    for raw, want in (("", 10.0), ("2", 2.0), ("0", 1.0), ("-5", 1.0), ("soon", 10.0)):
        monkeypatch.setenv("INGEST_RECONNECT_MIN_GAP_S", raw)
        assert mr._min_gap_from_env() == want, raw
    monkeypatch.setenv("INGEST_RECONNECT_MIN_GAP_S", "2")
    fresh = importlib.reload(mr)
    try:
        p = fresh.MaxConnLadder(monotonic=lambda: 10_000.0)
        assert p.disconnect_delay(ConnectionError("reset"), 1) == 2.0
        assert p.normal_close_delay() == 2.0
        assert p.auth_failed_delay("max_connections") == 30      # a kick still climbs the ladder
    finally:
        monkeypatch.delenv("INGEST_RECONNECT_MIN_GAP_S")
        importlib.reload(mr)


def test_bar_stream_default_policy_is_the_historic_waits():
    d = bs._DefaultReconnectPolicy()
    assert d.auth_failed_delay("max_connections") == 60
    assert d.disconnect_delay(ConnectionError(), 8) == 8
    assert d.normal_close_delay() == 0 and d.note_status is None


def test_two_sockets_kicking_each_other_climb_the_ladder():
    """A kick arrives AFTER auth, as a status frame, then the socket drops (with or
    without max_connections in the reason, and possibly as a clean close)."""
    t = [0.0]
    p = mr.MaxConnLadder(monotonic=lambda: t[0])
    t[0] = 10_000.0                                   # an old process: no young cap
    waits = []
    for i in range(4):
        p.connected()
        t[0] += 2
        p.note_status("max_connections")
        waits.append(p.disconnect_delay(ConnectionError("going away"), 1) if i % 2 == 0
                     else p.normal_close_delay())
    assert waits == [30, 60, 120, 300]
    p.connected()
    t[0] += 1
    assert p.normal_close_delay() == mr.MIN_GAP_S       # a clean close without a kick: the gap


def test_kicked_connections_that_lasted_long_still_climb_to_the_top():
    """Two old processes kicking each other: each connection lives as long as the
    other side waits (>= healthy_s on the higher rungs). Those must not reset."""
    t = [0.0]
    p = mr.MaxConnLadder(monotonic=lambda: t[0])
    t[0] = 10_000.0
    waits = []
    for _ in range(6):
        p.connected()
        t[0] += 700                                     # longer than healthy_s, then kicked
        p.note_status("max_connections")
        waits.append(p.disconnect_delay(ConnectionError("going away"), 1))
    assert waits == [30, 60, 120, 300, 600, 600]


def test_a_kick_status_in_the_frame_loop_reaches_the_policy(monkeypatch):
    frames = ['[{"ev":"status","status":"max_connections","message":"kicked"}]']
    waits = _reader_with(monkeypatch, ['[{"ev":"status","status":"auth_success"}]'], frames=frames,
                         clean=True)
    # min_gap 11 s (not the 10 s ping sleep the fake lets through): a regression fails fast
    p = mr.MaxConnLadder(monotonic=lambda: 10_000.0, min_gap_s=11.0)

    async def go():
        with pytest.raises(_Stop):
            await bs._run_websocket(lambda *a: None, policy=p)
    asyncio.run(go())
    assert waits == [30] and p.maxconn_total == 1, "clean close after a kick: the ladder, not 0 s"


def test_a_clean_server_close_waits_the_gap_under_the_ladder(monkeypatch):
    waits = _reader_with(monkeypatch, ['[{"ev":"status","status":"auth_success"}]'], clean=True)
    p = mr.MaxConnLadder(monotonic=lambda: 10_000.0, min_gap_s=11.0)

    async def go():
        with pytest.raises(_Stop):
            await bs._run_websocket(lambda *a: None, policy=p)
    asyncio.run(go())
    assert waits == [11.0]


class _Stop(BaseException):
    pass


def _reader_with(monkeypatch, recv_frames, frames=(), on_close=None, clean=False):
    """bar_stream._run_websocket over a fake socket; asyncio.sleep in bar_stream raises
    _Stop after recording its argument, so each test sees exactly one wait."""
    import websockets

    waits = []

    class FakeSocket:
        def __init__(self):
            self.replies = list(recv_frames)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            if on_close:
                on_close()
            return False

        async def send(self, msg):
            pass

        async def recv(self):
            return self.replies.pop(0)

        async def ping(self):
            return asyncio.get_running_loop().create_future()

        async def close(self):
            pass

        def __aiter__(self):
            async def gen():
                for f in frames:
                    yield f
                if not clean:
                    raise ConnectionError("tape over")   # clean=True: the server closed normally
            return gen()

    real_sleep = asyncio.sleep

    async def fake_sleep(s, *a, **k):
        if s in (0, 0.25, 0.5, bs._PING_EVERY_S):
            return await real_sleep(0)
        waits.append(s)
        raise _Stop()

    monkeypatch.setattr(bs, "_API_KEY", "k-not-real")
    monkeypatch.setattr(bs, "_universe_stream_enabled", lambda: False)
    monkeypatch.setattr(websockets, "connect", lambda *a, **k: FakeSocket())
    monkeypatch.setattr(bs.asyncio, "sleep", fake_sleep)
    return waits


def test_the_reader_asks_the_policy_on_max_connections(monkeypatch):
    waits = _reader_with(monkeypatch, ['[{"ev":"status","status":"max_connections"}]'])
    p = mr.MaxConnLadder(monotonic=lambda: 10_000.0)

    async def go():
        with pytest.raises(_Stop):
            await bs._run_websocket(lambda *a: None, policy=p)
    asyncio.run(go())
    assert waits == [30] and p.strikes == 1 and p.maxconn_total == 1


def test_the_reader_tells_the_policy_it_connected_then_waits_the_gap(monkeypatch):
    waits = _reader_with(monkeypatch, ['[{"ev":"status","status":"auth_success"}]'])
    # 11 s: distinct from the reader's own 10 s ping sleep, which the fake lets through
    p = mr.MaxConnLadder(monotonic=lambda: 10_000.0, min_gap_s=11.0)
    seen = []
    p.on_connected = seen.append

    async def go():
        with pytest.raises(_Stop):
            await bs._run_websocket(lambda *a: None, policy=p)
    asyncio.run(go())
    assert seen == [1] and waits == [11.0]


def test_the_web_reader_without_a_policy_keeps_its_waits(monkeypatch):
    waits = _reader_with(monkeypatch, ['[{"ev":"status","status":"max_connections"}]'])

    async def go():
        with pytest.raises(_Stop):
            await bs._run_websocket(lambda *a: None)
    asyncio.run(go())
    assert waits == [60]


# ── BarBroadcaster seams ───────────────────────────────────────────────────────

def _bb(now):
    got = []
    b = bbm.BarBroadcaster(clock_ms=lambda: now[0], scheduler=lambda d, fn: None,
                           seed_fetcher=lambda s: [], publisher=lambda q, loop, m: got.append((q, m)))
    return b, got


def test_a_sink_gets_every_frame_including_older_t_corrections():
    now = [T0]
    b, got = _bb(now)
    sink = object()
    b.subscribe_sink("ZZA", "1", sink)
    b.push_aggregate("ZZA", {"t": T0 + 1000, "p": 10.0, "s": 5}, "T")
    now[0] = T0 + MIN + 1000
    b.push_aggregate("ZZA", {"t": T0 + MIN + 1000, "p": 11.0, "s": 5}, "T")
    b.push_aggregate("ZZA", {"t": T0, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.2, "v": 9}, "AM")
    ts = [(m["bar"]["t"], m["bar"]["final"]) for q, m in got if q is sink]
    assert ts[-1] == (T0, True), "the late-AM correction of the closed minute reaches the v2 sink"
    assert all(q is sink for q, _ in got)


def test_snapshot_bars_returns_recent_closed_finals_and_the_developing_bucket():
    now = [T0]
    b, _ = _bb(now)
    b.add_interest(["ZZA"])
    for i in range(30):                                # one trade per minute for 30 minutes
        now[0] = T0 + i * MIN + 500
        b.push_aggregate("ZZA", {"t": now[0], "p": 10.0 + i, "s": 1}, "T")
    snap = b.snapshot_bars("ZZA", "1", lookback_ms=15 * MIN)
    starts = [x["t"] for x in snap]
    hwm = T0 + 29 * MIN + 500
    assert starts == sorted(starts) and starts[-1] == T0 + 29 * MIN
    assert all(x["final"] for x in snap[:-1]) and snap[-1]["final"] is False
    assert all(t + MIN > hwm - 15 * MIN for t in starts)
    assert len(snap) == 16
    assert b.snapshot_bars("ZZB", "1") == []


def test_seed_split_reset_allows_a_second_seed():
    now = [T0 + 5 * MIN]
    calls = []
    b = bbm.BarBroadcaster(clock_ms=lambda: now[0], scheduler=lambda d, fn: None,
                           seed_fetcher=lambda s: calls.append(s) or [
                               {"t": T0, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10}])
    b.add_interest(["ZZA"])
    assert b.ensure_seeded("ZZA") is True and b.ensure_seeded("ZZA") is False
    b.reset_seed("ZZA")
    assert b.begin_seed("ZZA") is True and b.begin_seed("ZZA") is False
    assert b.apply_seed("ZZA", []) is False               # an empty seed is a failure: retry later
    assert calls == ["ZZA"]


# ── the data plane ─────────────────────────────────────────────────────────────

def test_desired_subscribes_upstream_under_the_remote_owner(monkeypatch):
    monkeypatch.setenv("STREAM_SCOPED_CHANNELS", "1")
    rig = Rig()

    async def go():
        conn = FakeConn([hello(), desired(1, {"bars": {"ZZA": frozenset({"A", "T"})},
                                              "volume": {"ZZB": frozenset({"A"})}},
                                          frozenset({("ZZA", "1")}))])
        task = await run_until(conn, rig.srv, lambda: "ZZB" in bs._sub_owners)
        assert bs._sub_owners["ZZA"] == {ir.REMOTE_OWNER: frozenset({"A", "T"})}
        assert bs._sub_owners["ZZB"] == {ir.REMOTE_OWNER: frozenset({"A"})}
        assert rig.rt._interest == {"ZZA", "ZZB"} and rig.rt._keys == {("ZZA", "1")}
        conn.inbox.put_nowait(enc(fp.Patch(gen=1, seq=1, owners={"volume": {"ZZB": frozenset()}},
                                           keys_remove=frozenset({("ZZA", "1")}))))
        await until(lambda: "ZZB" not in bs._sub_owners)
        assert rig.rt._interest == {"ZZA"} and rig.rt._keys == set()
        await conn.close()
        await asyncio.wait_for(task, 2)
    asyncio.run(go())


def test_bars_reach_only_the_clients_that_want_the_key():
    rig = Rig()

    async def go():
        c1 = FakeConn([hello("w1"), desired(1, OWN, frozenset({("ZZA", "1")}))])
        c2 = FakeConn([hello("w2"), desired(1, OWN, frozenset({("ZZA", "5")}))])
        t1 = await run_until(c1, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        t2 = await run_until(c2, rig.srv, lambda: ("ZZA", "5") in rig.rt._key_routes)
        rig.trade("ZZA", T0 + 1000, 10.0)
        await until(lambda: bars_in(c1) and bars_in(c2))
        assert {(u.sym, u.key) for u in bars_in(c1)} == {("ZZA", "1")}
        assert {(u.sym, u.key) for u in bars_in(c2)} == {("ZZA", "5")}
        assert bars_in(c1)[0].bar["c"] == 10.0 and bars_in(c1)[0].final is False
        for c, t in ((c1, t1), (c2, t2)):
            await c.close()
            await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_prices_are_coalesced_and_only_changes_are_sent():
    rig = Rig()

    async def go():
        conn = FakeConn([hello(), desired(1, OWN)])
        task = await run_until(conn, rig.srv, lambda: "ZZA" in rig.rt._sym_routes)
        rig.trade("ZZA", T0 + 1000, 10.0)
        rig.trade("ZZA", T0 + 1200, 10.5)
        await until(lambda: prices_in(conn, "ZZA"))
        n = len(prices_in(conn, "ZZA"))
        assert prices_in(conn, "ZZA")[-1]["price"] == 10.5 and n == 1, "two trades, one tick: one quote"
        rig.rt._price_dirty.add("ZZA")                  # an event that did not move the quote
        await asyncio.sleep(0.05)
        assert len(prices_in(conn, "ZZA")) == n
        await conn.close()
        await asyncio.wait_for(task, 2)
    asyncio.run(go())


def test_a_new_connection_gets_closed_finals_and_the_developing_bar():
    rig = Rig()

    async def go():
        first = FakeConn([hello("w1"), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t1 = await run_until(first, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        rig.trade("ZZA", T0 + 1000, 10.0)
        rig.trade("ZZA", T0 + MIN + 1000, 11.0)          # closes minute 0
        rig.am("ZZA", T0, 10.0, 10.4, 9.8, 10.1, 7)      # late AM: corrects the closed minute
        rig.flush_timers()
        late = FakeConn([hello("w2"), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t2 = await run_until(late, rig.srv, lambda: bars_in(late))
        snap = bars_in(late)
        assert [(u.bar["t"], u.final) for u in snap] == [(T0, True), (T0 + MIN, False)]
        assert snap[0].bar["c"] == 10.1, "the snapshot carries the CORRECTED final"
        for c, t in ((first, t1), (late, t2)):
            await c.close()
            await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_a_client_that_stalled_gets_the_lost_final_on_reconnect():
    rig = Rig()

    async def go():
        c = FakeConn([hello("w1"), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t = await run_until(c, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        rig.trade("ZZA", T0 + 1000, 10.0)
        rig.trade("ZZA", T0 + MIN + 1000, 11.0)
        rig.srv.clients["w1"].buffer._stall("synthetic")   # the pending final is dropped
        await asyncio.wait_for(t, 2)
        assert c.closed[0] == ifs.CLOSE_TRY_AGAIN
        again = FakeConn([hello("w1", 2), desired(2, OWN, frozenset({("ZZA", "1")}))])
        t2 = await run_until(again, rig.srv, lambda: bars_in(again))
        assert (T0, True) in [(u.bar["t"], u.final) for u in bars_in(again)]
        await again.close()
        await asyncio.wait_for(t2, 2)
    asyncio.run(go())


def test_a_patch_that_adds_a_key_snapshots_only_that_key():
    rig = Rig()

    async def go():
        c = FakeConn([hello(), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t = await run_until(c, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        rig.trade("ZZA", T0 + 1000, 10.0)
        await until(lambda: bars_in(c, ("ZZA", "1")))
        before = len(bars_in(c, ("ZZA", "1")))
        c.inbox.put_nowait(enc(fp.Patch(gen=1, seq=1, keys_add=frozenset({("ZZA", "5")}))))
        await until(lambda: bars_in(c, ("ZZA", "5")))
        assert len(bars_in(c, ("ZZA", "1"))) == before, "the held key is not re-sent"
        await c.close()
        await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_dropping_a_symbol_resets_its_final_watermark_in_every_live_buffer():
    rig = Rig()

    async def go():
        keep = FakeConn([hello("keep"), desired(1, {"bars": {"ZZQ": frozenset({"T"})}})])
        c = FakeConn([hello("w1"), desired(1, OWN, frozenset({("ZZA", "1")}))])
        tk = await run_until(keep, rig.srv, lambda: "keep" in rig.srv.clients)
        t = await run_until(c, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        rig.trade("ZZA", T0 + 1000, 10.0)
        rig.trade("ZZA", T0 + MIN + 1000, 11.0)
        buf = rig.srv.clients["w1"].buffer
        assert buf.final_watermark("ZZA", "1") == T0
        rig.srv.clients["keep"].buffer._final_hi[("ZZA", "1")] = T0     # a stale guard elsewhere
        c.inbox.put_nowait(enc(fp.Patch(gen=1, seq=1, owners={"bars": {"ZZA": frozenset()}},
                                        keys_remove=frozenset({("ZZA", "1")}))))
        await until(lambda: rig.rt.counters["forgets"] == 1)
        assert buf.final_watermark("ZZA", "1") is None
        assert rig.srv.clients["keep"].buffer.final_watermark("ZZA", "1") is None
        assert "ZZA" not in rig.rt.bc._minutes
        for cc, tt in ((c, t), (keep, tk)):
            await cc.close()
            await asyncio.wait_for(tt, 2)
    asyncio.run(go())


def test_a_leased_client_keeps_the_upstream_hold_until_expiry():
    rig = Rig()

    async def go():
        c = FakeConn([hello(), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t = await run_until(c, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        await c.close()
        await asyncio.wait_for(t, 2)
        assert "ZZA" in bs._sub_owners and rig.rt._keys == {("ZZA", "1")}
        assert rig.rt._key_routes == {}, "a leased client has no buffer to route to"
        rig.now[0] += 31_000
        rig.srv.expire()
        assert "ZZA" not in bs._sub_owners and rig.rt._keys == set() and rig.rt._interest == set()
    asyncio.run(go())


def test_seeds_fetch_off_the_loop_apply_on_it_and_reseed_after_a_reconnect():
    fetch_threads = []

    def fetcher(sym):
        fetch_threads.append(threading.get_ident())
        # each fetch brings one more completed minute (what REST has after a gap)
        return [{"t": T0 + i * MIN, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10}
                for i in range(len(fetch_threads))]

    rig = Rig(seeding=True, fetcher=fetcher)
    rig.now[0] = T0 + 5 * MIN

    async def go():
        loop_thread = threading.get_ident()
        c = FakeConn([hello(), desired(1, OWN, frozenset({("ZZA", "1"), ("ZZA", "5")}))])
        t = await run_until(c, rig.srv, lambda: rig.rt.counters["seeds_applied"] == 1)
        assert rig.rt.counters["seeds_started"] == 1, "one seed per symbol, not per key"
        assert fetch_threads and loop_thread not in fetch_threads
        # the first Massive connect re-seeds too: the seed above landed before the socket
        # (e.g. during the deploy-handoff grace) and cannot hold the trades it missed
        rig.rt.policy.connected()
        await until(lambda: rig.rt.counters["seeds_applied"] == 2)
        assert rig.rt.counters["reseeds"] == 1 and len(fetch_threads) == 2
        rig.rt.policy.connected()                       # a RECONNECT: every chart symbol again
        await until(lambda: rig.rt.counters["seeds_applied"] == 3)
        assert rig.rt.counters["reseeds"] == 2
        # the minute the socket "missed" (T0+1min, only in the 2nd REST fetch) reaches the
        # connected client as a closed bar on BOTH keys, not only in a later snapshot
        await until(lambda: any(u.bar["t"] == T0 + MIN and u.final for u in bars_in(c, ("ZZA", "1"))))
        # the 5m bucket is still developing; it now counts both REST minutes
        assert any(u.bar["t"] == T0 and u.bar["v"] == 20 for u in bars_in(c, ("ZZA", "5")))
        await c.close()
        await asyncio.wait_for(t, 2)
        await rig.rt.stop_reader()
    asyncio.run(go())


def test_a_snapshot_taken_before_the_seed_is_corrected_when_it_lands():
    """Interest-only symbol with live trades; a client adds a chart key; the snapshot
    has a closed bucket built from those trades alone; the seed then fixes it."""
    gate = threading.Event()

    def fetcher(sym):
        gate.wait(2)
        return [{"t": T0, "o": 5.0, "h": 9.0, "l": 4.0, "c": 6.0, "v": 900}]

    rig = Rig(seeding=True, fetcher=fetcher)

    async def go():
        c = FakeConn([hello(), desired(1, OWN)])
        t = await run_until(c, rig.srv, lambda: "ZZA" in rig.rt._sym_routes)
        rig.trade("ZZA", T0 + 30_000, 6.0, 10)             # half of minute 0, seen live
        rig.trade("ZZA", T0 + MIN + 1000, 6.5, 10)         # closes minute 0
        c.inbox.put_nowait(enc(fp.Patch(gen=1, seq=1, keys_add=frozenset({("ZZA", "1")}))))
        await until(lambda: bars_in(c, ("ZZA", "1")))
        first = [u for u in bars_in(c, ("ZZA", "1")) if u.bar["t"] == T0]
        assert first and first[0].final and first[0].bar["v"] == 10
        gate.set()
        await until(lambda: rig.rt.counters["seeds_applied"] == 1)
        await until(lambda: any(u.bar["t"] == T0 and u.bar["v"] == 900 for u in bars_in(c, ("ZZA", "1"))))
        await c.close()
        await asyncio.wait_for(t, 2)
        await rig.rt.stop_reader()
    asyncio.run(go())


def test_a_chart_key_without_channels_is_counted():
    rig = Rig()

    async def go():
        c = FakeConn([hello(), desired(1, {}, frozenset({("ZZK", "1")}))])
        t = await run_until(c, rig.srv, lambda: rig.rt.counters["keys_without_channels"] == 1)
        assert "ZZK" not in bs._sub_owners
        await c.close()
        await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_a_superseded_connection_can_no_longer_change_the_set():
    rig = Rig()

    async def go():
        old = FakeConn([hello("w1"), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t_old = await run_until(old, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        new = FakeConn([hello("w1", 1), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t_new = await run_until(new, rig.srv, lambda: rig.srv.clients["w1"].conn is new
                                and rig.srv.union.client_keys("w1"))
        old.closed = None                                # pretend the old socket still reads
        old.inbox.put_nowait(desired(1, OWN, frozenset({("ZZB", "1")})))
        await asyncio.sleep(0.05)
        assert rig.srv.union.client_keys("w1") == frozenset({("ZZA", "1")})
        for c, t in ((new, t_new), (old, t_old)):
            await c.close()
            await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_the_first_connect_waits_the_deploy_handoff_grace(monkeypatch):
    from api.services import vendor_socket_guard as g
    monkeypatch.setenv("STREAM_INGEST_CONNECT", "1")
    monkeypatch.setenv("MASSIVE_API_KEY", "k-not-real")
    monkeypatch.setattr(g, "may_open", lambda v: (True, ""))
    called = []

    async def fake_reader(on_bar, policy=None):
        called.append(asyncio.get_running_loop().time())
        await asyncio.Event().wait()
    monkeypatch.setattr(bs, "_run_websocket", fake_reader)
    rig = Rig()

    async def go():
        t0 = asyncio.get_running_loop().time()
        assert rig.rt.start_reader(grace_s=0.3) is True
        await asyncio.sleep(0.15)
        assert called == [] and rig.rt.status()["vendor_socket"] == "handoff-grace"
        await until(lambda: called)
        assert called[0] - t0 >= 0.25                   # (Windows timer granularity)
        await rig.rt.stop_reader()
    asyncio.run(go())
    assert ir.CONNECT_GRACE_S >= 30, "the default grace must outlast SIGTERM + Massive's reap"


def test_no_seeds_while_the_connection_is_not_requested():
    rig = Rig(seeding=False, fetcher=lambda s: pytest.fail("must not fetch"))

    async def go():
        c = FakeConn([hello(), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t = await run_until(c, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        await asyncio.sleep(0.02)
        assert rig.rt.counters["seeds_started"] == 0
        await c.close()
        await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_an_unsendable_bar_is_counted_and_never_breaks_the_reader():
    rig = Rig()

    async def go():
        c = FakeConn([hello(), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t = await run_until(c, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        rig.trade("ZZA", T0 + 1000, float("nan"))          # must not raise out of on_bar
        assert rig.rt.counters["bars_invalid"] >= 1
        rig.trade("ZZA", T0 + 2000, 10.0)
        await c.close()
        await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_status_is_json_safe_and_secret_free():
    rig = Rig()
    body = json.dumps(rig.srv.status(), default=str)
    assert SECRET not in body
    assert rig.rt.status()["vendor_socket"] == "none"


# ── the gates ──────────────────────────────────────────────────────────────────

def test_connect_decision_needs_every_gate(monkeypatch):
    from api.services import vendor_socket_guard as g
    monkeypatch.setattr(g, "may_open", lambda v: (True, ""))
    monkeypatch.setenv("MASSIVE_API_KEY", "k-not-real")
    assert ir.connect_decision() == (False, "STREAM_INGEST_CONNECT is not 1")
    monkeypatch.setenv("STREAM_INGEST_CONNECT", "1")
    assert ir.connect_decision() == (True, "")
    monkeypatch.delenv("MASSIVE_API_KEY")
    assert ir.connect_decision() == (False, "MASSIVE_API_KEY is not set")
    monkeypatch.setenv("MASSIVE_API_KEY", "k-not-real")
    monkeypatch.setattr(g, "may_open", lambda v: (False, "not on Railway"))
    assert ir.connect_decision() == (False, "not on Railway")


def test_the_reader_does_not_start_without_the_flag():
    rig = Rig()

    async def go():
        assert rig.rt.start_reader() is False and rig.rt._reader is None
    asyncio.run(go())


def test_live_reader_to_web_client_and_sigterm_closes_the_vendor_socket_first(monkeypatch):
    """Everything real but the vendor: a fake Massive socket plays one trade into the
    real reader on the service loop; a real websockets client on the feed gets the bar
    and the price; on stop the vendor socket closes BEFORE the clients' final batch."""
    pytest.importorskip("websockets.asyncio.server")
    import websockets
    from websockets.asyncio.client import connect

    from api import stream_ingest_main as main
    from api.services import vendor_socket_guard as g

    order = []
    go_frames = None

    class FakeMassive:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            order.append("vendor-closed")
            return False

        async def send(self, msg):
            pass

        async def recv(self):
            return '[{"ev":"status","status":"auth_success"}]'

        async def ping(self):
            return asyncio.get_running_loop().create_future()

        async def close(self):
            pass

        def __aiter__(self):
            async def gen():
                await go_frames.wait()
                yield json.dumps([{"ev": "T", "sym": "ZZA", "p": 12.5, "s": 100, "t": T0 + 1000, "c": []}])
                await asyncio.Event().wait()             # then silence until cancelled
            return gen()

    monkeypatch.setenv("PUSH_SECRET", SECRET)
    monkeypatch.setenv("STREAM_INGEST_CONNECT", "1")
    monkeypatch.setenv("MASSIVE_API_KEY", "k-not-real")
    monkeypatch.setattr(bs, "_API_KEY", "k-not-real")
    monkeypatch.setattr(bs, "_universe_stream_enabled", lambda: False)
    monkeypatch.setattr(g, "may_open", lambda v: (True, ""))
    monkeypatch.setattr(websockets, "connect", lambda *a, **k: FakeMassive())
    monkeypatch.setattr(ir, "CONNECT_GRACE_S", 0.0)
    with socket.socket() as s0:
        s0.bind(("127.0.0.1", 0))
        port = s0.getsockname()[1]

    async def go():
        nonlocal go_frames
        go_frames = asyncio.Event()
        rt = ir.IngestRuntime(seed_fetcher=lambda s: [], seeding=False)
        srv = main.build_server(rt)
        real_shutdown = srv.shutdown

        async def shutdown(*a, **k):
            order.append("clients-final")
            await real_shutdown(*a, **k)
        srv.shutdown = shutdown
        stop = asyncio.Event()
        task = asyncio.create_task(main.serve_forever(port, srv, stop))
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                await asyncio.sleep(0.02)
        async with connect(f"ws://127.0.0.1:{port}/internal/feed",
                           additional_headers={"Authorization": f"Bearer {SECRET}"}) as ws:
            await ws.send(hello("web-e2e", 1))
            await ws.send(desired(1, OWN, frozenset({("ZZA", "1")})))
            await until(lambda: ("ZZA", "1") in rt._key_routes and rt.vendor_connected)
            go_frames.set()
            got_bar = got_price = connected = False
            while not (got_bar and got_price and connected):
                b = fp.decode(await asyncio.wait_for(ws.recv(), 3))
                got_bar = got_bar or any(u.sym == "ZZA" and u.bar["c"] == 12.5 for u in b.bars)
                got_price = got_price or b.prices.get("ZZA", {}).get("price") == 12.5
                connected = connected or bool(b.status and b.status["connect"])
            stop.set()
            try:
                while True:
                    await asyncio.wait_for(ws.recv(), 3)
            except Exception:
                pass
            assert ws.close_code == ifs.CLOSE_GOING_AWAY
        await asyncio.wait_for(task, 8)
        assert order == ["vendor-closed", "clients-final"]

    asyncio.run(go())


# ── mock-Massive E2E against the golden tapes ──────────────────────────────────

@pytest.mark.skipif(not H.filter_env_is_default(),
                    reason="goldens assume TRADE_CONDITION_FILTER_ENABLED=1 (prod default)")
@pytest.mark.parametrize("name", H.tape_names())
def test_golden_tape_through_ingest_and_the_wire_equals_the_in_web_frames(name):
    """The same tape through the ingest service (real reader, its broadcaster, the
    client buffer, encode/decode, the web relay's legacy filter and rev clock) yields
    exactly the frames the in-web broadcaster's subscribers got, rev included."""
    got = H.run_tape_via_ingest(name)
    want = [l for l in H.read_golden(name) if '"frame"' in l]
    assert want, "the golden has frames"
    if got != want:
        for i, (a, b) in enumerate(zip(got, want)):
            if a != b:
                pytest.fail(f"{name}: first difference at frame {i + 1}\n got: {a}\nwant: {b}")
        pytest.fail(f"{name}: {len(got)} frames via ingest, golden has {len(want)}")


def test_a_new_symbols_partial_bucket_waits_for_its_first_seed():
    """Owner 2026-11-17: the first candle after opening a chart had the wrong body until the
    next minute. Before its first seed a NEW symbol's developing bar holds only the trades
    since the subscribe; a client that takes it as the bucket's first authoritative frame
    locks that open (liveBarMerge I2). So it is held until the seed lands."""
    gate = threading.Event()

    def fetcher(sym):
        gate.wait(2)
        return [{"t": T0, "o": 5.0, "h": 9.0, "l": 4.0, "c": 6.0, "v": 900}]

    rig = Rig(seeding=True, fetcher=fetcher)
    rig.now[0] = T0 + 30_000

    async def go():
        c = FakeConn([hello(), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t = await run_until(c, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        rig.trade("ZZA", T0 + 31_000, 6.0, 10)             # mid-bucket: NOT the open
        await asyncio.sleep(0.05)
        assert not [u for u in bars_in(c, ("ZZA", "1")) if u.bar["t"] == T0], "partial bucket leaked"
        assert rig.rt.counters["bars_held_for_seed"] >= 1
        gate.set()
        await until(lambda: rig.rt.counters["seeds_applied"] == 1)
        await until(lambda: [u for u in bars_in(c, ("ZZA", "1")) if u.bar["t"] == T0])
        first = [u for u in bars_in(c, ("ZZA", "1")) if u.bar["t"] == T0][0]
        assert first.bar["o"] == 5.0, "the first frame the client sees carries the true open"
        rig.trade("ZZA", T0 + 32_000, 6.1, 10)             # after the seed: live again
        await until(lambda: any(u.bar["c"] == 6.1 and u.bar["o"] == 5.0 for u in bars_in(c, ("ZZA", "1"))))
        await c.close()
        await asyncio.wait_for(t, 2)
        await rig.rt.stop_reader()
    asyncio.run(go())


def test_a_slow_seed_never_blanks_the_live_candle_past_the_hold():
    gate = threading.Event()
    rig = Rig(seeding=True, fetcher=lambda s: gate.wait(2) and [])
    rig.now[0] = T0 + 30_000

    async def go():
        c = FakeConn([hello(), desired(1, OWN, frozenset({("ZZA", "1")}))])
        t = await run_until(c, rig.srv, lambda: ("ZZA", "1") in rig.rt._key_routes)
        rig.trade("ZZA", T0 + 31_000, 6.0, 10)
        rig.now[0] = T0 + 31_000 + int(ir.SEED_HOLD_S * 1000) + 1000
        rig.trade("ZZA", T0 + 32_000, 6.1, 10)             # past the hold: sent
        await until(lambda: [u for u in bars_in(c, ("ZZA", "1")) if u.bar["t"] == T0])
        assert rig.rt.counters["seed_hold_expired"] == 1
        n = rig.rt.counters["seed_reoffers"]
        gate.set()                                         # then the seed FAILS: still re-offered
        await until(lambda: rig.rt.counters["seed_reoffers"] > n)
        await c.close()
        await asyncio.wait_for(t, 2)
        await rig.rt.stop_reader()
    asyncio.run(go())
