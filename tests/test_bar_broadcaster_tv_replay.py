"""Replay proof for the live bar stream (bar_broadcaster), TradingView standard.

Synthetic Massive T / AM / A sequences are pushed through the REAL broadcaster
(subscribe -> push_aggregate -> throttle/flush -> subscriber queue) and the
emitted bars are compared with bars computed OFFLINE from the same events by an
independent batch reference (`_offline_bars`). Covers: out-of-order trades and
AM bars, late trades at a bucket boundary, SIP-filtered condition codes, A
events (must be inert), mid-bucket subscribe + seed (D8), AM replacing only its
own minute (D6), the late AM correction of a closed bucket (D7), the trailing
flush after a throttled burst (D9) and TradingView 60m RTH/ETH alignment.

All prices here are synthetic.
"""
from __future__ import annotations

import asyncio
import random
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bar_broadcaster as bbm
from api.services import trade_conditions as tc
from api.services.bar_rollup import tv_bucket_bounds, tv_bucket_start

ET = ZoneInfo("America/New_York")
MIN = 60_000


def et_ms(y, mo, d, h, mi, s=0, ms=0):
    return int(datetime(y, mo, d, h, mi, s, tzinfo=ET).timestamp()) * 1000 + ms


DAY = (2026, 11, 10)  # a regular session day, EST


@pytest.fixture(autouse=True)
def _filter_on(monkeypatch):
    monkeypatch.setattr(tc, "FILTER_ENABLED", True)


class Harness:
    """Real broadcaster + fake clock + manual trailing-flush scheduler."""

    def __init__(self, seed_fetcher=None):
        self.now = 1_000_000
        self.pending = []
        self.bb = bbm.BarBroadcaster(
            clock_ms=lambda: self.now,
            scheduler=lambda delay, fn: self.pending.append((self.now + int(delay * 1000), fn)),
            seed_fetcher=seed_fetcher,
        )
        self.queues = {}

    def sub(self, sym, tf, session="rth", v2=True):
        q = self.bb.subscribe(sym, tf, session, v2=v2)
        self.queues[(sym, tf, session) + (() if v2 else ("legacy",))] = q
        return q

    def advance(self, ms):
        self.now += ms
        due = [p for p in self.pending if p[0] <= self.now]
        self.pending = [p for p in self.pending if p[0] > self.now]
        for _, fn in sorted(due, key=lambda p: p[0]):
            fn()

    def settle(self):
        """Fire every pending trailing flush (time passes, no more input)."""
        while self.pending:
            self.advance(1000)


async def drain(q):
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


def last_per_bucket(msgs):
    seen = {}
    for m in msgs:
        seen[m["bar"]["t"]] = m["bar"]
    return seen


# ── Independent offline reference ─────────────────────────────────────────────

def _offline_minutes(events):
    """events: list of (kind, payload) in ARRIVAL order -> {minute: (o,h,l,c,v)}."""
    am = {}
    trades = {}
    for i, (kind, p) in enumerate(events):
        if kind == "AM":
            am[p["t"] // MIN * MIN] = (p["o"], p["h"], p["l"], p["c"], p["v"])
        elif kind == "T":
            trades.setdefault(p["t"] // MIN * MIN, []).append((p["t"], i, p))
    out = dict(am)
    for m, lst in trades.items():
        if m in out:
            continue
        lst.sort(key=lambda x: (x[0], x[1]))
        o = h = l = c = None
        v = 0
        for _, _, p in lst:
            hl_ok, last_ok = tc.classify(p.get("c"))
            v += p["s"]
            if last_ok:
                if o is None:
                    o = p["p"]
                c = p["p"]
            if hl_ok:
                h = p["p"] if h is None else max(h, p["p"])
                l = p["p"] if l is None else min(l, p["p"])
        out[m] = (o, h, l, c, v)
    return out


def _offline_bars(events, tf, session):
    mins = _offline_minutes(events)
    buckets = {}
    for m in sorted(mins):
        buckets.setdefault(tv_bucket_start(m, tf, session), []).append(mins[m])
    bars = {}
    for s, rows in buckets.items():
        priced = [r for r in rows if r[0] is not None]
        if not priced:
            continue
        o, c = priced[0][0], priced[-1][3]
        hs = [r[1] for r in rows if r[1] is not None] + [o, c]
        ls = [r[2] for r in rows if r[2] is not None] + [o, c]
        bars[s] = {"t": s, "o": o, "h": max(hs), "l": min(ls), "c": c,
                   "v": sum(r[4] for r in rows)}
    return bars


def _ohlcv(bar):
    return {k: bar[k] for k in ("t", "o", "h", "l", "c", "v")}


# ── Synthetic tape ────────────────────────────────────────────────────────────

_CONDS = [None, [], [0], [14], [37], [37], [33], [12], [12, 37], [15], [30], [2]]


def _tape(rng, start_ms, minutes, am_mode):
    """Trades with jittered (out-of-order) arrival, plus an AM per minute that
    arrives ~1.5 s after the minute ends. am_mode: 'none' | 'consistent' |
    'corrective' (AM differs from the trades = authoritative correction)."""
    trades = []
    px = 50.0
    for mi in range(minutes):
        m0 = start_ms + mi * MIN
        n = rng.randint(3, 25)
        for _ in range(n):
            px = round(max(1.0, px + rng.uniform(-0.3, 0.3)), 2)
            spike = rng.random() < 0.08
            p = round(px + (rng.choice([-1, 1]) * 2.5 if spike else 0), 2)
            cond = [37] if spike else rng.choice(_CONDS)
            trades.append({"t": m0 + rng.randint(0, MIN - 1), "p": p,
                           "s": rng.choice([1, 5, 100, 200, 300]), "c": cond})
    trades.sort(key=lambda t: t["t"])
    # arrival = trade time + network jitter (reorders, incl. across minute edges)
    arrivals = [(t["t"] + rng.randint(0, 900), ("T", t)) for t in trades]
    if am_mode != "none":
        ref = _offline_minutes([("T", t) for t in trades])
        for m, (o, h, l, c, v) in ref.items():
            if o is None:
                continue
            h = max(o, c) if h is None else h
            l = min(o, c) if l is None else l
            if am_mode == "corrective" and rng.random() < 0.5:
                h = round(h - 0.05, 2) if h > max(o, c) + 0.05 else h
                v = max(1, v - rng.randint(0, 50))
            bar = {"t": m, "o": o, "h": max(h, o, c), "l": min(l, o, c), "c": c, "v": v}
            delay = 1500 + rng.randint(0, 3000)
            if rng.random() < 0.1:
                delay += 2 * MIN  # badly out-of-order AM
            arrivals.append((m + MIN + delay, ("AM", bar)))
        # A events every second: must be inert
        for sec in range(0, minutes * 60, 7):
            arrivals.append((start_ms + sec * 1000 + 999,
                             ("A", {"t": start_ms + sec * 1000, "o": 1.0, "h": 999.0,
                                    "l": 0.5, "c": 777.0, "v": 1, "av": 123})))
    arrivals.sort(key=lambda a: a[0])
    return [a[1] for a in arrivals], [a[0] for a in arrivals]


KEYS = [("1", "rth"), ("5", "rth"), ("15", "rth"), ("30", "rth"), ("60", "rth"), ("60", "eth")]


@pytest.mark.asyncio
@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5, 6])
@pytest.mark.parametrize("am_mode", ["none", "consistent", "corrective"])
async def test_replay_emitted_bars_equal_offline_bars(seed, am_mode):
    rng = random.Random(seed * 31 + len(am_mode))
    start = et_ms(*DAY, 9, 12)            # crosses 9:30 (60m RTH boundary) and 10:00
    events, arrival_ms = _tape(rng, start, 54, am_mode)
    h = Harness()
    for tf, sess in KEYS:
        h.sub("SYN", tf, sess)
        h.sub("SYN", tf, sess, v2=False)
    emitted = {k: [] for k in KEYS}
    legacy = {k: [] for k in KEYS}
    prev = arrival_ms[0]
    for (kind, payload), at in zip(events, arrival_ms):
        h.advance(max(0, at - prev))
        prev = at
        h.bb.push_aggregate("SYN", dict(payload), kind)
        for k in KEYS:
            emitted[k].extend(await drain(h.queues[("SYN",) + k]))
            legacy[k].extend(await drain(h.queues[("SYN",) + k + ("legacy",)]))
    h.settle()
    for k in KEYS:
        emitted[k].extend(await drain(h.queues[("SYN",) + k]))
        legacy[k].extend(await drain(h.queues[("SYN",) + k + ("legacy",)]))

    for tf, sess in KEYS:
        got = last_per_bucket(emitted[(tf, sess)])
        want = _offline_bars(events, tf, sess)
        assert set(got) == set(want), (tf, sess)
        for t in want:
            assert _ohlcv(got[t]) == want[t], (tf, sess, t)
        # every bucket but the newest is final; the newest is not (no later data)
        newest = max(got)
        assert all(got[t]["final"] for t in got if t != newest), (tf, sess)
        # F1: a legacy (v1) subscriber never sees t go backwards, and still ends
        # on the true newest bar (its close is never a previous bucket's close)
        lt = [m["bar"]["t"] for m in legacy[(tf, sess)]]
        assert lt == sorted(lt), (tf, sess)
        assert _ohlcv(legacy[(tf, sess)][-1]["bar"]) == want[newest], (tf, sess)
        # v2 frames are in t order within every flush, and corrections only ever
        # go to OLDER buckets that are already final
        for a, b in zip(emitted[(tf, sess)], emitted[(tf, sess)][1:]):
            if b["bar"]["t"] < a["bar"]["t"]:
                assert b["bar"]["final"] is True
        # A events never leaked their sentinel prices
        assert all(m["bar"]["h"] != 999.0 and m["bar"]["c"] != 777.0 for m in emitted[(tf, sess)])
    # the quote feed still gets A's cumulative day volume
    if am_mode != "none":
        assert h.bb.get_last_price("SYN")["volume"] == 123


@pytest.mark.asyncio
async def test_D6_AM_for_previous_minute_keeps_current_minute_accumulation():
    h = Harness()
    q = h.sub("X", "5")
    m0 = et_ms(*DAY, 10, 0)
    T = lambda t, p, s=100: h.bb.push_aggregate("X", {"t": t, "p": p, "s": s, "c": [0]}, "T")
    T(m0 + 1000, 10.0)
    T(m0 + 30000, 10.5)
    h.advance(200)
    T(m0 + MIN + 1000, 11.0, 50)      # minute 2 trades: new high 11.0
    h.advance(200)
    T(m0 + MIN + 2000, 10.8, 50)
    h.advance(200)
    # AM for minute 1 arrives AFTER minute-2 trades (normal ~1-2 s lag)
    h.bb.push_aggregate("X", {"t": m0, "o": 10.0, "h": 10.6, "l": 9.9, "c": 10.5, "v": 250}, "AM")
    msgs = await drain(q)
    bar = msgs[-1]["bar"]
    assert bar["c"] == 10.8              # close did NOT snap back to the AM close
    assert bar["h"] == 11.0              # minute-2 high kept
    assert bar["l"] == 9.9               # AM low adopted for minute 1
    assert bar["v"] == 250 + 100         # AM minute-1 volume + minute-2 T volume
    # the developing high never shrank across the whole sequence
    highs = [m["bar"]["h"] for m in msgs]
    assert highs == sorted(highs)


@pytest.mark.asyncio
async def test_D7_late_AM_correction_reemits_closed_bucket_as_final():
    h = Harness()
    q = h.sub("X", "5")
    b0 = et_ms(*DAY, 10, 5)
    T = lambda t, p: h.bb.push_aggregate("X", {"t": t, "p": p, "s": 100, "c": [0]}, "T")
    T(b0 + 4 * MIN + 59_000, 20.0)       # last minute of the 10:05 bucket
    h.advance(500)
    T(b0 + 5 * MIN + 500, 20.2)          # 10:10 bucket opens
    msgs = await drain(q)
    closed = [m["bar"] for m in msgs if m["bar"]["t"] == b0]
    assert closed and closed[-1]["final"] is True
    h.advance(500)
    # the AM for 10:09 lands after 10:10 trades — authoritative, must not be dropped
    h.bb.push_aggregate("X", {"t": b0 + 4 * MIN, "o": 19.9, "h": 20.4, "l": 19.8,
                              "c": 20.1, "v": 900}, "AM")
    msgs = await drain(q)
    corr = [m["bar"] for m in msgs if m["bar"]["t"] == b0]
    assert corr, "the corrected closed bucket must be re-emitted"
    assert corr[-1]["final"] is True
    assert (corr[-1]["h"], corr[-1]["c"], corr[-1]["v"]) == (20.4, 20.1, 900)
    # the developing bucket is untouched by the correction
    assert h.bb.get_partial("X", "5")["t"] == b0 + 5 * MIN


@pytest.mark.asyncio
async def test_D8_mid_bucket_subscriber_gets_true_bucket_to_date_after_seed():
    b0 = et_ms(*DAY, 10, 30)             # 60m RTH bucket 10:30-11:30
    seed = [
        {"t": b0 + i * MIN, "o": 30.0 + i, "h": 30.5 + i, "l": 29.5 + i,
         "c": 30.2 + i, "v": 1000} for i in range(7)
    ]
    h = Harness(seed_fetcher=lambda sym: list(seed))
    q = h.sub("X", "60")
    # live trades only start mid-bucket (the symbol was just subscribed upstream)
    h.bb.push_aggregate("X", {"t": b0 + 7 * MIN + 2000, "p": 37.0, "s": 10, "c": [0]}, "T")
    first = (await drain(q))[-1]["bar"]
    assert first["o"] == 37.0            # before the seed: "since subscribe" only
    h.now = b0 + 7 * MIN + 5000          # seed fetched mid-minute 7 (minutes 0-6 complete)
    assert h.bb.ensure_seeded("X") is True
    bar = (await drain(q))[-1]["bar"]
    assert bar["t"] == b0
    assert bar["o"] == 30.0              # true bucket open
    assert bar["l"] == 29.5 and bar["h"] == 37.0
    assert bar["v"] == 7 * 1000 + 10
    assert bar["c"] == 37.0
    assert h.bb.ensure_seeded("X") is False   # once per upstream subscription


@pytest.mark.asyncio
async def test_new_subscriber_gets_the_current_bucket_immediately():
    h = Harness()
    h.sub("X", "1")
    h.bb.push_aggregate("X", {"t": et_ms(*DAY, 11, 0, 5), "p": 5.0, "s": 1, "c": [0]}, "T")
    q2 = h.sub("X", "5")
    got = await drain(q2)
    assert len(got) == 1 and got[0]["bar"]["c"] == 5.0


@pytest.mark.asyncio
async def test_D9_burst_then_silence_delivers_the_last_state():
    h = Harness()
    q = h.sub("X", "1")
    t0 = et_ms(*DAY, 11, 0, 1)
    for i in range(10):                  # 10 trades inside one 100 ms throttle window
        h.bb.push_aggregate("X", {"t": t0 + i, "p": 7.0 + i / 100, "s": 1, "c": [0]}, "T")
    msgs = await drain(q)
    assert len(msgs) == 1 and msgs[0]["bar"]["c"] == 7.0
    assert len(h.pending) == 1           # exactly one trailing flush armed
    h.settle()                           # ...silence
    msgs = await drain(q)
    assert len(msgs) == 1
    assert msgs[0]["bar"]["c"] == 7.09 and msgs[0]["bar"]["v"] == 10
    assert msgs[0]["bar"]["trade_ts"] == t0 + 9


@pytest.mark.asyncio
async def test_filtered_prints_never_move_close_high_low_but_count_volume():
    h = Harness()
    q = h.sub("X", "1")
    t0 = et_ms(*DAY, 12, 0, 1)
    push = lambda dt, p, s, c: h.bb.push_aggregate("X", {"t": t0 + dt, "p": p, "s": s, "c": c}, "T")
    push(0, 10.0, 100, [0])
    push(1, 15.0, 1, [37])               # odd-lot ghost spike
    push(2, 5.0, 50, [33])               # out-of-sequence ghost
    push(3, 10.1, 100, [12])             # Form T: session code, stays eligible
    h.settle()
    bar = (await drain(q))[-1]["bar"]
    assert (bar["o"], bar["h"], bar["l"], bar["c"], bar["v"]) == (10.0, 10.1, 10.0, 10.1, 251)


@pytest.mark.asyncio
async def test_odd_lot_only_never_seeds_a_bar():
    h = Harness()
    q = h.sub("X", "5")
    h.bb.push_aggregate("X", {"t": et_ms(*DAY, 12, 0, 1), "p": 99.0, "s": 1, "c": [37]}, "T")
    h.settle()
    assert await drain(q) == []
    assert h.bb.get_partial("X", "5") is None


@pytest.mark.asyncio
async def test_trade_buckets_by_trade_timestamp_not_arrival():
    h = Harness()
    q = h.sub("X", "5")
    b = et_ms(*DAY, 13, 0)
    h.bb.push_aggregate("X", {"t": b + 1000, "p": 1.0, "s": 1, "c": [0]}, "T")
    h.bb.push_aggregate("X", {"t": b - 5, "p": 2.0, "s": 1, "c": [0]}, "T")   # late print from 12:55
    h.settle()
    got = last_per_bucket(await drain(q))
    assert got[b - 5 * MIN]["c"] == 2.0 and got[b - 5 * MIN]["final"] is True
    assert got[b]["o"] == 1.0 and got[b]["v"] == 1


@pytest.mark.asyncio
async def test_60m_message_carries_session_and_tv_bucket():
    h = Harness()
    qr = h.sub("X", "60", "rth")
    qe = h.sub("X", "60", "eth")
    h.bb.push_aggregate("X", {"t": et_ms(*DAY, 10, 45), "p": 3.0, "s": 1, "c": [0]}, "T")
    r = (await drain(qr))[-1]
    e = (await drain(qe))[-1]
    assert (r["tf"], r["session"], r["bar"]["t"]) == ("60", "rth", et_ms(*DAY, 10, 30))
    assert (e["tf"], e["session"], e["bar"]["t"]) == ("60", "eth", et_ms(*DAY, 10, 0))


# ── The single TradingView bucket helper ──────────────────────────────────────

@pytest.mark.parametrize("y,mo,d", [(2026, 11, 10), (2026, 7, 15), (2026, 3, 9), (2026, 11, 2)])
def test_tv_60m_rth_buckets(y, mo, d):
    exp = [(9, 30, 10, 30), (10, 30, 11, 30), (11, 30, 12, 30), (12, 30, 13, 30),
           (13, 30, 14, 30), (14, 30, 15, 30), (15, 30, 16, 0)]
    for sh, sm, eh, em in exp:
        s, e = et_ms(y, mo, d, sh, sm), et_ms(y, mo, d, eh, em)
        for probe in (s, s + 59 * MIN // 2, e - 1):
            assert tv_bucket_bounds(probe, "60", "rth") == (s, e)
    # pre-market stub stops at the open; post-market is clock hours
    assert tv_bucket_bounds(et_ms(y, mo, d, 9, 10), "60", "rth") == (et_ms(y, mo, d, 9, 0), et_ms(y, mo, d, 9, 30))
    assert tv_bucket_bounds(et_ms(y, mo, d, 16, 10), "60", "rth") == (et_ms(y, mo, d, 16, 0), et_ms(y, mo, d, 17, 0))


@pytest.mark.parametrize("y,mo,d", [(2026, 11, 10), (2026, 7, 15)])
def test_tv_60m_eth_buckets_are_clock_hours(y, mo, d):
    for hr in range(4, 20):
        s = et_ms(y, mo, d, hr, 0)
        assert tv_bucket_bounds(s + 37 * MIN, "60", "eth") == (s, s + 60 * MIN)
    # 09:00 spans the open
    assert tv_bucket_start(et_ms(y, mo, d, 9, 45), "60", "eth") == et_ms(y, mo, d, 9, 0)


def test_tv_sub_hour_buckets_are_floors_and_session_independent():
    t = et_ms(*DAY, 9, 47, 13)
    for tf, step in (("1", 1), ("5", 5), ("15", 15), ("30", 30)):
        s, e = tv_bucket_bounds(t, tf, "rth")
        assert (s, e) == tv_bucket_bounds(t, tf, "eth")
        assert e - s == step * MIN and s <= t < e and s % (step * MIN) == 0


def test_tv_helper_rejects_unknown_tf_or_session():
    with pytest.raises(ValueError):
        tv_bucket_bounds(0, "2", "rth")
    with pytest.raises(ValueError):
        tv_bucket_bounds(0, "60", "overnight")


def test_get_last_price_reports_the_trade_time_of_the_close():
    """The quote feed stamps `updated_at` from this (trade time), not send time."""
    h = Harness()
    h.bb.add_interest(["X"])
    t = et_ms(*DAY, 9, 59, 59, 900)
    h.bb.push_aggregate("X", {"t": t, "p": 4.0, "s": 1, "c": [0]}, "T")
    h.bb.push_aggregate("X", {"t": t + 50, "p": 9.0, "s": 1, "c": [37]}, "T")   # ghost: no last
    lp = h.bb.get_last_price("X")
    assert lp["price"] == 4.0 and lp["trade_ts"] == t
    assert lp["ts"] == et_ms(*DAY, 9, 59)


@pytest.mark.asyncio
async def test_failed_seed_is_not_refetched_on_every_subscribe():
    calls = []
    h = Harness(seed_fetcher=lambda sym: calls.append(sym) or [])
    h.sub("X", "5")
    assert h.bb.ensure_seeded("X") is False
    assert h.bb.ensure_seeded("X") is False
    assert calls == ["X"]
    h.advance(61_000)
    h.bb.ensure_seeded("X")
    assert calls == ["X", "X"]


# ── Review fixes F1-F5 ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_F1_late_AM_correction_reaches_v2_only_never_legacy():
    h = Harness()
    legacy = h.sub("X", "1", v2=False)
    v2 = h.sub("X", "1")
    m = et_ms(*DAY, 10, 0)
    T = lambda t, p: h.bb.push_aggregate("X", {"t": t, "p": p, "s": 100, "c": [0]}, "T")
    T(m + 1000, 10.0)
    h.advance(200)
    T(m + 50_000, 10.5)
    h.advance(200)
    T(m + MIN + 500, 11.0)               # the next minute opens
    h.advance(1500)
    h.bb.push_aggregate("X", {"t": m, "o": 10.0, "h": 10.6, "l": 10.0, "c": 10.4, "v": 250}, "AM")
    lg = await drain(legacy)
    vv = await drain(v2)
    assert [x["bar"]["t"] for x in lg] == sorted(x["bar"]["t"] for x in lg)
    assert lg[-1]["bar"]["t"] == m + MIN and lg[-1]["bar"]["c"] == 11.0   # never snaps back
    assert vv[-1]["bar"]["t"] == m and vv[-1]["bar"]["final"] is True
    assert vv[-1]["bar"]["c"] == 10.4


@pytest.mark.asyncio
async def test_F2_seed_emits_only_the_current_bucket_per_key():
    b0 = et_ms(*DAY, 12, 0)
    seed = [{"t": b0 - i * MIN, "o": 1.0, "h": 1.1, "l": 0.9, "c": 1.0, "v": 10} for i in range(170)]
    h = Harness(seed_fetcher=lambda sym: list(seed))
    q1, q5 = h.sub("X", "1"), h.sub("X", "5")
    h.now = b0 + 30_000
    assert h.bb.ensure_seeded("X") is True
    o1, o5 = await drain(q1), await drain(q5)
    assert [m["bar"]["t"] for m in o1] == [b0]
    assert [m["bar"]["t"] for m in o5] == [b0]


def test_F3_seed_kicks_are_bounded_and_use_a_dedicated_pool(monkeypatch):
    import threading
    from api.routers import stream
    gate = threading.Event()
    started = []
    monkeypatch.setattr(stream, "_SEED_MAX_INFLIGHT", 3)
    monkeypatch.setattr(stream, "_seed_inflight", 0)
    fn = lambda sym: (started.append(threading.current_thread().name), gate.wait(5))
    results = [stream._kick_seed(fn, f"S{i}") for i in range(6)]
    assert results == [True, True, True, False, False, False]
    gate.set()
    deadline = __import__("time").time() + 5
    while stream._seed_inflight and __import__("time").time() < deadline:
        __import__("time").sleep(0.01)
    assert stream._seed_inflight == 0
    assert all(n.startswith("bars-seed") for n in started)


def test_F4_half_day_rth_buckets_end_at_1300():
    y, mo, d = 2026, 11, 27              # day after Thanksgiving: NYSE 13:00 close
    assert tv_bucket_bounds(et_ms(y, mo, d, 12, 45), "60", "rth") == (et_ms(y, mo, d, 12, 30), et_ms(y, mo, d, 13, 0))
    assert tv_bucket_bounds(et_ms(y, mo, d, 11, 0), "60", "rth") == (et_ms(y, mo, d, 10, 30), et_ms(y, mo, d, 11, 30))
    # a post-close print never lands in an RTH bucket
    assert tv_bucket_bounds(et_ms(y, mo, d, 13, 10), "60", "rth") == (et_ms(y, mo, d, 13, 0), et_ms(y, mo, d, 14, 0))
    # a normal day is unchanged
    assert tv_bucket_bounds(et_ms(*DAY, 15, 45), "60", "rth")[1] == et_ms(*DAY, 16, 0)


def test_F5_a_symbol_is_reseeded_for_the_next_session():
    calls = []
    h = Harness(seed_fetcher=lambda sym: calls.append(sym) or
                [{"t": h.now // MIN * MIN - MIN, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    h.bb.add_interest(["X"])
    h.now = et_ms(*DAY, 10, 5)
    assert h.bb.ensure_seeded("X") is True
    assert h.bb.ensure_seeded("X") is False
    h.now = et_ms(2026, 11, 11, 9, 35)
    assert h.bb.ensure_seeded("X") is True
    assert calls == ["X", "X"]
