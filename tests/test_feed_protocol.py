"""Property tests for api/services/feed_protocol.py (INGEST-PROCESS-DESIGN PR3).

`hypothesis` is not in requirements.txt, so every property runs as a SEEDED random
loop: each test iterates fixed seeds, so a failure reproduces exactly and the
failing seed is in the assertion message.
"""
from __future__ import annotations

import ast
import math
import pathlib
import random

import orjson
import pytest

from api.services import feed_protocol as fp

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE = ROOT / "api" / "services" / "feed_protocol.py"
SEEDS = range(40)

SYMS = ["AAPL", "NVDA", "BRK.B", "SPY", "X"]
KEYS = sorted(fp.BAR_KEYS)


# ── generators ──────────────────────────────────────────────────────────────────

def _num(r):
    return r.choice([r.randint(-5, 10**6), round(r.uniform(-1e6, 1e6), 4), 0, 0.5])


def _pos(r):
    return r.choice([r.randint(0, 10**9), round(r.uniform(0, 1e7), 3)])


def _bar(r, t=None):
    b = {"t": t if t is not None else r.randint(0, 10**13), "o": _num(r), "h": _num(r),
         "l": _num(r), "c": _num(r), "v": _pos(r)}
    if r.random() < 0.6:
        b["trade_ts"] = r.randint(0, 10**13)
    return b


def _chans(r, allow_empty=False):
    s = frozenset(c for c in fp.CHANNELS if r.random() < 0.5)
    if not s and not allow_empty:
        s = frozenset({r.choice(fp.CHANNELS)})
    return s


def _owners(r, allow_empty=False):
    return {o: {s: _chans(r, allow_empty) for s in r.sample(SYMS, r.randint(0, 3))}
            for o in r.sample(["bars", "nhnl", "volume", "tas", "d3"], r.randint(0, 3))}


def _opaque(r, depth=0):
    kind = r.randint(0, 5 if depth < 3 else 3)
    if kind == 0:
        return None
    if kind == 1:
        return r.choice([True, False, "x", "é漢"])
    if kind == 2:
        return r.randint(-10**12, 10**12)
    if kind == 3:
        return round(r.uniform(-1e3, 1e3), 3)
    if kind == 4:
        return [_opaque(r, depth + 1) for _ in range(r.randint(0, 3))]
    return {f"k{i}": _opaque(r, depth + 1) for i in range(r.randint(0, 3))}


def _random_message(r):
    kind = r.choice(["hello", "desired", "patch", "batch"])
    if kind == "hello":
        return fp.Hello(f"web-{r.randint(0, 9)}", r.randint(0, 1000))
    if kind == "desired":
        return fp.Desired(
            gen=r.randint(0, 1000), owners=_owners(r),
            keys=frozenset((r.choice(SYMS), r.choice(KEYS)) for _ in range(r.randint(0, 5))),
            nhnl_seeds={s: _opaque(r) for s in r.sample(SYMS, r.randint(0, 3))},
            tas_syms=frozenset(r.sample(SYMS, r.randint(0, 3))))
    if kind == "patch":
        pairs = list({(r.choice(SYMS), r.choice(KEYS)) for _ in range(6)})
        cut = r.randint(0, len(pairs))
        tas = r.sample(SYMS, 4)
        return fp.Patch(
            gen=r.randint(0, 1000), seq=r.randint(1, 1000), owners=_owners(r, allow_empty=True),
            keys_add=frozenset(pairs[:cut]), keys_remove=frozenset(pairs[cut:]),
            tas_add=frozenset(tas[:2]), tas_remove=frozenset(tas[2:]),
            nhnl_seeds={s: (None if r.random() < 0.3 else _opaque(r)) for s in r.sample(SYMS, 2)})
    bars, seen = [], set()
    for _ in range(r.randint(0, 8)):
        b = _bar(r)
        ident = (r.choice(SYMS), r.choice(KEYS), b["t"])
        if ident in seen:
            continue
        seen.add(ident)
        bars.append(fp.BarUpdate(ident[0], ident[1], b, r.random() < 0.5))
    tas = {}
    for s in r.sample(SYMS, r.randint(0, 2)):
        items = []
        if r.random() < 0.5:
            a = r.randint(0, 10**12)
            items.append(fp.TasGap(r.randint(1, 50), a, a + r.randint(0, 10**4)))
        for _ in range(r.randint(0, 4)):
            conds = None if r.random() < 0.5 else tuple(r.randint(0, 60) for _ in range(r.randint(0, 3)))
            items.append((r.randint(0, 10**13), _num(r), _pos(r), conds))
        tas[s] = tuple(items)
    return fp.Batch(
        epoch=r.randint(0, 2**40), seq=r.randint(1, 10**6), bars=tuple(bars),
        prices={s: {"price": _num(r), "ts": r.randint(0, 10**13),
                    "trade_ts": r.choice([None, r.randint(0, 10**13)]),
                    "volume": r.choice([None, _pos(r)])} for s in r.sample(SYMS, r.randint(0, 3))},
        agg={s: (r.choice([None, _pos(r)]), r.choice([None, _num(r)]), r.choice([None, _pos(r)]))
             for s in r.sample(SYMS, r.randint(0, 3))},
        nhnl={f"c{i}": _opaque(r) for i in range(r.randint(0, 3))},
        nhnl_rt={f"r{i}": _opaque(r) for i in range(r.randint(0, 2))},
        tas=tas, status=r.choice([None, {"lag_ms": r.randint(0, 999), "ok": True}]))


# ── 1. encode / decode ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", SEEDS)
def test_roundtrip_every_kind(seed):
    r = random.Random(seed)
    for _ in range(50):
        m = _random_message(r)
        data = fp.encode(m)
        assert isinstance(data, bytes)
        assert fp.decode(data) == m, f"seed={seed} {m!r}"
        assert fp.decode(data.decode()) == m
        assert fp.encode(fp.decode(data)) == data   # canonical encoding


def _wire(m):
    return orjson.loads(fp.encode(m))


@pytest.mark.parametrize("mutate, err", [
    (lambda o: o.update(v=2), fp.UnknownVersion),
    (lambda o: o.update(v=0), fp.UnknownVersion),
    (lambda o: o.pop("v"), fp.MalformedMessage),
    (lambda o: o.update(v=True), fp.MalformedMessage),
    (lambda o: o.update(v="1"), fp.MalformedMessage),
    (lambda o: o.update(k="nope"), fp.UnknownKind),
    (lambda o: o.update(k=None), fp.UnknownKind),
    (lambda o: o.update(extra=1), fp.MalformedMessage),
    (lambda o: o.update(seq=0), fp.MalformedMessage),
    (lambda o: o.update(epoch=-1), fp.MalformedMessage),
    (lambda o: o.update(epoch=1.5), fp.MalformedMessage),
    (lambda o: o.update(bars=[["AAPL", "2", {"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}, True]]), fp.MalformedMessage),
    (lambda o: o.update(bars=[["aapl", "1", {"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}, True]]), fp.MalformedMessage),
    (lambda o: o.update(bars=[["AAPL", "1", {"t": 1, "o": 1, "h": 1, "l": 1, "c": 1}, True]]), fp.MalformedMessage),
    (lambda o: o.update(bars=[["AAPL", "1", {"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1, "zz": 1}, True]]), fp.MalformedMessage),
    (lambda o: o.update(bars=[["AAPL", "1", {"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1, "final": False}, True]]), fp.MalformedMessage),
    (lambda o: o.update(bars=[["AAPL", "1", {"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}, 1]]), fp.MalformedMessage),
    (lambda o: o.update(bars=[["AAPL", "1", {"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}, True]] * 2), fp.MalformedMessage),
    (lambda o: o.update(bars=[["AAPL", ["1"], {}, True]]), fp.MalformedMessage),
    (lambda o: o.update(prices={"AAPL": {"price": "1", "ts": 1}}), fp.MalformedMessage),
    (lambda o: o.update(prices={"AAPL": {"price": 1}}), fp.MalformedMessage),
    (lambda o: o.update(agg={"AAPL": [1, 2]}), fp.MalformedMessage),
    (lambda o: o.update(agg={"AAPL": [-1, 2, 3]}), fp.MalformedMessage),
    (lambda o: o.update(tas={"AAPL": [{"gap": 0, "from": 1, "to": 2}]}), fp.MalformedMessage),
    (lambda o: o.update(tas={"AAPL": [{"gap": 1, "from": 3, "to": 2}]}), fp.MalformedMessage),
    (lambda o: o.update(tas={"AAPL": [[1, 2, 3]]}), fp.MalformedMessage),
    (lambda o: o.update(nhnl=[1]), fp.MalformedMessage),
    (lambda o: o.update(status="x"), fp.MalformedMessage),
])
def test_decode_rejects_malformed_batches(mutate, err):
    o = _wire(fp.Batch(epoch=1, seq=1))
    mutate(o)
    with pytest.raises(err):
        fp.decode(orjson.dumps(o))


@pytest.mark.parametrize("obj", [
    {"v": 1, "k": "hello", "client_id": "", "gen": 0},
    {"v": 1, "k": "hello", "client_id": "a", "gen": -1},
    {"v": 1, "k": "hello", "client_id": "a"},
    {"v": 1, "k": "desired", "gen": 0, "owners": {"bars": {"AAPL": []}}, "keys": [], "nhnl_seeds": {}, "tas_syms": []},
    {"v": 1, "k": "desired", "gen": 0, "owners": {"bars": {"AAPL": ["Q"]}}, "keys": [], "nhnl_seeds": {}, "tas_syms": []},
    {"v": 1, "k": "desired", "gen": 0, "owners": {"bars": {"AAPL": ["T", "T"]}}, "keys": [], "nhnl_seeds": {}, "tas_syms": []},
    {"v": 1, "k": "desired", "gen": 0, "owners": {}, "keys": [["AAPL"]], "nhnl_seeds": {}, "tas_syms": []},
    {"v": 1, "k": "desired", "gen": 0, "owners": {}, "keys": [], "nhnl_seeds": {}},
    {"v": 1, "k": "patch", "gen": 0, "seq": 0},
    {"v": 1, "k": "patch", "gen": 0, "seq": 1, "keys_add": [["A", "1"]], "keys_remove": [["A", "1"]]},
    {"v": 1, "k": "patch", "gen": 0, "seq": 1, "tas_add": ["A"], "tas_remove": ["A"]},
    [1, 2, 3], "x", 1, None,
])
def test_decode_rejects_malformed_control(obj):
    with pytest.raises(fp.ProtocolError):
        fp.decode(orjson.dumps(obj))


def test_decode_rejects_non_json_and_oversize():
    for data in (b"", b"{", b"NaN", b'{"v":1,"k":"batch","epoch":1,"seq":1,"prices":{"A":{"price":NaN,"ts":1}}}',
                 b"\xff\xfe", "\ud800"):
        with pytest.raises(fp.MalformedMessage):
            fp.decode(data)
    with pytest.raises(fp.MalformedMessage):
        fp.decode(12345)
    big = fp.encode(fp.Batch(epoch=1, seq=1, status={"pad": "x" * 2000}))
    with pytest.raises(fp.MessageTooLarge):
        fp.decode(big, max_bytes=1000)


def test_sym_rule_is_the_repo_ticker_rule():
    """feed_protocol restates (to stay pure) the ticker rule of the T&S router,
    which rides the same Massive socket; pin the two together."""
    from api.routers import time_and_sales as tas_router
    assert fp.SYM_PATTERN == tas_router._SYM_RE.pattern
    for ok in ("AAPL", "BRK.B", "X", "BF-B", "A1", "ABCDEFGHIJ"):
        m = fp.Desired(gen=0, tas_syms=frozenset({ok}))
        assert fp.decode(fp.encode(m)) == m
    for bad in ("aapl", "", "1AB", "ABCDEFGHIJK", "AA PL", "AAPL\n", "$AAPL", "I:SPX", "É"):
        o = _wire(fp.Desired(gen=0))
        o["tas_syms"] = [bad]
        with pytest.raises(fp.MalformedMessage):
            fp.decode(orjson.dumps(o))


@pytest.mark.parametrize("val", [2 ** 63, -(2 ** 63) - 1, 2 ** 64 - 1, 10 ** 30])
def test_ints_outside_int64_rejected_by_decode_and_encode(val):
    # orjson parses 2**63..2**64-1 as int (rejected by the int64 rule); literals
    # beyond u64 / below i64 come back as float (rejected where an int is due).
    for raw in (b'{"v":1,"k":"batch","epoch":%d,"seq":1}' % val,
                b'{"v":1,"k":"batch","epoch":1,"seq":1,"bars":[["A","1",'
                b'{"t":%d,"o":1,"h":1,"l":1,"c":1,"v":1},true]]}' % val):
        with pytest.raises(fp.MalformedMessage):
            fp.decode(raw)
    if val in (2 ** 63, 2 ** 64 - 1):
        with pytest.raises(fp.MalformedMessage):
            fp.decode(b'{"v":1,"k":"batch","epoch":1,"seq":1,"nhnl":{"n":%d}}' % val)
    with pytest.raises(fp.MalformedMessage):
        fp.encode(fp.Batch(epoch=1, seq=1, nhnl={"n": val}))
    with pytest.raises(fp.MalformedMessage):
        fp.encode(fp.Batch(epoch=val, seq=1))
    # the int64 edges themselves are fine both ways
    for edge in (fp.INT64_MAX, fp.INT64_MIN):
        b = fp.Batch(epoch=1, seq=1, nhnl={"n": edge})
        assert fp.decode(fp.encode(b)) == b


def test_opaque_bounds_are_enforced():
    deep = {}
    cur = deep
    for _ in range(fp.MAX_OPAQUE_DEPTH + 2):
        cur["a"] = {}
        cur = cur["a"]
    with pytest.raises(fp.MalformedMessage):
        fp.decode(fp.encode(fp.Batch(epoch=1, seq=1), validate=False)[:-1] + b',"x":1}')
    o = _wire(fp.Batch(epoch=1, seq=1))
    o["nhnl"] = deep
    with pytest.raises(fp.MalformedMessage):
        fp.decode(orjson.dumps(o))


def test_encode_refuses_what_decode_would_reject():
    with pytest.raises(fp.MalformedMessage):
        fp.encode(fp.Batch(epoch=1, seq=1, prices={"A": {"price": math.nan, "ts": 1,
                                                          "trade_ts": None, "volume": None}}))
    with pytest.raises(fp.MalformedMessage):
        fp.encode(fp.Batch(epoch=1, seq=0))
    with pytest.raises(fp.MalformedMessage):
        fp.encode(object())


@pytest.mark.parametrize("seed", SEEDS)
def test_fuzzed_input_only_ever_raises_protocol_error(seed):
    """Byte flips / truncations / splices of valid messages: decode returns a
    message or raises ProtocolError -- never anything else."""
    r = random.Random(seed)
    for _ in range(150):
        data = bytearray(fp.encode(_random_message(r)))
        op = r.randint(0, 3)
        if op == 0 and data:
            for _ in range(r.randint(1, 4)):
                data[r.randrange(len(data))] = r.randrange(256)
        elif op == 1:
            data = data[: r.randrange(len(data) + 1)]
        elif op == 2:
            i = r.randrange(len(data) + 1)
            data[i:i] = r.choice([b"null", b"[]", b"{}", b"-1", b"1e999", b'"', b",", b"true"])
        else:
            o = orjson.loads(bytes(data))
            k = r.choice(list(o))
            o[k] = r.choice([None, [], {}, -1, 1.5, "x", True, [[None]], {"A": None}])
            data = bytearray(orjson.dumps(o))
        try:
            m = fp.decode(bytes(data))
        except fp.ProtocolError:
            continue
        assert isinstance(m, (fp.Hello, fp.Desired, fp.Patch, fp.Batch))


# ── 2. coalescing buffer ────────────────────────────────────────────────────────

def _drain_all(buf, out):
    b = buf.drain()
    if b is not None:
        # per (sym, key): ascending t and no duplicate identities in one batch
        last = {}
        for u in b.bars:
            k = (u.sym, u.key)
            assert u.bar["t"] > last.get(k, -1)
            last[k] = u.bar["t"]
        assert fp.decode(fp.encode(b)) == b
        out.append(b)


@pytest.mark.parametrize("seed", SEEDS)
def test_coalescing_finals_never_lost_and_final_wins(seed):
    r = random.Random(seed)
    buf = fp.CoalescingBuffer(epoch=7)
    accepted_last = {}      # ident -> last ACCEPTED (bar, final)
    offered_final = set()
    batches = []
    for step in range(600):
        sym, key = r.choice(SYMS[:3]), r.choice(KEYS[:3])
        t = r.randint(0, 12) * 60_000
        final = r.random() < 0.3
        bar = _bar(r, t)
        res = buf.offer_bar(sym, key, bar, final)
        ident = (sym, key, t)
        if res is fp.Offer.ACCEPTED:
            accepted_last[ident] = (bar, final)
            if final:
                offered_final.add(ident)
        else:
            assert res is fp.Offer.SUPERSEDED and not final
            wm = buf.final_watermark(sym, key)
            assert wm is not None and t <= wm, f"seed={seed}: superseded without a final at/after t"
        assert buf.pending_size() <= buf.max_size()
        if r.random() < 0.15:
            _drain_all(buf, batches)
    _drain_all(buf, batches)
    assert not buf.stalled
    assert [b.seq for b in batches] == list(range(1, len(batches) + 1))

    emitted = {}            # ident -> list of (bar, final) in emission order
    for b in batches:
        assert b.epoch == 7
        for u in b.bars:
            emitted.setdefault((u.sym, u.key, u.bar["t"]), []).append((u.bar, u.final))
    for ident, (bar, final) in accepted_last.items():
        assert ident in emitted, f"seed={seed}: accepted {ident} never emitted"
        exp = {k: bar[k] for k in ("t", "o", "h", "l", "c", "v", "trade_ts") if k in bar}
        assert emitted[ident][-1] == (exp, final), f"seed={seed}: last emit of {ident} is not the last accepted"
    for ident in offered_final:
        seq = emitted[ident]
        first_final = next(i for i, (_, f) in enumerate(seq) if f)
        assert all(f for _, f in seq[first_final:]), f"seed={seed}: non-final after final for {ident}"
        assert seq[-1][1] is True


def test_non_final_after_final_same_t_final_wins_within_and_across_drains():
    buf = fp.CoalescingBuffer(epoch=1)
    fin = {"t": 60_000, "o": 1, "h": 2, "l": 1, "c": 2, "v": 10}
    late = {"t": 60_000, "o": 1, "h": 9, "l": 1, "c": 9, "v": 11}
    assert buf.offer_bar("A", "1", fin, True) is fp.Offer.ACCEPTED
    assert buf.offer_bar("A", "1", late, False) is fp.Offer.SUPERSEDED
    b1 = buf.drain()
    assert [(u.bar["c"], u.final) for u in b1.bars] == [(2, True)]
    # after the final was drained, a straggling non-final is still refused
    assert buf.offer_bar("A", "1", late, False) is fp.Offer.SUPERSEDED
    # ...and for an OLDER t too (an older bucket is final once a newer one is)
    assert buf.offer_bar("A", "1", {**late, "t": 0}, False) is fp.Offer.SUPERSEDED
    assert buf.drain() is None
    # a later FINAL for the same t is a correction and replaces it
    corr = {**fin, "c": 3, "h": 3}
    assert buf.offer_bar("A", "1", corr, True) is fp.Offer.ACCEPTED
    assert [(u.bar["c"], u.final) for u in buf.drain().bars] == [(3, True)]
    assert buf.counters["superseded"] == 3
    # other keys / symbols are unaffected by A/1's watermark
    assert buf.offer_bar("A", "5", late, False) is fp.Offer.ACCEPTED
    assert buf.offer_bar("B", "1", late, False) is fp.Offer.ACCEPTED


def test_older_t_final_is_not_overwritten_by_newer_t():
    buf = fp.CoalescingBuffer(epoch=1)
    buf.offer_bar("A", "5", {"t": 300_000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}, False)
    buf.offer_bar("A", "5", {"t": 0, "o": 2, "h": 2, "l": 2, "c": 2, "v": 2}, True)   # late AM correction
    buf.offer_bar("A", "5", {"t": 300_000, "o": 1, "h": 4, "l": 1, "c": 4, "v": 3}, False)
    b = buf.drain()
    assert [(u.bar["t"], u.bar["c"], u.final) for u in b.bars] == [(0, 2, True), (300_000, 4, False)]


def test_prices_agg_nhnl_status_latest_wins():
    buf = fp.CoalescingBuffer(epoch=3)
    buf.offer_price("A", 1.0, 0, None, None)
    buf.offer_price("A", 2.0, 60_000, 61_000, 500)
    buf.offer_agg("A", 100, 1.5, 10)
    buf.offer_agg("A", 200, None, None)
    buf.offer_nhnl({"nh": 1, "nl": 2})
    buf.offer_nhnl({"nh": 3})
    buf.offer_nhnl_rt({"x": [1]})
    buf.set_status({"a": 1})
    buf.set_status({"a": 2})
    b = buf.drain()
    assert b.prices == {"A": {"price": 2.0, "ts": 60_000, "trade_ts": 61_000, "volume": 500}}
    assert b.agg == {"A": (200, None, None)}
    assert b.nhnl == {"nh": 3, "nl": 2}
    assert b.nhnl_rt == {"x": [1]}
    assert b.status == {"a": 2}
    assert (b.epoch, b.seq) == (3, 1)
    assert buf.drain() is None
    hb = buf.drain(allow_empty=True)
    assert hb.is_empty() and hb.seq == 2


def test_invalid_offers_raise_and_buffer_nothing():
    buf = fp.CoalescingBuffer(epoch=1)
    with pytest.raises(fp.MalformedMessage):
        buf.offer_bar("A", "1", {"t": 1, "o": math.inf, "h": 1, "l": 1, "c": 1, "v": 1}, False)
    with pytest.raises(fp.MalformedMessage):
        buf.offer_price("A", math.nan, 1)
    assert buf.pending_size() == 0 and buf.drain() is None
    with pytest.raises(ValueError):
        fp.CoalescingBuffer(epoch=-1)


def test_tas_append_bounded_with_gap_marker():
    lim = fp.BufferLimits(max_tas_per_sym=5, max_tas_syms=2)
    buf = fp.CoalescingBuffer(epoch=1, limits=lim)
    for t in range(1, 13):
        assert buf.offer_tas("A", t, 10.0, 100, [12, 37]) is fp.Offer.ACCEPTED
        assert len(buf._tas["A"]) <= 5
    assert buf.offer_tas("B", 1, 1.0, 1) is fp.Offer.ACCEPTED
    assert buf.offer_tas("C", 1, 1.0, 1) is fp.Offer.REJECTED     # over the T&S symbol cap
    b = buf.drain()
    a = b.tas["A"]
    assert a[0] == fp.TasGap(dropped=7, first_t=1, last_t=7)
    assert [p[0] for p in a[1:]] == [8, 9, 10, 11, 12]
    assert a[1][3] == (12, 37)
    assert b.tas["B"] == ((1, 1.0, 1, None),)
    assert buf.counters["tas_dropped"] == 7
    assert fp.decode(fp.encode(b)) == b
    # the gap is per drain window: the next window starts clean
    buf.offer_tas("A", 20, 1.0, 1)
    assert buf.drain().tas["A"] == ((20, 1.0, 1, None),)


@pytest.mark.parametrize("seed", SEEDS)
def test_memory_bounded_and_overflow_stalls_explicitly(seed):
    r = random.Random(seed)
    lim = fp.BufferLimits(max_pending_bars=30, max_price_syms=6, max_agg_syms=6, max_tas_syms=3,
                          max_tas_per_sym=7, max_nhnl_keys=5, max_final_guards=4)
    buf = fp.CoalescingBuffer(epoch=1, limits=lim)
    syms = [f"S{i}" for i in range(12)]
    stalled_at = None
    for i in range(2000):
        op = r.randint(0, 5)
        s = r.choice(syms[: r.randint(1, 12)])
        if op == 0:
            res = buf.offer_bar(s, r.choice(KEYS), _bar(r, r.randint(0, 40) * 60_000), r.random() < 0.4)
        elif op == 1:
            res = buf.offer_price(s, 1.0, i)
        elif op == 2:
            res = buf.offer_agg(s, i)
        elif op == 3:
            res = buf.offer_tas(s, i, 1.0, 1)
        elif op == 4:
            res = buf.offer_nhnl({f"k{r.randint(0, 6)}": i})
        else:
            res = fp.Offer.ACCEPTED
            if r.random() < 0.3:
                buf.drain()
        assert buf.pending_size() <= buf.max_size()
        assert len(buf._final_hi) <= lim.max_final_guards
        assert len(buf._tas) <= lim.max_tas_syms
        if res is fp.Offer.STALLED and stalled_at is None:
            stalled_at = i
        if stalled_at is not None:
            assert buf.stalled and buf.pending_size() == 0 and buf.drain() is None
            assert res is fp.Offer.STALLED or op == 5
    if stalled_at is not None:
        assert buf.stall_reason


def test_forget_is_required_after_a_clear_symbol_style_reset():
    """Final-wins is sound only while finality is monotonic. A producer-side
    `_clear_symbol` (minute map + hwm dropped) restarts finality, so the wiring
    must call forget(sym); without it the new session's non-finals are refused."""
    buf = fp.CoalescingBuffer(epoch=1)
    bar = {"t": 600_000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}
    buf.offer_bar("A", "1", bar, True)
    buf.offer_bar("A", "5", bar, True)
    buf.drain()
    # symbol cleared upstream and re-subscribed: the same bucket is developing again
    assert buf.offer_bar("A", "1", {**bar, "t": 540_000}, False) is fp.Offer.SUPERSEDED   # what forgetting prevents
    buf.forget("A")
    assert buf.final_watermark("A", "1") is None and buf.final_watermark("A", "5") is None
    assert buf.offer_bar("A", "1", {**bar, "t": 540_000}, False) is fp.Offer.ACCEPTED
    assert buf.offer_bar("A", "5", bar, False) is fp.Offer.ACCEPTED


def test_final_guard_eviction_lets_a_stale_non_final_through_and_is_counted():
    assert fp.BufferLimits().max_final_guards >= 3000 * 6 * 1.5
    buf = fp.CoalescingBuffer(epoch=1, limits=fp.BufferLimits(max_final_guards=2))
    bar = {"t": 60_000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}
    for s in ("A", "B", "C"):
        buf.offer_bar(s, "1", bar, True)
    assert buf.counters["guards_evicted"] == 1
    assert buf.final_watermark("A", "1") is None                 # oldest guard evicted
    assert buf.offer_bar("A", "1", bar, False) is fp.Offer.ACCEPTED   # the documented cost
    assert buf.offer_bar("C", "1", bar, False) is fp.Offer.SUPERSEDED


def test_overflow_of_pending_bars_stalls_never_drops_silently():
    buf = fp.CoalescingBuffer(epoch=1, limits=fp.BufferLimits(max_pending_bars=3))
    for t in range(3):
        assert buf.offer_bar("A", "1", {"t": t, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}, True) is fp.Offer.ACCEPTED
    # replacing an existing identity does not grow the buffer
    assert buf.offer_bar("A", "1", {"t": 2, "o": 1, "h": 1, "l": 1, "c": 1, "v": 2}, True) is fp.Offer.ACCEPTED
    assert buf.offer_bar("A", "1", {"t": 9, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}, True) is fp.Offer.STALLED
    assert buf.stalled and buf.drain() is None
    assert buf.offer_price("A", 1.0, 1) is fp.Offer.STALLED
    assert buf.counters["stalls_total"] == 1                 # counted once, not per refused offer
    assert "SNAPSHOT CONTRACT" in fp.CoalescingBuffer.__doc__  # PR4 must resend closed-bucket finals


# ── 3. desired-state union + lease ──────────────────────────────────────────────

def _ref_union(model):
    acc = {}
    for owners in model.values():
        for syms in owners.values():
            for s, ch in syms.items():
                if ch:
                    acc.setdefault(s, set()).update(ch)
    return {s: frozenset(c) for s, c in acc.items()}


def _apply_delta(state, d):
    for s, ch in d.unsubscribe.items():
        assert ch <= state.get(s, frozenset()), "unsubscribing a channel that was not subscribed"
        state[s] = state.get(s, frozenset()) - ch
        if not state[s]:
            del state[s]
    for s, ch in d.subscribe.items():
        assert not (ch & state.get(s, frozenset())), "subscribing a channel twice"
        state[s] = state.get(s, frozenset()) | ch


@pytest.mark.parametrize("seed", SEEDS)
def test_union_deltas_track_reference_union(seed):
    r = random.Random(seed)
    u = fp.DesiredUnion(lease_s=10)
    model = {}                 # client -> owners (what the reference says is held)
    live = {}                  # client -> connected?
    gens = {}
    lease = {}
    upstream = {}              # what bar_stream would hold after applying every delta
    keys_up = set()
    now = 0.0
    for step in range(400):
        now += r.uniform(0, 4)
        cid = f"web-{r.randint(0, 3)}"
        op = r.randint(0, 5)
        if cid not in gens or op == 0:
            gens[cid] = gens.get(cid, -1) + 1
            d = u.hello(cid, gens[cid], now)
            live[cid] = True
            lease.pop(cid, None)
            model.setdefault(cid, {})
        elif op in (1, 2):
            owners = _owners(r)
            kk = frozenset((r.choice(SYMS), r.choice(KEYS)) for _ in range(r.randint(0, 3)))
            d = u.set_desired(cid, fp.Desired(gen=gens[cid], owners=owners, keys=kk), now)
            model[cid] = {o: dict(s) for o, s in owners.items()}
        elif op == 3 and u._clients[cid].has_desired and u._clients[cid].gen == gens[cid]:
            p = fp.Patch(gen=gens[cid], seq=u._clients[cid].patch_seq + 1, owners=_owners(r, allow_empty=True))
            d = u.apply_patch(cid, p, now)
            for o, syms in p.owners.items():
                cur = model[cid].setdefault(o, {})
                for s, ch in syms.items():
                    if ch:
                        cur[s] = ch
                    else:
                        cur.pop(s, None)
        elif op == 4 and live.get(cid):
            d = u.disconnect(cid, now)
            assert d.is_empty()
            live[cid] = False
            lease[cid] = now + 10
        else:
            d = u.expire(now)
            for c in d.released_clients:
                assert not live[c] and now >= lease[c]
                del model[c], live[c], gens[c], lease[c]
        _apply_delta(upstream, d)
        keys_up = (keys_up - d.keys_removed) | d.keys_added
        assert upstream == _ref_union(model) == u.channels(), f"seed={seed} step={step}"
        assert keys_up == u.keys()
        # every leased client whose lease has not ended is still held
        for c, until in lease.items():
            if now < until:
                assert c in u._clients


def test_one_owner_or_client_leaving_never_narrows_another():
    u = fp.DesiredUnion()
    u.hello("w1", 0, 0)
    u.hello("w2", 0, 0)
    d = u.set_desired("w1", fp.Desired(gen=0, owners={"bars": {"AAPL": frozenset({"AM", "A", "T"})},
                                                      "volume": {"AAPL": frozenset({"A"})}}), 0)
    assert d.subscribe == {"AAPL": frozenset({"AM", "A", "T"})}
    u.set_desired("w2", fp.Desired(gen=0, owners={"nhnl": {"AAPL": frozenset({"T"})}}), 0)
    # owner "bars" leaves w1: A stays (volume), T stays (w2's nhnl), only AM goes
    d = u.apply_patch("w1", fp.Patch(gen=0, seq=1, owners={"bars": {"AAPL": frozenset()}}), 1)
    assert d.unsubscribe == {"AAPL": frozenset({"AM"})} and not d.subscribe
    # w1 drops everything: T is still w2's
    d = u.set_desired("w1", fp.Desired(gen=0), 2)
    assert d.unsubscribe == {"AAPL": frozenset({"A"})}
    assert u.channels() == {"AAPL": frozenset({"T"})}


def test_lease_holds_until_explicit_expiry_then_releases():
    u = fp.DesiredUnion(lease_s=180)
    u.hello("w1", 0, now=1000)
    u.set_desired("w1", fp.Desired(gen=0, owners={"bars": {"NVDA": frozenset({"T"})}},
                                   keys=frozenset({("NVDA", "1")}), tas_syms=frozenset({"NVDA"})), 1000)
    assert u.disconnect("w1", now=1010).is_empty()
    assert u.next_expiry() == 1190
    assert u.expire(now=1189.999).is_empty()
    assert u.channels() == {"NVDA": frozenset({"T"})}
    d = u.expire(now=1190)
    assert d.unsubscribe == {"NVDA": frozenset({"T"})}
    assert d.keys_removed == {("NVDA", "1")} and d.tas_removed == {"NVDA"}
    assert d.released_clients == ("w1",)
    assert u.channels() == {} and u.next_expiry() is None
    with pytest.raises(fp.UnknownClient):
        u.set_desired("w1", fp.Desired(gen=1), 1200)


def test_reconnect_within_lease_keeps_feed_warm():
    u = fp.DesiredUnion(lease_s=180)
    u.hello("w1", 0, 0)
    u.set_desired("w1", fp.Desired(gen=0, owners={"bars": {"SPY": frozenset({"AM", "T"})}}), 0)
    u.disconnect("w1", 10)
    assert u.hello("w1", 1, 100).is_empty()          # the new web pod
    assert u.expire(10_000).is_empty()                # lease cancelled by the hello
    d = u.set_desired("w1", fp.Desired(gen=1, owners={"bars": {"SPY": frozenset({"T"})}}), 101)
    assert d.unsubscribe == {"SPY": frozenset({"AM"})} and not d.subscribe


def test_generation_and_patch_order_are_enforced_and_atomic():
    u = fp.DesiredUnion()
    u.hello("w1", 5, 0)
    with pytest.raises(fp.PatchOutOfOrder):          # patch before any desired
        u.apply_patch("w1", fp.Patch(gen=5, seq=1), 0)
    with pytest.raises(fp.StaleGeneration):
        u.set_desired("w1", fp.Desired(gen=4), 0)
    with pytest.raises(fp.StaleGeneration):
        u.hello("w1", 4, 0)
    u.set_desired("w1", fp.Desired(gen=5, owners={"bars": {"A": frozenset({"T"})}}), 0)
    before = u.channels()
    with pytest.raises(fp.PatchOutOfOrder):
        u.apply_patch("w1", fp.Patch(gen=5, seq=2, owners={"bars": {"B": frozenset({"T"})}}), 0)
    with pytest.raises(fp.PatchOutOfOrder):
        u.apply_patch("w1", fp.Patch(gen=6, seq=1), 0)
    with pytest.raises(fp.StaleGeneration):
        u.apply_patch("w1", fp.Patch(gen=4, seq=1), 0)
    assert u.channels() == before
    u.apply_patch("w1", fp.Patch(gen=5, seq=1, tas_add=frozenset({"A"}), nhnl_seeds={"A": [1, 2]}), 0)
    u.apply_patch("w1", fp.Patch(gen=5, seq=2, nhnl_seeds={"A": None}), 0)
    assert u.tas_syms() == {"A"} and u.nhnl_seeds() == {}
    with pytest.raises(fp.UnknownClient):
        u.disconnect("nobody", 0)


def test_patch_after_gen_raise_is_rejected_until_new_desired():
    """Review blocker (#1193): a hello that raises gen must not let a patch for
    the new gen apply onto the previous gen's held set. The held set stays (lease
    semantics) and patches are refused until this connection's desired."""
    u = fp.DesiredUnion()
    u.hello("w1", 1, 0)
    u.set_desired("w1", fp.Desired(gen=1, owners={"bars": {"AAPL": frozenset({"T"})}}), 0)
    u.disconnect("w1", 1)
    assert u.hello("w1", 2, 2).is_empty()
    assert u.channels() == {"AAPL": frozenset({"T"})}          # held, feed stays warm
    with pytest.raises(fp.PatchOutOfOrder):
        u.apply_patch("w1", fp.Patch(gen=2, seq=1, owners={"bars": {"MSFT": frozenset({"T"})}}), 3)
    assert u.channels() == {"AAPL": frozenset({"T"})}          # NOT AAPL+MSFT
    # a same-gen re-hello also drops the old connection's patch stream
    u.set_desired("w1", fp.Desired(gen=2, owners={"bars": {"AAPL": frozenset({"T"})}}), 4)
    u.hello("w1", 2, 5)
    with pytest.raises(fp.PatchOutOfOrder):
        u.apply_patch("w1", fp.Patch(gen=2, seq=1, owners={"bars": {"MSFT": frozenset({"T"})}}), 6)
    # once the new desired lands, patches apply on top of IT
    d = u.set_desired("w1", fp.Desired(gen=2, owners={"bars": {"NVDA": frozenset({"T"})}}), 7)
    assert d.subscribe == {"NVDA": frozenset({"T"})} and d.unsubscribe == {"AAPL": frozenset({"T"})}
    u.apply_patch("w1", fp.Patch(gen=2, seq=1, owners={"bars": {"MSFT": frozenset({"T"})}}), 8)
    assert u.channels() == {"NVDA": frozenset({"T"}), "MSFT": frozenset({"T"})}


def test_diff_channels():
    sub, unsub = fp.diff_channels({"A": {"AM", "T"}, "B": {"A"}}, {"A": {"T", "A"}, "C": {"AM"}})
    assert sub == {"A": frozenset({"A"}), "C": frozenset({"AM"})}
    assert unsub == {"A": frozenset({"AM"}), "B": frozenset({"A"})}


# ── 4. seq / epoch tracker ──────────────────────────────────────────────────────

def test_seq_tracker_actions():
    T = fp.TrackAction
    tr = fp.SeqTracker()
    assert tr.accept(10, 2) is T.RESYNC                # first batch must start an epoch at 1
    assert tr.accept(10, 3) is T.DISCARD
    assert tr.accept(11, 1) is T.RESET_AND_APPLY
    assert tr.accept(11, 2) is T.APPLY
    assert tr.accept(11, 3) is T.APPLY
    assert tr.accept(11, 3) is T.RESYNC                # duplicate
    assert tr.accept(11, 4) is T.DISCARD               # still resyncing
    assert tr.accept(12, 5) is T.DISCARD               # a new epoch must start at 1
    assert tr.accept(12, 1) is T.RESET_AND_APPLY       # ingest restart / new connection
    assert tr.accept(12, 3) is T.RESYNC                # gap
    tr.reset()
    assert tr.accept(12, 1) is T.RESET_AND_APPLY       # after an explicit reconnect, the same epoch id may restart
    assert tr.counters["duplicates"] == 1 and tr.counters["gaps"] >= 2


def test_reusing_an_epoch_across_connections_requires_reset():
    T = fp.TrackAction
    tr = fp.SeqTracker()
    assert tr.accept(5, 1) is T.RESET_AND_APPLY
    assert tr.accept(5, 2) is T.APPLY
    # new connection, SAME epoch id, no reset(): its seq 1 reads as a duplicate
    assert tr.accept(5, 1) is T.RESYNC
    tr.reset()
    assert tr.accept(5, 1) is T.RESET_AND_APPLY
    assert "reset()" in fp.SeqTracker.__doc__


@pytest.mark.parametrize("seed", SEEDS)
def test_seq_tracker_never_applies_out_of_order(seed):
    r = random.Random(seed)
    tr = fp.SeqTracker()
    epoch, seq = 0, 0
    applied = []
    for _ in range(500):
        x = r.random()
        if x < 0.05:
            epoch, seq = epoch + 1, 0
        if x < 0.1:
            s = seq + r.choice([2, 3, 0, -1])
        else:
            s = seq + 1
        s = max(1, s)
        seq = max(seq, s)
        a = tr.accept(epoch, s)
        if a in (fp.TrackAction.APPLY, fp.TrackAction.RESET_AND_APPLY):
            if a is fp.TrackAction.RESET_AND_APPLY:
                assert s == 1
                applied.append((epoch, []))
            else:
                assert applied and applied[-1][0] == epoch
            applied[-1][1].append(s)
        if a is fp.TrackAction.RESYNC:
            epoch, seq = epoch + 1, 0             # the client reconnects -> new epoch
    for _, seqs in applied:
        assert seqs == list(range(1, len(seqs) + 1)), f"seed={seed}"


# ── 5. relay: legacy filter + rev HLC ───────────────────────────────────────────

@pytest.mark.parametrize("seed", SEEDS)
def test_legacy_never_sees_older_t_v2_sees_every_frame(seed):
    r = random.Random(seed)
    lf, rc = fp.LegacyFilter(), fp.RevClock()
    legacy_seen, v2_seen = {}, {}
    now = 1_700_000_000_000
    for _ in range(80):
        now += r.randint(-500, 2000)
        bars = [fp.BarUpdate(r.choice(SYMS[:2]), r.choice(KEYS[:2]),
                             _bar(r, r.randint(0, 6) * 60_000), r.random() < 0.4)
                for _ in range(r.randint(0, 5))]
        for f in fp.relay_bars(bars, lf, rc, now):
            k = (f.sym, f.key)
            v2_seen.setdefault(k, []).append(f.msg["bar"]["t"])
            if fp.LegacyFilter.deliver(f.legacy_ok, v2=False):
                assert f.msg["bar"]["t"] >= max(legacy_seen.get(k, [f.msg["bar"]["t"]])), f"seed={seed}"
                legacy_seen.setdefault(k, []).append(f.msg["bar"]["t"])
            assert fp.LegacyFilter.deliver(f.legacy_ok, v2=True)
    for k, ts in legacy_seen.items():
        assert ts == sorted(ts)
        assert len(v2_seen[k]) >= len(ts)


def test_v2_receives_older_t_final_legacy_does_not():
    lf, rc = fp.LegacyFilter(), fp.RevClock()
    new = fp.BarUpdate("A", "1", {"t": 120_000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}, False)
    late = fp.BarUpdate("A", "1", {"t": 60_000, "o": 2, "h": 2, "l": 2, "c": 2, "v": 2}, True)
    f1, f2 = fp.relay_bars([new, late], lf, rc, 5)
    assert f1.legacy_ok and not f2.legacy_ok
    assert f2.msg["bar"]["final"] is True
    assert fp.LegacyFilter.deliver(f2.legacy_ok, v2=True)
    assert not fp.LegacyFilter.deliver(f2.legacy_ok, v2=False)
    assert lf.high("A", "1") == 120_000


@pytest.mark.parametrize("seed", SEEDS)
def test_rev_strictly_increasing_across_epochs_and_clock_steps(seed):
    r = random.Random(seed)
    rc = fp.RevClock()
    tr = fp.SeqTracker()
    last = {}
    now = 1_700_000_000_000
    epoch = 1
    for i in range(1000):
        now += r.choice([0, 0, 1, 5, -1000, 250, -3])     # wall clock can stand still or step back
        if r.random() < 0.02:
            epoch += 1                                     # ingest restart: mirror reset, rev untouched
            tr.reset()
        k = (r.choice(SYMS[:2]), r.choice(KEYS[:2]))
        rev = rc.stamp(*k, now)
        assert rev > last.get(k, -1), f"seed={seed}"
        assert rev >= now                                 # comparable with REST as-of ms
        last[k] = rev
    rc.observe("AAPL", "1", 10**15)
    assert rc.stamp("AAPL", "1", 0) == 10**15 + 1
    with pytest.raises(ValueError):
        rc.stamp("AAPL", "1", 1.5)


def _derive_order(bar, final):
    """A bar as BarBroadcaster._derive builds it: final BEFORE trade_ts."""
    out = {k: bar[k] for k in ("t", "o", "h", "l", "c", "v")}
    out["final"] = final
    if "trade_ts" in bar:
        out["trade_ts"] = bar["trade_ts"]
    return out


def test_relay_frames_semantically_equal_to_bar_broadcaster_dispatch():
    """With subscribers on the key, the relay produces the same frames as
    BarBroadcaster._dispatch: same fields and values, same rev, same legacy/v2
    routing. The contract is SEMANTIC equality (decoded dicts), not bytes: JSON
    key order is not part of it."""
    from api.services import bar_broadcaster as bb

    clock = [1_700_000_000_000]
    b = bb.BarBroadcaster(clock_ms=lambda: clock[0])
    got = {"legacy": [], "v2": []}

    class _Loop:
        def __init__(self, name):
            self.name = name

        def call_soon_threadsafe(self, fn, q, msg):
            got[self.name].append(orjson.loads(orjson.dumps(msg)))

    pairs = [(object(), _Loop("legacy"), False), (object(), _Loop("v2"), True)]
    lf, rc = fp.LegacyFilter(), fp.RevClock()
    mine = {"legacy": [], "v2": []}
    r = random.Random(1234)
    for _ in range(300):
        clock[0] += r.choice([0, 1, 7, -20, 100])
        sym, key = r.choice(["AAPL", "SPY"]), r.choice(KEYS)
        bar = _bar(r, r.randint(0, 5) * 60_000)
        final = r.random() < 0.4
        b._dispatch(sym, key, [_derive_order(bar, final)], pairs)
        for f in fp.relay_bars([fp.BarUpdate(sym, key, bar, final)], lf, rc, clock[0]):
            for name, v2 in (("legacy", False), ("v2", True)):
                if fp.LegacyFilter.deliver(f.legacy_ok, v2):
                    mine[name].append(orjson.loads(orjson.dumps(f.msg)))
    assert mine == got
    assert len(got["v2"]) > len(got["legacy"]) > 0
    # the relay keeps _derive's key order too (a courtesy, not a contract)
    f = fp.frame_for("AAPL", "1", {"trade_ts": 5, "t": 0, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}, True, 9)
    assert list(f["bar"]) == ["t", "o", "h", "l", "c", "v", "final", "trade_ts"]


def test_relay_always_stamps_even_where_dispatch_skips_no_subscriber_keys():
    """Documented, intended difference: BarBroadcaster._dispatch returns early
    for a key with no subscribers (rev and _legacy_hi do not move); relay_bars
    always stamps rev and always advances the legacy high-water mark, so a legacy
    subscriber joining later can never be sent a t older than one already
    relayed, and rev keeps moving with the mirror REST reads."""
    from api.services import bar_broadcaster as bb

    b = bb.BarBroadcaster(clock_ms=lambda: 1000)
    newer = {"t": 120_000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}
    b._dispatch("AAPL", "1", [{**newer, "final": False}], [])     # nobody subscribed
    assert b._rev.get(("AAPL", "1")) is None
    assert b._legacy_hi.get(("AAPL", "1")) is None

    lf, rc = fp.LegacyFilter(), fp.RevClock()
    fp.relay_bars([fp.BarUpdate("AAPL", "1", newer, False)], lf, rc, 1000)
    assert rc.peek("AAPL", "1") == 1000 and lf.high("AAPL", "1") == 120_000
    late = fp.BarUpdate("AAPL", "1", {"t": 60_000, "o": 2, "h": 2, "l": 2, "c": 2, "v": 2}, True)
    (f2,) = fp.relay_bars([late], lf, rc, 1000)
    assert f2.msg["rev"] == 1001 and not f2.legacy_ok   # v2-only; rev still strictly increasing


# ── rails ───────────────────────────────────────────────────────────────────────

def test_key_spec_matches_bar_broadcaster():
    from api.services import bar_broadcaster as bb
    assert fp.KEY_SPEC == bb._KEY_SPEC


def test_channels_match_bar_stream_when_scoped_channels_exist():
    from api.services import bar_stream
    order = getattr(bar_stream, "_CHANNEL_ORDER", None)
    if order is None:
        pytest.skip("bar_stream has no _CHANNEL_ORDER yet (PR #1186 not merged)")
    assert tuple(order) == fp.CHANNELS


_FORBIDDEN_IMPORTS = {"time", "datetime", "random", "asyncio", "threading", "socket", "os",
                      "uuid", "secrets", "subprocess"}


def test_module_is_deterministic_no_wall_clock_or_io_imports():
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [a.name.split(".")[0] for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [(node.module or "").split(".")[0]]
        else:
            continue
        bad = set(names) & _FORBIDDEN_IMPORTS
        assert not bad, f"feed_protocol imports {bad}: time must be a parameter, never read"
        assert all(n in {"__future__", "enum", "math", "re", "collections", "dataclasses",
                         "typing", "orjson"} for n in names), names
    src = MODULE.read_text(encoding="utf-8")
    for needle in ("time.time", "monotonic(", "datetime.now", "perf_counter"):
        assert needle not in src


def test_same_inputs_same_outputs():
    def run():
        r = random.Random(99)
        buf = fp.CoalescingBuffer(epoch=1)
        out = []
        for _ in range(300):
            buf.offer_bar(r.choice(SYMS), r.choice(KEYS), _bar(r, r.randint(0, 9) * 60_000), r.random() < 0.3)
            buf.offer_tas(r.choice(SYMS), r.randint(0, 10**6), 1.0, 1)
            if r.random() < 0.2:
                b = buf.drain()
                if b:
                    out.append(fp.encode(b))
        return out
    assert run() == run()


#: Runtime modules allowed to import feed_protocol. Each entry is a deliberate wiring
#: step: PR4a = the stream-ingest service (its own process; the web pod imports neither).
FEED_PROTOCOL_IMPORTERS = frozenset({
    "api/stream_ingest_main.py",
    "api/services/ingest_feed_server.py",
})


def test_no_runtime_module_imports_feed_protocol():
    """PR3 shipped the protocol only. Wiring it into a runtime path must be a
    deliberate change to FEED_PROTOCOL_IMPORTERS (PR4a: the ingest service; PR5: web)."""
    offenders = []
    for base in ("api", "scripts", "tools", "services"):
        root = ROOT / base
        if not root.exists():
            continue
        for p in root.rglob("*.py"):
            if p == MODULE or p.name.endswith("_test.py") or p.name.startswith("test_"):
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            rel = p.relative_to(ROOT).as_posix()
            if "feed_protocol" in text and rel not in FEED_PROTOCOL_IMPORTERS:
                offenders.append(rel)
    assert offenders == []
