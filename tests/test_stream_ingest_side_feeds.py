"""stream-ingest PR4c: NH/NL print counters, volume aggregates, Time & Sales.

Synthetic ZZ* symbols and prices only."""
from __future__ import annotations

import asyncio
import json

import pytest

from api.services import feed_protocol as fp
from api.services import ingest_side_feeds as sf
from api.services import trade_conditions as tc
from tests import golden_tape_harness as H
from tests.test_stream_ingest_runtime import (MIN, T0, FakeConn, Rig, _env_and_state,  # noqa: F401
                                              enc, hello, run_until, until)

NH_OWN = {"nhnl": {"ZZA": frozenset({"T"})}}
SEED = {"hod": 10.0, "lod": 9.0, "nh": 2, "nl": 1, "last": 9.5}
INELIGIBLE = sorted(tc._HL_INELIGIBLE_FALLBACK - tc._SESSION_CODES)[0]


def desired_full(gen=1, owners=None, keys=frozenset(), seeds=None, tas=frozenset()):
    return enc(fp.Desired(gen=gen, owners=owners or {}, keys=keys, nhnl_seeds=seeds or {},
                          tas_syms=tas))


def nhnl_in(conn, sym):
    return [b.nhnl[sym] for b in conn.sent if sym in b.nhnl]


def rt_in(conn):
    return [b.nhnl_rt for b in conn.sent if b.nhnl_rt]


def agg_in(conn, sym):
    return [b.agg[sym] for b in conn.sent if sym in b.agg]


def tas_in(conn, sym):
    return [x for b in conn.sent for x in b.tas.get(sym, ())]


@pytest.fixture(autouse=True)
def _pinned_filter():
    with H._pinned_condition_rules():
        yield


def T(rig, sym, ms, p, s=100, c=()):
    rig.now[0] = max(rig.now[0], ms)
    rig.rt.on_bar(sym, {"t": ms, "p": p, "s": s, "c": list(c)}, "T")


def A(rig, sym, ms, c, av):
    rig.now[0] = max(rig.now[0], ms)
    rig.rt.on_bar(sym, {"t": ms, "o": c, "h": c, "l": c, "c": c, "v": 10, "av": av}, "A")


# ── NH/NL ─────────────────────────────────────────────────────────────────────

def test_nhnl_seed_snapshot_then_print_exact_counting():
    rig = Rig()

    async def go():
        c = FakeConn([hello(), desired_full(owners=NH_OWN, seeds={"ZZA": SEED})])
        t = await run_until(c, rig.srv, lambda: nhnl_in(c, "ZZA") and rt_in(c))
        assert nhnl_in(c, "ZZA")[0]["nh"] == 2 and rt_in(c)[0] == {"hi": 0, "lo": 0}
        T(rig, "ZZA", T0 + 1000, 10.5)                    # new high
        T(rig, "ZZA", T0 + 2000, 10.4)                    # inside the range: last only
        T(rig, "ZZA", T0 + 3000, 11.0, c=[INELIGIBLE])    # ghost print: never a high
        T(rig, "ZZA", T0 + 4000, 8.9)                     # new low
        await until(lambda: nhnl_in(c, "ZZA")[-1]["nl"] == 2)
        st = nhnl_in(c, "ZZA")[-1]
        assert (st["hod"], st["nh"], st["hi_ms"]) == (10.5, 3, T0 + 1000)
        assert (st["lod"], st["nl"], st["lo_ms"], st["last"]) == (8.9, 2, T0 + 4000, 8.9)
        await until(lambda: rt_in(c)[-1] == {"hi": 1, "lo": 1})
        await c.close()
        await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_a_resent_seed_merges_and_never_moves_a_mark_backwards():
    rig = Rig()

    async def go():
        c = FakeConn([hello(), desired_full(owners=NH_OWN, seeds={"ZZA": SEED})])
        t = await run_until(c, rig.srv, lambda: nhnl_in(c, "ZZA"))
        T(rig, "ZZA", T0 + 1000, 10.5)                    # hod 10.5, nh 3
        await until(lambda: nhnl_in(c, "ZZA")[-1]["nh"] == 3)
        # the web poll saw a higher high the tape missed, and re-sends a seed whose COUNTS
        # are stale (lower than ingest's) and whose low is higher
        c.inbox.put_nowait(enc(fp.Patch(gen=1, seq=1, nhnl_seeds={
            "ZZA": {"hod": 10.8, "lod": 9.2, "nh": 2, "nl": 0, "last": 10.7}})))
        await until(lambda: nhnl_in(c, "ZZA")[-1]["hod"] == 10.8)
        st = nhnl_in(c, "ZZA")[-1]
        assert (st["nh"], st["nl"], st["lod"]) == (3, 1, 9.0), "counts and the low never go back"
        c.inbox.put_nowait(enc(fp.Patch(gen=1, seq=2, nhnl_seeds={"ZZA": None})))
        await until(lambda: rig.rt.side.status()["nhnl_symbols"] == 0)
        n = len(nhnl_in(c, "ZZA"))
        T(rig, "ZZA", T0 + 5000, 12.0)
        await asyncio.sleep(0.05)
        assert len(nhnl_in(c, "ZZA")) == n, "a dropped symbol is no longer counted"
        await c.close()
        await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_a_bad_seed_is_counted_not_fatal():
    rig = Rig()

    async def go():
        c = FakeConn([hello(), desired_full(owners=NH_OWN, seeds={"ZZA": {"hod": "x"}, "ZZB": 3})])
        t = await run_until(c, rig.srv, lambda: rig.rt.side.counters["nhnl_bad_seeds"] >= 2)
        assert rig.rt.side.status()["nhnl_symbols"] == 0
        await c.close()
        await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_nhnl_counts_equal_the_web_counter_on_the_golden_prints(monkeypatch):
    """Parity: every T print of the golden tapes through ingest's counter and through
    nhnl_live._on_trade_print (the web pod's print-exact counter) give equal marks."""
    from api.services import nhnl_live as nl
    prints = {}
    for name in H.tape_names():
        for row in H.load_tape(name)["rows"]:
            try:
                evs = json.loads(row["frame"])
            except ValueError:
                continue                                  # the tapes' deliberate garbage frames
            for ev in (evs if isinstance(evs, list) else [evs]):
                if isinstance(ev, dict) and ev.get("ev") == "T":
                    prints.setdefault(ev["sym"], []).append(ev)
    assert sum(len(v) for v in prints.values()) >= 20
    feeds = sf.SideFeeds(monotonic=lambda: 0.0)
    union = fp.DesiredUnion()
    union.hello("w", 1, 0.0)
    seeds = {}
    for sym, evs in prints.items():
        p0 = float(evs[0]["p"])
        seeds[sym] = {"hod": p0, "lod": p0, "nh": 0, "nl": 0, "last": p0}
    union.set_desired("w", fp.Desired(gen=1, nhnl_seeds=seeds), 0.0)
    feeds.sync(union)
    monkeypatch.setattr(nl, "_print_counts", {s: {"app": s, **v, "hi_ms": None, "lo_ms": None}
                                              for s, v in seeds.items()})
    monkeypatch.setattr(nl, "_rt_hi", 0, raising=False)
    monkeypatch.setattr(nl, "_rt_lo", 0, raising=False)
    for sym, evs in prints.items():
        for ev in evs:
            trade = {"t": ev["t"], "p": ev["p"], "s": ev.get("s"), "c": ev.get("c")}
            feeds.on_event(sym, trade, "T")
            nl._on_trade_print(sym, trade)
    for sym in prints:
        web = nl._print_counts[sym]
        mine = feeds._nh[sym]
        for k in ("hod", "lod", "nh", "nl", "last", "hi_ms", "lo_ms"):
            assert mine[k] == web[k], (sym, k)
    assert feeds.rt == {"hi": nl._rt_hi, "lo": nl._rt_lo}
    assert feeds.rt["hi"] + feeds.rt["lo"] > 0, "the tapes exercise new highs/lows"


# ── volume ────────────────────────────────────────────────────────────────────

def test_volume_aggregates_at_most_once_a_second_and_only_to_volume_holders():
    rig = Rig()
    vol = {"volume": {"ZZV": frozenset({"A", "AM"})}}

    async def go():
        c = FakeConn([hello("w1"), desired_full(owners=vol)])
        other = FakeConn([hello("w2"), desired_full(owners={"bars": {"ZZV": frozenset({"A"})}})])
        t = await run_until(c, rig.srv, lambda: "ZZV" in rig.rt.side._vol_syms)
        t2 = await run_until(other, rig.srv, lambda: "w2" in rig.srv.clients)
        A(rig, "ZZV", T0 + 1000, 10.0, 1_000)
        await until(lambda: agg_in(c, "ZZV"))
        A(rig, "ZZV", T0 + 1200, 10.1, 1_100)             # inside the 1 s interval: held
        A(rig, "ZZV", T0 + 1400, 10.2, 1_200)
        await asyncio.sleep(0.05)
        assert agg_in(c, "ZZV") == [(1_000, 10.0, T0 + 1000)]
        rig.now[0] += 1_100                               # the interval passes
        await until(lambda: len(agg_in(c, "ZZV")) == 2)
        assert agg_in(c, "ZZV")[-1] == (1_200, 10.2, T0 + 1400), "latest wins"
        assert agg_in(other, "ZZV") == [], "only clients holding the symbol under 'volume'"
        late = FakeConn([hello("w3"), desired_full(owners=vol)])
        t3 = await run_until(late, rig.srv, lambda: agg_in(late, "ZZV"))
        assert agg_in(late, "ZZV") == [(1_200, 10.2, T0 + 1400)], "a new connection gets the latest"
        for cc, tt in ((c, t), (other, t2), (late, t3)):
            await cc.close()
            await asyncio.wait_for(tt, 2)
    asyncio.run(go())


# ── Time & Sales ──────────────────────────────────────────────────────────────

def test_tas_prints_reach_only_tas_holders_with_their_conditions():
    rig = Rig()
    own = {"bars": {"ZZT": frozenset({"T"})}}

    async def go():
        c = FakeConn([hello("w1"), desired_full(owners=own, tas=frozenset({"ZZT"}))])
        other = FakeConn([hello("w2"), desired_full(owners=own)])
        t = await run_until(c, rig.srv, lambda: "ZZT" in rig.rt.side._tas_routes)
        t2 = await run_until(other, rig.srv, lambda: "ZZT" in rig.rt._sym_routes
                             and len(rig.rt._sym_routes["ZZT"]) == 2)
        T(rig, "ZZT", T0 + 1000, 10.0, 100, c=[12, 37])
        T(rig, "ZZT", T0 + 1001, 10.1, 50)
        await until(lambda: len(tas_in(c, "ZZT")) == 2)
        assert tas_in(c, "ZZT") == [(T0 + 1000, 10.0, 100, (12, 37)), (T0 + 1001, 10.1, 50, ())]
        # `other` holds ZZT too (its quote arrives), so the prints WOULD have reached it
        await until(lambda: any("ZZT" in b.prices for b in other.sent))
        await asyncio.sleep(0.03)
        assert tas_in(other, "ZZT") == []
        for cc, tt in ((c, t), (other, t2)):
            await cc.close()
            await asyncio.wait_for(tt, 2)
    asyncio.run(go())


def test_tas_is_capped_at_twenty_symbols_per_client():
    rig = Rig()
    syms = [f"ZZ{chr(65 + i // 26)}{chr(65 + i % 26)}" for i in range(21)]
    own = {"bars": {s: frozenset({"T"}) for s in syms}}

    async def go():
        c = FakeConn([hello(), desired_full(owners=own, tas=frozenset(syms))])
        t = await run_until(c, rig.srv, lambda: len(rig.rt.side._tas_routes) == 21)
        for i, s in enumerate(syms):
            T(rig, s, T0 + 1000 + i, 10.0)
        await until(lambda: rig.rt.side.counters["tas_rejected"] == 1)
        assert rig.rt.side.counters["tas_forwarded"] == 20
        await c.close()
        await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_status_reports_the_side_feeds():
    rig = Rig()
    st = rig.rt.status()["side_feeds"]
    assert st["rt"] == {"hi": 0, "lo": 0} and st["nhnl_symbols"] == 0


# ── review fixes: sessions, stale state, snapshots ────────────────────────────

def test_a_newer_session_seed_replaces_and_a_stale_one_is_ignored():
    rig = Rig()
    pre = {**SEED, "sk": 202611160}                        # pre-market marks
    rth = {"hod": 9.6, "lod": 9.4, "nh": 0, "nl": 0, "last": 9.5, "sk": 202611161}

    async def go():
        old = FakeConn([hello("old"), desired_full(owners=NH_OWN, seeds={"ZZA": pre})])
        t_old = await run_until(old, rig.srv, lambda: nhnl_in(old, "ZZA"))
        await old.close()                                  # leased, still holding the PRE seed
        await asyncio.wait_for(t_old, 2)
        c = FakeConn([hello("new"), desired_full(owners=NH_OWN, seeds={"ZZA": rth})])
        t = await run_until(c, rig.srv, lambda: nhnl_in(c, "ZZA"))
        st = nhnl_in(c, "ZZA")[-1]
        assert (st["hod"], st["nh"], st["sk"]) == (9.6, 0, 202611161), "RTH starts from its own seed"
        T(rig, "ZZA", T0 + 1000, 9.8)                      # below the pre-market high: still a new RTH high
        await until(lambda: nhnl_in(c, "ZZA")[-1]["nh"] == 1)
        await c.close()
        await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_a_corrected_seed_is_sent_and_a_bad_one_is_counted_once():
    rig = Rig()

    async def go():
        c = FakeConn([hello(), desired_full(owners=NH_OWN, seeds={"ZZA": {"hod": "x"}})])
        t = await run_until(c, rig.srv, lambda: rig.rt.side.counters["nhnl_bad_seeds"] == 1)
        c.inbox.put_nowait(enc(fp.Patch(gen=1, seq=1, keys_add=frozenset({("ZZA", "1")}))))
        await asyncio.sleep(0.03)
        assert rig.rt.side.counters["nhnl_bad_seeds"] == 1, "a re-sync does not re-count it"
        c.inbox.put_nowait(enc(fp.Patch(gen=1, seq=2, nhnl_seeds={"ZZA": SEED})))
        await until(lambda: nhnl_in(c, "ZZA"))
        assert nhnl_in(c, "ZZA")[-1]["nh"] == 2
        await c.close()
        await asyncio.wait_for(t, 2)
    asyncio.run(go())


def test_volume_never_sends_yesterdays_aggregate_or_a_backwards_av():
    rig = Rig()
    vol = {"volume": {"ZZV": frozenset({"A", "AM"})}}

    async def go():
        c = FakeConn([hello("w1"), desired_full(owners=vol)])
        t = await run_until(c, rig.srv, lambda: "ZZV" in rig.rt.side._vol_syms)
        A(rig, "ZZV", T0 + 1000, 10.0, 5_000)
        await until(lambda: agg_in(c, "ZZV"))
        rig.rt.on_bar("ZZV", {"t": T0 + 1100, "o": 9.0, "h": 9.0, "l": 9.0, "c": 9.0, "v": 1,
                              "av": 4_000}, "AM")          # an older AM: av went backwards
        rig.now[0] += 1_100
        await asyncio.sleep(0.05)
        assert agg_in(c, "ZZV") == [(5_000, 10.0, T0 + 1000)]
        rig.now[0] = T0 + 24 * 3600 * 1000                 # the next day
        late = FakeConn([hello("w2"), desired_full(owners=vol)])
        t2 = await run_until(late, rig.srv, lambda: "w2" in rig.srv.clients)
        await until(lambda: any(b.status for b in late.sent))
        assert agg_in(late, "ZZV") == [], "a new connection is never handed yesterday's volume"
        for cc, tt in ((c, t), (late, t2)):
            await cc.close()
            await asyncio.wait_for(tt, 2)
    asyncio.run(go())


def test_a_reconnecting_client_gets_marks_rt_and_volume_again():
    rig = Rig()
    own = {**NH_OWN, "volume": {"ZZV": frozenset({"A"})}}

    async def go():
        c = FakeConn([hello("w1"), desired_full(owners=own, seeds={"ZZA": SEED})])
        t = await run_until(c, rig.srv, lambda: nhnl_in(c, "ZZA"))
        T(rig, "ZZA", T0 + 1000, 10.5)
        A(rig, "ZZV", T0 + 1000, 10.0, 5_000)
        await until(lambda: rt_in(c) and rt_in(c)[-1]["hi"] == 1 and agg_in(c, "ZZV"))
        again = FakeConn([hello("w1", 2), desired_full(2, owners=own, seeds={"ZZA": SEED})])
        t2 = await run_until(again, rig.srv, lambda: nhnl_in(again, "ZZA") and rt_in(again)
                             and agg_in(again, "ZZV"))
        assert nhnl_in(again, "ZZA")[-1]["nh"] == 3 and rt_in(again)[-1] == {"hi": 1, "lo": 0}
        assert agg_in(again, "ZZV")[-1][0] == 5_000
        await asyncio.wait_for(t, 2)                       # the superseded connection ended
        await again.close()
        await asyncio.wait_for(t2, 2)
    asyncio.run(go())


def test_lease_expiry_releases_seeds_and_volume_symbols():
    rig = Rig()

    async def go():
        c = FakeConn([hello(), desired_full(owners={**NH_OWN, "volume": {"ZZV": frozenset({"A"})}},
                                            seeds={"ZZA": SEED})])
        t = await run_until(c, rig.srv, lambda: nhnl_in(c, "ZZA"))
        await c.close()
        await asyncio.wait_for(t, 2)
        assert rig.rt.side.status()["nhnl_symbols"] == 1, "held through the lease"
        rig.now[0] += 31_000
        rig.srv.expire()
        st = rig.rt.side.status()
        assert st["nhnl_symbols"] == 0 and st["volume_symbols"] == 0
    asyncio.run(go())


def test_when_only_a_stale_session_seed_is_left_the_newer_marks_stay():
    """The RTH client is gone (lease expired); a pod still sends its PRE seed. The
    counter must not go back to the pre-market marks."""
    feeds = sf.SideFeeds(monotonic=lambda: 0.0)
    u = fp.DesiredUnion(lease_s=1.0)
    for cid, sk, hod in (("pre", 202611160, 12.0), ("rth", 202611161, 9.6)):
        u.hello(cid, 1, 0.0)
        u.set_desired(cid, fp.Desired(gen=1, nhnl_seeds={"ZZA": {"hod": hod, "lod": 9.0, "nh": 0,
                                                                  "nl": 0, "last": 9.5, "sk": sk}}), 0.0)
    feeds.sync(u)
    assert feeds._nh["ZZA"]["sk"] == 202611161
    u.disconnect("rth", 0.0)
    u.expire(5.0)
    feeds.sync(u)
    assert (feeds._nh["ZZA"]["sk"], feeds._nh["ZZA"]["hod"]) == (202611161, 9.6)


def test_a_malformed_newest_seed_never_falls_back_to_an_older_session():
    feeds = sf.SideFeeds(monotonic=lambda: 0.0)
    u = fp.DesiredUnion()
    u.hello("pre", 1, 0.0)
    u.set_desired("pre", fp.Desired(gen=1, nhnl_seeds={"ZZA": {**SEED, "sk": 202611160}}), 0.0)
    u.hello("rth", 1, 0.0)
    u.set_desired("rth", fp.Desired(gen=1, nhnl_seeds={"ZZA": {"hod": "x", "sk": 202611161}}), 0.0)
    feeds.sync(u)
    assert "ZZA" not in feeds._nh and feeds.counters["nhnl_bad_seeds"] == 1
