"""stream-ingest PR5b: NH/NL, the volume push and Time & Sales in the web pod's remote mode.

Synthetic ZZ* symbols and prices only."""
from __future__ import annotations

import copy
import json

import pytest

from api.services import feed_protocol as fp
from api.services import ingest_side_feeds as sf
from api.services import nhnl_live as nl
from api.services import time_and_sales as ts
from api.services import volume_live as vl
from api.services.remote_side_feeds import RemoteSideFeeds, session_key
from tests import golden_tape_harness as H

T0 = 1794493800000


@pytest.fixture(autouse=True)
def _nhnl_state(monkeypatch):
    monkeypatch.setattr(nl, "_print_counts", {})
    monkeypatch.setattr(nl, "_rt_hi", 0)
    monkeypatch.setattr(nl, "_rt_lo", 0)
    monkeypatch.setattr(nl, "_state", {**nl._state, "date": "2026-11-16", "window": "rth"})
    monkeypatch.setattr(ts, "_watchers", {})


def seed_pc(prov, hod=10.0, lod=9.0, nh=2, n_l=1, last=9.5):
    nl._print_counts[prov] = {"app": prov, "hod": hod, "lod": lod, "nh": nh, "nl": n_l,
                              "last": last, "hi_ms": None, "lo_ms": None}


def test_session_keys_grow_through_the_day_and_across_days():
    ks = [session_key("2026-11-16", w) for w in ("pre", "rth", "post")] + [session_key("2026-11-17", "pre")]
    assert ks == sorted(ks) and len(set(ks)) == 4
    assert session_key(None, "rth") == 0


def test_nhnl_seeds_are_frozen_at_first_sight_and_follow_the_print_set():
    side = RemoteSideFeeds()
    seed_pc("ZZA")
    seeds, _ = side.desired_extras()
    assert seeds == {"ZZA": {"hod": 10.0, "lod": 9.0, "nh": 2, "nl": 1, "last": 9.5,
                             "sk": session_key("2026-11-16", "rth")}}
    nl._print_counts["ZZA"].update(hod=11.0, nh=3)          # live counts move on...
    assert side.desired_extras()[0] == seeds, "...the seed does not (no desired churn)"
    nl._state["window"] = "post"                            # a new session re-seeds
    assert side.desired_extras()[0]["ZZA"]["sk"] == session_key("2026-11-16", "post")
    del nl._print_counts["ZZA"]
    assert side.desired_extras()[0] == {}


def test_tas_syms_are_the_watched_symbols():
    ts._watchers.update({"ZZT": 2, "ZZU": 0})
    assert RemoteSideFeeds().desired_extras()[1] == {"ZZT"}


def test_aggregates_reach_the_volume_push(monkeypatch):
    calls = []
    monkeypatch.setattr(vl, "on_aggregate", lambda s, p, k: calls.append((s, p, k)))
    RemoteSideFeeds().apply(fp.Batch(epoch=1, seq=1, agg={"ZZV": (1_000.0, 10.0, T0)}))
    assert calls == [("ZZV", {"av": 1_000.0, "c": 10.0, "t": T0}, "A")]


def test_tas_prints_reach_the_tape_and_gaps_are_counted(monkeypatch):
    calls = []
    monkeypatch.setattr(ts, "on_trade", lambda s, t: calls.append((s, t)))
    side = RemoteSideFeeds()
    side.apply(fp.Batch(epoch=1, seq=1, tas={"ZZT": (fp.TasGap(3, T0, T0 + 5),
                                                     (T0 + 9, 10.0, 100, (12, 37)),
                                                     (T0 + 10, 10.1, 50, None))}))
    assert calls == [("ZZT", {"t": T0 + 9, "p": 10.0, "s": 100, "c": [12, 37]}),
                     ("ZZT", {"t": T0 + 10, "p": 10.1, "s": 50, "c": []})]
    assert side.counters["tas_gaps"] == 3


def test_marks_fold_into_the_print_counts_only_for_the_current_seed():
    side = RemoteSideFeeds()
    seed_pc("ZZA")
    sk = side.desired_extras()[0]["ZZA"]["sk"]
    m = {"hod": 10.5, "lod": 9.0, "nh": 3, "nl": 1, "last": 10.5, "hi_ms": T0, "lo_ms": None}
    side.apply(fp.Batch(epoch=1, seq=1, nhnl={"ZZA": {**m, "sk": sk}, "ZZB": {**m, "sk": sk}}))
    assert nl._print_counts["ZZA"]["nh"] == 3 and nl._print_counts["ZZA"]["hi_ms"] == T0
    assert "ZZB" not in nl._print_counts and side.counters["nhnl_unknown"] == 1
    side.apply(fp.Batch(epoch=1, seq=2, nhnl={"ZZA": {**m, "nh": 9, "sk": sk - 1}}))
    assert nl._print_counts["ZZA"]["nh"] == 3, "another session's marks never land"


def test_rt_counters_add_only_increases_within_an_epoch():
    side = RemoteSideFeeds()
    for i, (hi, lo) in enumerate([(5, 2), (7, 2), (7, 3)]):
        side.apply(fp.Batch(epoch=1, seq=i + 1, nhnl_rt={"hi": hi, "lo": lo}))
    assert (nl._rt_hi, nl._rt_lo) == (2, 1), "the first value is a baseline"
    side.new_epoch()                                      # ingest restarted: counts from 0
    side.apply(fp.Batch(epoch=2, seq=1, nhnl_rt={"hi": 1, "lo": 0}))
    side.apply(fp.Batch(epoch=2, seq=2, nhnl_rt={"hi": 4, "lo": 0}))
    assert (nl._rt_hi, nl._rt_lo) == (5, 1)


def test_remote_nhnl_equals_the_local_listener_on_the_golden_prints(monkeypatch):
    """End to end on the golden tapes' T prints: web seeds (RemoteSideFeeds) -> ingest
    (SideFeeds counting, a client buffer, the wire) -> web fold (RemoteSideFeeds), versus
    nhnl_live's own local listener on the same prints. Marks and rt must be equal."""
    prints = {}
    for name in H.tape_names():
        for row in H.load_tape(name)["rows"]:
            try:
                evs = json.loads(row["frame"])
            except ValueError:
                continue
            for ev in (evs if isinstance(evs, list) else [evs]):
                if isinstance(ev, dict) and ev.get("ev") == "T":
                    prints.setdefault(ev["sym"], []).append(ev)
    for sym, evs in prints.items():
        p0 = float(evs[0]["p"])
        seed_pc(sym, hod=p0, lod=p0, nh=0, n_l=0, last=p0)
    local = copy.deepcopy(nl._print_counts)

    # remote: web -> ingest
    side = RemoteSideFeeds()
    seeds, _ = side.desired_extras()
    union = fp.DesiredUnion()
    union.hello("web", 1, 0.0)
    union.set_desired("web", fp.Desired(gen=1, nhnl_seeds=seeds), 0.0)
    feeds = sf.SideFeeds(monotonic=lambda: 0.0)
    feeds.sync(union)

    class C:
        client_id = "web"
        buffer = fp.CoalescingBuffer(1)
    feeds.client_updated(C, union, fresh=True)
    first = fp.decode(fp.encode(C.buffer.drain()))        # the connect snapshot (rt baseline)
    side.apply(first)
    seq = 1
    with H._pinned_condition_rules():
        for sym, evs in prints.items():
            for ev in evs:
                feeds.on_event(sym, {"t": ev["t"], "p": ev["p"], "s": ev.get("s"), "c": ev.get("c")}, "T")
                feeds.flush()
                b = C.buffer.drain()
                if b is not None:
                    seq += 1
                    side.apply(fp.decode(fp.encode(b)))   # ingest -> web, through the wire
        remote_counts = copy.deepcopy(nl._print_counts)
        remote_rt = (nl._rt_hi, nl._rt_lo)

        # local: the web listener itself
        monkeypatch.setattr(nl, "_print_counts", local)
        monkeypatch.setattr(nl, "_rt_hi", 0)
        monkeypatch.setattr(nl, "_rt_lo", 0)
        for sym, evs in prints.items():
            for ev in evs:
                nl._on_trade_print(sym, {"t": ev["t"], "p": ev["p"], "s": ev.get("s"), "c": ev.get("c")})
    for sym in prints:
        for k in ("hod", "lod", "nh", "nl", "last", "hi_ms", "lo_ms"):
            assert remote_counts[sym][k] == local[sym][k], (sym, k)
    assert remote_rt == (nl._rt_hi, nl._rt_lo) and sum(remote_rt) > 0


def test_the_feed_client_asks_for_and_hands_over_the_side_feeds(monkeypatch):
    """FeedClient wiring: the desired set carries seeds + T&S symbols, every applied batch
    reaches the side feeds, and a new epoch restarts the rt baseline."""
    import asyncio

    from api.services import feed_client as fc
    from tests.test_stream_feed_remote import _ScriptedConn, _until, batch, make_rb

    class Side:
        def __init__(self):
            self.applied, self.epochs, self.connects = [], 0, 0

        def on_connect(self):
            self.connects += 1

        def desired_extras(self):
            return {"ZZA": {"hod": 1.0, "lod": 1.0, "sk": 7}}, frozenset({"ZZT"})

        def apply(self, b):
            self.applied.append((b.epoch, b.seq))

        def new_epoch(self):
            self.epochs += 1

        def status(self):
            return {}

    sent = []
    scripts = [[batch(1), batch(2), batch(1, epoch=2)]]

    def connect(url, **kw):
        return _ScriptedConn(scripts.pop(0) if scripts else [], sent)

    async def go():
        rb, c, _ = make_rb()
        side = Side()
        client = fc.FeedClient(rb, url="ws://x/internal/feed", secret="s", client_id="w",
                               owners_fn=lambda: {}, connect=connect, side=side)
        stop = asyncio.Event()
        task = asyncio.create_task(client.run(stop))
        await _until(lambda: len(side.applied) == 3)
        assert side.applied == [(1, 1), (1, 2), (2, 1)] and side.epochs == 2
        assert side.connects == 1, "every connection re-seeds"
        d = next(m for m in sent if isinstance(m, fp.Desired))
        assert d.nhnl_seeds == {"ZZA": {"hod": 1.0, "lod": 1.0, "sk": 7}} and d.tas_syms == {"ZZT"}
        stop.set()
        await asyncio.wait_for(task, 2)
    asyncio.run(go())



def _one_ingest(side, prints_by_sym):
    """A fresh ingest SideFeeds seeded from the web's desired; play prints; fold back."""
    seeds, _ = side.desired_extras()
    union = fp.DesiredUnion()
    union.hello("web", 1, 0.0)
    union.set_desired("web", fp.Desired(gen=1, nhnl_seeds=seeds), 0.0)
    feeds = sf.SideFeeds(monotonic=lambda: 0.0)
    feeds.sync(union)

    class C:
        client_id = "web"
        buffer = fp.CoalescingBuffer(1)
    feeds.client_updated(C, union, fresh=True)
    side.apply(fp.decode(fp.encode(C.buffer.drain())))
    with H._pinned_condition_rules():
        for sym, ps in prints_by_sym.items():
            for t, p in ps:
                feeds.on_event(sym, {"t": t, "p": p, "s": 100, "c": []}, "T")
                feeds.flush()
                b = C.buffer.drain()
                if b is not None:
                    side.apply(fp.decode(fp.encode(b)))


def test_an_ingest_restart_mid_session_never_rolls_the_counts_back():
    """Review repro: ingest loses its marks; the reconnect must re-seed from the LIVE
    counts (on_connect), and a stale mark must never move a count backwards."""
    side = RemoteSideFeeds()
    seed_pc("ZZA", hod=10.0, lod=9.0, nh=0, n_l=0, last=9.5)
    side.on_connect()
    _one_ingest(side, {"ZZA": [(T0 + 1, 10.5), (T0 + 2, 11.0), (T0 + 3, 11.5)]})
    assert (nl._print_counts["ZZA"]["hod"], nl._print_counts["ZZA"]["nh"]) == (11.5, 3)
    side.new_epoch()
    side.on_connect()                                    # ingest restarted: a new connection
    _one_ingest(side, {"ZZA": [(T0 + 4, 10.6)]})          # below the true high
    pc = nl._print_counts["ZZA"]
    assert (pc["hod"], pc["nh"]) == (11.5, 3), "no rollback, and no high counted twice"
    assert nl._rt_hi == 3


def test_a_stale_mark_never_moves_a_count_back():
    side = RemoteSideFeeds()
    seed_pc("ZZA", hod=12.0, lod=8.0, nh=5, n_l=4)
    sk = side.desired_extras()[0]["ZZA"]["sk"]
    side.apply(fp.Batch(epoch=1, seq=1, nhnl={"ZZA": {"hod": 10.0, "lod": 9.0, "nh": 1, "nl": 1,
                                                     "last": 9.5, "hi_ms": T0, "lo_ms": T0, "sk": sk}}))
    pc = nl._print_counts["ZZA"]
    assert (pc["hod"], pc["lod"], pc["nh"], pc["nl"]) == (12.0, 8.0, 5, 4)
    assert pc["hi_ms"] is None and pc["lo_ms"] is None and pc["last"] == 9.5


def test_a_non_finite_mark_is_never_seeded():
    side = RemoteSideFeeds()
    seed_pc("ZZA")
    seed_pc("ZZB", hod=float("inf"))
    seeds, _ = side.desired_extras()
    assert set(seeds) == {"ZZA"} and side.counters["bad_seeds"] == 1
    fp.encode(fp.Desired(gen=1, nhnl_seeds=seeds))        # the message stays sendable


def test_seeds_do_not_wait_for_the_scanners_main_lock():
    import threading
    side = RemoteSideFeeds()
    seed_pc("ZZA")
    out = []
    with nl._lock:                                        # the scanner mid-tick
        t = threading.Thread(target=lambda: out.append(side.desired_extras()))
        t.start()
        t.join(2)
    assert out and "ZZA" in out[0][0], "the event loop must not block on nhnl_live._lock"


def test_a_tas_gap_or_new_epoch_restarts_the_tick_direction(monkeypatch):
    monkeypatch.setattr(ts, "_tapes", {})
    ts._tapes["ZZT"] = ts._Tape()
    ts._tapes["ZZT"].last_price, ts._tapes["ZZT"].last_dir = 10.0, "up"
    monkeypatch.setattr(ts, "on_trade", lambda s, t: None)
    side = RemoteSideFeeds()
    side.apply(fp.Batch(epoch=1, seq=1, tas={"ZZT": (fp.TasGap(2, T0, T0 + 1),)}))
    assert ts._tapes["ZZT"].last_price is None and ts._tapes["ZZT"].last_dir == ""
    ts._tapes["ZZT"].last_price = 11.0
    side.new_epoch()
    assert ts._tapes["ZZT"].last_price is None


def test_one_failing_part_does_not_lose_the_others(monkeypatch):
    monkeypatch.setattr(vl, "on_aggregate", lambda *a: (_ for _ in ()).throw(RuntimeError("x")))
    side = RemoteSideFeeds()
    seed_pc("ZZA")
    sk = side.desired_extras()[0]["ZZA"]["sk"]
    side.apply(fp.Batch(epoch=1, seq=1, agg={"ZZV": (1.0, 1.0, T0)},
                        nhnl={"ZZA": {"hod": 10.5, "lod": 9.0, "nh": 3, "nl": 1, "last": 10.5,
                                      "hi_ms": T0, "lo_ms": None, "sk": sk}}))
    assert nl._print_counts["ZZA"]["nh"] == 3 and side.counters["errors"] == 1


def test_a_scanner_holding_its_lock_never_stalls_the_feed_or_the_loop():
    """Owner 2026-11-17, 1-6 s all-symbol price freezes: the side feeds take threading locks
    (volume_live._lock, nhnl_live._print_lock) that the scanners hold across a universe
    walk. Applied on the uvicorn loop, every batch waited and every SSE stream froze. In
    production they run on the SideWorker thread: the bars/prices mirror and the loop keep
    going while a scanner holds its lock, and the side feeds catch up in order after."""
    import asyncio
    import threading

    from api.services import feed_client as fc
    from tests.test_stream_feed_remote import _ScriptedConn, _until, batch, make_rb

    scanner_lock = threading.Lock()

    class Side:
        def __init__(self):
            self.seen = []

        def on_connect(self):
            pass

        def desired_extras(self):
            return {}, frozenset()

        def apply(self, b):
            with scanner_lock:                       # what volume_live.on_aggregate does
                self.seen.append(("apply", b.epoch, b.seq))

        def new_epoch(self):
            self.seen.append(("epoch",))

        def status(self):
            return {}

    def side_batch(seq, epoch=1):
        b = batch(seq, epoch=epoch)
        return fp.Batch(epoch=b.epoch, seq=b.seq, bars=b.bars, prices=b.prices,
                        agg={"ZZV": (1.0, 1.0, 1_000)})

    scripts = [[side_batch(1), side_batch(2), side_batch(1, epoch=2)]]

    def connect(url, **kw):
        return _ScriptedConn(scripts.pop(0) if scripts else [], [])

    async def go():
        rb, _, _ = make_rb()
        side = Side()
        client = fc.FeedClient(rb, url="ws://x/internal/feed", secret="s", client_id="w",
                               owners_fn=lambda: {}, connect=connect, side=side, side_thread=True)
        stop = asyncio.Event()
        scanner_lock.acquire()                       # a scanner mid-walk
        try:
            task = asyncio.create_task(client.run(stop))
            loop = asyncio.get_running_loop()
            t0 = loop.time()
            await _until(lambda: client.counters["batches"] == 3)
            await asyncio.sleep(0.05)                # the loop still runs freely
            assert loop.time() - t0 < 1.0
            assert not [x for x in side.seen if x[0] == "apply"], "nothing applied while the scanner holds its lock"
        finally:
            scanner_lock.release()
        await _until(lambda: len(side.seen) == 5)
        assert side.seen == [("epoch",), ("apply", 1, 1), ("apply", 1, 2), ("epoch",), ("apply", 2, 1)]
        assert client.status()["side_worker"]["dropped"] == 0
        stop.set()
        await asyncio.wait_for(task, 2)
        client.side_worker.close()
    asyncio.run(go())


def test_production_runs_the_side_feeds_off_the_loop():
    import inspect

    from api.services import feed_client as fc
    assert "side_thread=True" in inspect.getsource(fc.start_remote)
