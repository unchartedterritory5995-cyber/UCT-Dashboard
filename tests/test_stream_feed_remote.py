"""stream-ingest PR5a: the web pod's remote mode (RemoteBroadcaster + FeedClient).

Synthetic ZZ* symbols and prices only."""
from __future__ import annotations

import asyncio
import copy
import socket
import threading

import pytest

from api.services import bar_stream as bs
from api.services import feed_client as fc
from api.services import feed_protocol as fp
from api.services import ingest_runtime as ir
from api.services.remote_broadcaster import RemoteBroadcaster
from tests import golden_tape_harness as H

SECRET = "test-secret-not-real"
T0 = 1794493800000
MIN = 60_000


@pytest.fixture(autouse=True)
def _state(monkeypatch):
    for v in ("STREAM_INGEST_CONNECT", "STREAM_SCOPED_CHANNELS", "STREAM_FEED_SOURCE"):
        monkeypatch.delenv(v, raising=False)
    names = ("_active", "_active_channels", "_sub_owners", "_pending_subscribe", "_pending_unsubscribe")
    saved = {n: copy.deepcopy(getattr(bs, n)) for n in names}
    # start_remote() flips process-wide state: restore it for every later test
    monkeypatch.setattr(bs, "_record_only", False)
    for name in ("_client", "_task", "_stop"):
        monkeypatch.setattr(fc, name, getattr(fc, name))
    yield
    for n in names:
        cur = getattr(bs, n)
        cur.clear()
        cur.update(saved[n])


def bar(t, c, final=False, v=10):
    return {"t": t, "o": c, "h": c, "l": c, "c": c, "v": v, "final": final}


def batch(seq, bars=(), prices=None, epoch=1):
    return fp.Batch(epoch=epoch, seq=seq,
                    bars=tuple(fp.BarUpdate(s, k, {x: y for x, y in b.items() if x != "final"}, b["final"])
                               for s, k, b in bars),
                    prices=prices or {})


def drain(q):
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


class Clock:
    def __init__(self):
        self.ms = T0
        self.mono = 100.0


def make_rb(**kw):
    c = Clock()
    hooks = {"first": [], "last": []}
    rb = RemoteBroadcaster(on_first_subscribe=hooks["first"].append,
                           on_last_unsubscribe=hooks["last"].append,
                           clock_ms=lambda: c.ms, monotonic=lambda: c.mono, **kw)
    return rb, c, hooks


# ── the full web-side path against the goldens ────────────────────────────────

@pytest.mark.skipif(not H.filter_env_is_default(),
                    reason="goldens assume TRADE_CONDITION_FILTER_ENABLED=1 (prod default)")
@pytest.mark.parametrize("name", H.tape_names())
def test_golden_tape_through_ingest_and_the_remote_broadcaster_equals_the_in_web_frames(name):
    """tape -> real reader -> ingest -> wire -> RemoteBroadcaster -> SSE subscriber queues:
    exactly the frames the in-web broadcaster's subscribers got, rev included."""
    got = H.run_tape_via_ingest(name, web="remote")
    want = [l for l in H.read_golden(name) if '"frame"' in l]
    assert want
    if got != want:
        for i, (a, b) in enumerate(zip(got, want)):
            if a != b:
                pytest.fail(f"{name}: first difference at frame {i + 1}\n got: {a}\nwant: {b}")
        pytest.fail(f"{name}: {len(got)} frames via remote, golden has {len(want)}")


# ── RemoteBroadcaster ─────────────────────────────────────────────────────────

def test_subscribe_hooks_snapshot_and_v2_legacy_routing():
    async def go():
        rb, c, hooks = make_rb()
        legacy = rb.subscribe("ZZA", "1")
        v2 = rb.subscribe("ZZA", "1", v2=True)
        assert hooks["first"] == ["ZZA"], "first subscriber of the symbol subscribes upstream once"
        assert rb.desired_keys() == {("ZZA", "1")}
        rb.apply_batch(batch(1, [("ZZA", "1", bar(T0, 10.0))]))
        rb.apply_batch(batch(2, [("ZZA", "1", bar(T0 + MIN, 11.0))]))
        rb.apply_batch(batch(3, [("ZZA", "1", bar(T0, 10.2, final=True))]))   # older-t correction
        assert [m["bar"]["t"] for m in drain(legacy)] == [T0, T0 + MIN]
        got = drain(v2)
        assert [(m["bar"]["t"], m["bar"]["final"]) for m in got] == [(T0, False), (T0 + MIN, False), (T0, True)]
        revs = [m["rev"] for m in got]
        assert revs == sorted(revs) and len(set(revs)) == 3
        late = rb.subscribe("ZZA", "1")
        snap = drain(late)
        assert len(snap) == 1 and snap[0]["bar"]["t"] == T0 + MIN and "rev" not in snap[0]
        assert rb.get_partial("ZZA", "1")["t"] == T0 + MIN
    asyncio.run(go())


def test_quotes_go_stale_after_five_quiet_seconds():
    async def go():
        rb, c, _ = make_rb()
        rb.add_interest(["ZZA"])
        rb.apply_batch(batch(1, prices={"ZZA": {"price": 10.0, "ts": T0, "trade_ts": T0 + 5, "volume": 7}}))
        assert rb.get_last_price("ZZA") == {"price": 10.0, "ts": T0, "trade_ts": T0 + 5, "volume": 7}
        c.mono += 4.9
        assert rb.get_last_price("ZZA") is not None
        c.mono += 0.2
        assert rb.get_last_price("ZZA") is None, "a quiet feed must hand the quote to Finnhub"
        rb.apply_batch(batch(2))                        # a heartbeat revives it
        assert rb.get_last_price("ZZA")["price"] == 10.0
    asyncio.run(go())


def test_the_last_client_leaving_drops_the_symbol_but_one_client_leaving_does_not():
    async def go():
        rb, c, hooks = make_rb()
        a = rb.subscribe("ZZA", "1")
        rb.add_interest(["ZZA"])
        rb.apply_batch(batch(1, [("ZZA", "1", bar(T0 + MIN, 11.0))],
                             prices={"ZZA": {"price": 11.0, "ts": T0}}))
        rb.unsubscribe("ZZA", "1", a)
        assert hooks["last"] == [] and rb.legacy.high("ZZA", "1") == T0 + MIN, "interest still holds it"
        assert rb.get_last_price("ZZA") is not None
        rb.remove_interest(["ZZA"])
        assert hooks["last"] == ["ZZA"]
        assert rb.get_last_price("ZZA") is not None, "kept until ingest has been told"
        rb.sent_desired(frozenset(), frozenset())          # the feed client told ingest
        assert rb.legacy.high("ZZA", "1") is None
        assert rb.revs.peek("ZZA", "1") is None and rb.get_last_price("ZZA") is None
    asyncio.run(go())


def test_a_new_epoch_resets_the_mirror_but_not_the_queues_or_the_legacy_filter():
    async def go():
        rb, c, _ = make_rb()
        q = rb.subscribe("ZZA", "1")
        rb.apply_batch(batch(1, [("ZZA", "1", bar(T0 + MIN, 11.0))]))
        drain(q)
        rb.reset_mirror()
        assert rb.get_partial("ZZA", "1") is None
        rb.apply_batch(batch(1, [("ZZA", "1", bar(T0, 10.0, final=True))], epoch=2))
        assert drain(q) == [], "legacy never sees a t older than one it got, across an epoch"
        assert rb.legacy.high("ZZA", "1") == T0 + MIN
    asyncio.run(go())


def test_a_full_subscriber_queue_drops_its_oldest():
    async def go():
        rb, c, _ = make_rb()
        q = rb.subscribe("ZZA", "1", v2=True)
        for i in range(70):
            rb.apply_batch(batch(i + 1, [("ZZA", "1", bar(T0 + i * MIN, 10.0 + i))]))
        assert q.qsize() == 64 and rb.counters["dropped"] == 6
        assert drain(q)[-1]["bar"]["t"] == T0 + 69 * MIN
    asyncio.run(go())


def test_a_slow_reader_gets_the_CURRENT_value_of_the_forming_candle_not_a_backlog():
    """⭐ 2026-11-17: 18% of bar frames were dropped from full queues in one session, and a reader that
    fell behind drained up to 64 stale frames before the newest price (6-12 s behind). Forming frames of
    one candle are last-value-wins: the queue holds ONE, the newest, and nothing is dropped."""
    async def go():
        rb, c, _ = make_rb()
        q = rb.subscribe("ZZA", "1", v2=True)
        for i in range(100):
            rb.apply_batch(batch(i + 1, [("ZZA", "1", bar(T0, 10.0 + i / 100))]))
        assert q.qsize() == 1
        assert rb.counters["dropped"] == 0 and rb.counters["conflated"] == 99
        assert drain(q)[0]["bar"]["c"] == 10.99
        assert rb.get_status()["conflated_total"] == 99
    asyncio.run(go())


def test_quotes_are_not_served_as_live_while_ingest_says_its_vendor_socket_is_down():
    """⛔ 2026-11-17 audit: status batches keep arriving while ingest's Massive socket is DOWN, so "a
    batch arrived" kept the frozen quote served as live and the quote feed never fell back."""
    rb, c, _ = make_rb()
    rb.subscribe("ZZA", "1", v2=True)
    rb.apply_batch(batch(1, prices={"ZZA": {"price": 5.0, "ts": T0}}))
    assert rb.get_last_price("ZZA")["price"] == 5.0
    rb.apply_batch(fp.Batch(epoch=1, seq=2, status={"epoch": 1, "connect": False, "closing": False, "clients": 1}))
    assert rb.feed_fresh() is False and rb.get_last_price("ZZA") is None     # the caller falls back
    assert rb.get_status()["vendor_up"] is False
    rb.apply_batch(fp.Batch(epoch=1, seq=3, status={"epoch": 1, "connect": True, "closing": False, "clients": 1}))
    assert rb.feed_fresh() is True and rb.get_last_price("ZZA")["price"] == 5.0
    # a batch WITHOUT a status leaves ingest's last word in place
    rb.apply_batch(batch(4, prices={"ZZA": {"price": 6.0, "ts": T0 + 1000}}))
    assert rb.get_last_price("ZZA")["price"] == 6.0


def test_a_final_is_never_replaced_or_overtaken_and_order_is_kept():
    async def go():
        rb, c, _ = make_rb()
        q = rb.subscribe("ZZA", "1", v2=True)
        seq = iter(range(1, 100))
        put = lambda t, cl, final=False: rb.apply_batch(batch(next(seq), [("ZZA", "1", bar(t, cl, final=final))]))
        put(T0, 10.0)                 # forming, candle 1
        put(T0, 10.1, final=True)     # its final takes the forming frame's place (same candle)
        put(T0 + MIN, 11.0)           # candle 2 forming: appended behind the final
        put(T0 + MIN, 11.1)           # replaces candle 2's forming frame
        put(T0, 10.2, final=True)     # a late correction of candle 1: appended, never merged backwards
        put(T0 + MIN, 11.2)           # candle 2 again: a final sits last, so it is appended
        got = [(m["bar"]["t"], m["bar"]["c"], bool(m["bar"].get("final"))) for m in drain(q)]
        assert got == [(T0, 10.1, True), (T0 + MIN, 11.1, False), (T0, 10.2, True), (T0 + MIN, 11.2, False)]
        assert rb.counters["dropped"] == 0
        # a correction of the SAME candle right behind its final: both finals are delivered
        put(T0 + 2 * MIN, 12.0, final=True)
        put(T0 + 2 * MIN, 12.5, final=True)
        got = [(m["bar"]["t"], m["bar"]["c"]) for m in drain(q)]
        assert got == [(T0 + 2 * MIN, 12.0), (T0 + 2 * MIN, 12.5)]
    asyncio.run(go())


# ── the remote-mode guards ────────────────────────────────────────────────────

def test_feed_source_is_local_unless_remote_is_asked(monkeypatch):
    assert fc.feed_source() == "local"
    monkeypatch.setenv("STREAM_FEED_SOURCE", " Remote ")
    assert fc.feed_source() == "remote"
    monkeypatch.setenv("STREAM_FEED_SOURCE", "bogus")
    assert fc.feed_source() == "local"


def test_remote_mode_never_opens_the_web_pods_massive_socket(monkeypatch):
    """Invariant 11: with STREAM_FEED_SOURCE=remote, start_stream starts nothing,
    even where the vendor guard would allow a socket."""
    monkeypatch.setenv("STREAM_FEED_SOURCE", "remote")
    monkeypatch.setenv("ALLOW_LOCAL_VENDOR_SOCKETS", "1")
    monkeypatch.setattr(bs, "_ws_loop", None)
    before = {t.name for t in threading.enumerate()}
    bs.start_stream(lambda *a: None)
    after = {t.name for t in threading.enumerate()}
    assert bs._ws_loop is None and "bar-stream" not in after - before


def test_remote_startup_installs_the_remote_broadcaster(monkeypatch):
    from api.services import bar_broadcaster as bbm
    monkeypatch.setattr(bbm, "_singleton", None)
    monkeypatch.setattr(fc, "_client", None)
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    monkeypatch.setenv("STREAM_INGEST_URL", "ws://127.0.0.1:9/internal/feed")

    async def go():
        client = fc.start_remote()
        assert isinstance(bbm.get_broadcaster(), RemoteBroadcaster)
        assert fc.status()["source"] == "remote"
        fc._task.cancel()
        try:
            await fc._task
        except asyncio.CancelledError:
            pass
        return client
    asyncio.run(go())


def test_main_branches_on_the_feed_source():
    src = (H.TAPE_DIR.parents[2] / "api" / "main.py").read_text(encoding="utf-8")
    i = src.index('if os.environ.get("STREAM_BARS_ENABLED") == "1" and _stream_feed_remote():')
    j = src.index("bar_stream.start_stream(on_bar=_on_bar)")
    assert i < j and "_feed_client.start_remote()" in src[i:j]


# ── FeedClient against the real ingest feed server (both ends real websockets) ──

def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _until(cond, timeout=3.0):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while not cond():
        if loop.time() > end:
            raise AssertionError("condition not reached")
        await asyncio.sleep(0.01)


def test_feed_client_end_to_end_with_the_ingest_service(monkeypatch):
    """web RemoteBroadcaster + FeedClient <-> real stream-ingest server: desired reaches
    the union, live trades reach the web subscriber and the quote, and an ingest restart
    (new epoch) is followed by a reconnect, a mirror reset and a fresh snapshot."""
    pytest.importorskip("websockets.asyncio.server")
    from api import stream_ingest_main as main
    from api.services import ingest_feed_server as ifs
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    monkeypatch.setattr(ifs, "BATCH_INTERVAL_S", 0.01)
    monkeypatch.setattr(ifs, "STATUS_INTERVAL_S", 0.02)
    monkeypatch.setattr(fc, "RECONNECT_MIN_S", 0.05)
    # No Massive socket in a test: ingest reports its vendor socket through this property, in every
    # status batch (`connect`), and web serves quotes as live only while it says up.
    vendor = {"up": True}
    monkeypatch.setattr(ir.IngestRuntime, "vendor_connected", property(lambda self: vendor["up"]))
    port = _free_port()
    owners = {"bars": {"ZZA": frozenset({"AM", "A", "T"})}}

    async def serve(rt):
        srv = main.build_server(rt)
        stop = asyncio.Event()
        task = asyncio.create_task(main.serve_forever(port, srv, stop))
        for _ in range(200):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                await asyncio.sleep(0.02)
        return srv, stop, task

    async def go():
        rt = ir.IngestRuntime(seed_fetcher=lambda s: [], seeding=False)
        srv, stop, task = await serve(rt)
        rb = RemoteBroadcaster()
        client = fc.FeedClient(rb, url=f"ws://127.0.0.1:{port}/internal/feed", secret=SECRET,
                               client_id="web-e2e", owners_fn=lambda: owners)
        cstop = asyncio.Event()
        ctask = asyncio.create_task(client.run(cstop))
        q = rb.subscribe("ZZA", "1", v2=True)
        rb.add_interest(["ZZA"])
        await _until(lambda: ("ZZA", "1") in srv.union.keys() and "ZZA" in srv.union.channels())
        await _until(lambda: ("ZZA", "1") in rt._key_routes)
        rt.on_bar("ZZA", {"t": T0 + 1000, "p": 10.5, "s": 100, "c": []}, "T")
        await _until(lambda: not q.empty() and rb.get_last_price("ZZA") is not None)
        assert q.get_nowait()["bar"]["c"] == 10.5 and rb.get_last_price("ZZA")["price"] == 10.5
        # ingest's Massive socket drops: over the real wire, the quote stops being served as live
        vendor["up"] = False
        await _until(lambda: rb.get_last_price("ZZA") is None)
        assert rb.get_status()["vendor_up"] is False
        vendor["up"] = True
        await _until(lambda: rb.get_last_price("ZZA") is not None)
        epoch1 = srv.epoch

        stop.set()                                     # ingest restarts: a new process, a new epoch
        await asyncio.wait_for(task, 10)
        rt2 = ir.IngestRuntime(seed_fetcher=lambda s: [], seeding=False)
        rt2.on_bar("ZZA", {"t": T0 + 2000, "p": 10.7, "s": 100, "c": []}, "T")   # before any client
        srv2, stop2, task2 = await serve(rt2)
        assert srv2.epoch != epoch1
        await _until(lambda: client.counters["epoch_resets"] >= 2, timeout=5)
        await _until(lambda: rb.get_last_price("ZZA") is not None
                     and rb.get_last_price("ZZA")["price"] == 10.7, timeout=5)
        assert client.connected and client.counters["connects"] >= 2
        cstop.set()
        stop2.set()
        await asyncio.wait_for(task2, 10)
        await asyncio.wait_for(ctask, 5)

    asyncio.run(go())


# ── FeedClient sequencing (scripted connections) ──────────────────────────────

class _ScriptedConn:
    """One fake feed connection: plays its batches, records what the client sent."""

    def __init__(self, batches, log):
        self.batches = list(batches)
        self.log = log

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def send(self, data):
        self.log.append(fp.decode(data))

    def __aiter__(self):
        async def gen():
            for b in self.batches:
                yield fp.encode(b)
            await asyncio.Event().wait()                # then quiet until the client leaves
        return gen()


def test_feed_client_resets_on_a_new_epoch_and_resyncs_on_a_gap(monkeypatch):
    monkeypatch.setattr(fc, "RECONNECT_MIN_S", 0.01)
    sent = []
    scripts = [
        # connection 1: epoch 1 in order, then a NEW epoch (ingest restarted), then a gap
        [batch(1, [("ZZA", "1", bar(T0, 10.0))]), batch(2, [("ZZA", "1", bar(T0 + MIN, 11.0))]),
         batch(1, prices={"ZZB": {"price": 5.0, "ts": T0}}, epoch=2),
         batch(3, [("ZZA", "1", bar(T0 + 2 * MIN, 12.0))], epoch=2)],
        # connection 2: a fresh stream
        [batch(1, [("ZZA", "1", bar(T0 + 3 * MIN, 13.0))], epoch=2)],
    ]

    def connect(url, **kw):
        return _ScriptedConn(scripts.pop(0) if scripts else [], sent)

    async def go():
        rb, c, _ = make_rb()
        client = fc.FeedClient(rb, url="ws://x/internal/feed", secret=SECRET, client_id="w",
                               owners_fn=lambda: {}, connect=connect)
        rb.subscribe("ZZA", "1", v2=True)
        stop = asyncio.Event()
        task = asyncio.create_task(client.run(stop))
        # reset 1 = connection 1's first batch; reset 2 = epoch 2 (ingest restarted): mirror emptied
        await _until(lambda: client.counters["epoch_resets"] == 2 and rb.get_partial("ZZA", "1") is None)
        await _until(lambda: client.counters["resyncs"] == 1)
        await _until(lambda: client.counters["connects"] == 2 and rb.get_partial("ZZA", "1") is not None)
        assert rb.get_partial("ZZA", "1")["t"] == T0 + 3 * MIN, "the gapped batch was never applied"
        assert client.counters["epoch_resets"] == 3, "a new connection starts a fresh stream"
        assert rb._sent_keys == {("ZZA", "1")}, "a real send records what ingest was told"
        hellos = [m for m in sent if isinstance(m, fp.Hello)]
        assert len(hellos) == 2 and hellos[1].gen > hellos[0].gen
        assert all(isinstance(m, (fp.Hello, fp.Desired)) for m in sent)
        stop.set()
        await asyncio.wait_for(task, 2)
    asyncio.run(go())



ODD = ["US:A50", "^VIX", "spy", "TOOLONGTICKER1"]   # namespaced, index, lower case, too long


def test_an_odd_symbol_in_the_desired_set_never_costs_the_feed(monkeypatch, caplog):
    """⛔⛔ PRODUCTION 2026-11-17, 10:39-11:49 CT. One subscribed symbol outside the ticker rule made
    `fp.encode` raise MalformedMessage before the session counted as connected; the client retried
    every 10 s with the same set, 409 times, and no live bar or quote reached any chart on the pod
    for 70 minutes. Now the session connects, the good symbols are sent and fed, the odd ones are
    left out and NAMED."""
    monkeypatch.setattr(fc, "RECONNECT_MIN_S", 0.01)
    sent = []
    scripts = [[batch(1, [("ZZA", "1", bar(T0, 10.0))])]]

    def connect(url, **kw):
        return _ScriptedConn(scripts.pop(0) if scripts else [], sent)

    owners = {"bars": {"ZZA": frozenset({"AM"}), **{s: frozenset({"AM"}) for s in ODD}}}

    async def go():
        rb, c, _ = make_rb()
        client = fc.FeedClient(rb, url="ws://x/internal/feed", secret=SECRET, client_id="w",
                               owners_fn=lambda: owners, connect=connect)
        rb.subscribe("ZZA", "1", v2=True)
        stop = asyncio.Event()
        task = asyncio.create_task(client.run(stop))
        await _until(lambda: client.counters["connects"] == 1 and rb.get_partial("ZZA", "1") is not None)
        assert client.counters["disconnects"] == 0, "the session must not fail on an odd symbol"
        desired = [m for m in sent if isinstance(m, fp.Desired)]
        assert desired and set(desired[0].owners["bars"]) == {"ZZA"}
        assert client.counters["unsendable_syms"] == len(ODD)
        stop.set()
        await asyncio.wait_for(task, 2)
    with caplog.at_level("WARNING"):
        asyncio.run(go())
    named = " ".join(r.getMessage() for r in caplog.records if "left out of the desired set" in r.getMessage())
    assert all(repr(s) in named for s in ODD), named


def test_an_odd_symbol_is_left_out_of_every_part_of_the_desired_set():
    rb, c, _ = make_rb()
    client = fc.FeedClient(rb, url="ws://x/internal/feed", secret=SECRET, client_id="w",
                           owners_fn=lambda: {"bars": {"ZZA": frozenset({"AM"}), "US:A50": frozenset({"AM"})}})
    d = client._sendable(fp.Desired(gen=1, owners={"bars": {"ZZA": frozenset({"AM"}), "US:A50": frozenset({"AM"})}},
                                    keys=frozenset({("ZZA", "1"), ("^VIX", "1")}),
                                    nhnl_seeds={"ZZA": {"h": 1}, "spy": {"h": 2}}, tas_syms=frozenset({"ZZA", "TOOLONGTICKER1"})))
    assert set(d.owners["bars"]) == {"ZZA"} and d.keys == frozenset({("ZZA", "1")})
    assert set(d.nhnl_seeds) == {"ZZA"} and d.tas_syms == frozenset({"ZZA"})
    fp.encode(d)                                  # the message is sendable now
    clean = fp.Desired(gen=1, owners={"bars": {"ZZA": frozenset({"AM"})}}, keys=frozenset({("ZZA", "1")}))
    assert client._sendable(clean) is clean       # nothing odd: the very same message, untouched


def test_a_key_readded_before_ingest_was_told_still_gets_its_snapshot():
    """Fast tf toggle: unsubscribe + resubscribe inside the debounce. Ingest never sees
    a change (so sends no new snapshot); the mirror must still answer at once."""
    async def go():
        rb, c, _ = make_rb()
        a = rb.subscribe("ZZA", "1")
        rb.sent_desired({("ZZA", "1")}, {"ZZA"})
        rb.apply_batch(batch(1, [("ZZA", "1", bar(T0 + MIN, 11.0))]))
        rb.unsubscribe("ZZA", "1", a)
        b = rb.subscribe("ZZA", "1")                   # before the next desired is sent
        snap = drain(b)
        assert snap and snap[0]["bar"]["t"] == T0 + MIN
        assert rb.get_partial("ZZA", "1")["t"] == T0 + MIN
    asyncio.run(go())


def test_prices_for_any_owner_held_symbol_are_kept():
    """A symbol only some other bar_stream owner holds (no chart, no quote interest):
    local mode's minute map answered get_last_price for it, so must the mirror."""
    async def go():
        rb, c, _ = make_rb()
        rb.sent_desired(frozenset(), {"ZZV"})
        rb.apply_batch(batch(1, prices={"ZZV": {"price": 3.0, "ts": T0}, "ZZX": {"price": 1.0, "ts": T0}}))
        assert rb.get_last_price("ZZV")["price"] == 3.0
        assert rb.get_last_price("ZZX") is None, "a symbol nobody holds is not mirrored"
    asyncio.run(go())


def test_status_carries_what_the_push_rail_monitor_reads():
    from api.services import bars_rail_monitor as mon
    async def go():
        rb, c, _ = make_rb()
        q = rb.subscribe("ZZA", "1", v2=True)
        rb.apply_batch(batch(1, [("ZZA", "1", bar(T0, 10.0))]))
        st = rb.get_status()
        for k in ("bars_emitted_total", "bars_dropped_total", "subscriber_pairs", "last_emit_age_s"):
            assert k in st, k
        assert st["bars_emitted_total"] == 1
        obs = mon.observe({"enabled": True, "broadcaster": st}, token="t", now=0.0)
        assert obs["kind"] != mon.UNREADABLE, obs.get("reason")
        assert obs["emitted"] == 1 and obs["dropped"] == 0
    asyncio.run(go())


def test_main_lifespan_is_still_the_async_context_manager_and_local_is_the_default():
    """Review catch: a helper inserted under @asynccontextmanager took the decorator off
    lifespan, which made `_stream_feed_remote()` an always-truthy object (remote mode
    forced on) and lifespan a bare generator."""
    import ast
    src = (H.TAPE_DIR.parents[2] / "api" / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    fns = {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    life = fns["lifespan"]
    assert isinstance(life, ast.AsyncFunctionDef)
    assert [ast.unparse(d) for d in life.decorator_list] == ["asynccontextmanager"]
    helper = fns["_stream_feed_remote"]
    assert isinstance(helper, ast.FunctionDef) and helper.decorator_list == []
    ns: dict = {}
    exec(compile(ast.Module(body=[helper], type_ignores=[]), "main.py", "exec"), ns)
    assert ns["_stream_feed_remote"]() is False


def test_remote_mode_records_owner_holds_without_queueing(monkeypatch):
    monkeypatch.setattr(bs, "_record_only", True)
    bs.subscribe_symbols(["ZZR"], owner="nhnl", channels=["T"])
    assert "ZZR" in bs._sub_owners and "ZZR" not in bs._pending_subscribe
    bs.unsubscribe_symbols(["ZZR"], owner="nhnl")
    assert "ZZR" not in bs._sub_owners and "ZZR" not in bs._pending_unsubscribe
