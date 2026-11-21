"""The first-frame seed's daily delta (api/services/ffseed_delta.py, spec section 10).

Pinned: applying the delta to the base gives the new pack EXACTLY (every symbol, every column, the
scales), the operation chosen per symbol (keep / merge / replace / remove, the splits names always
replaced), the proof that refuses to publish a delta it cannot reproduce, and the nightly wiring (a
delta only from a verified base, never a failed publish because of a delta).
"""
import hashlib
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from api.services import ffseed, ffseed_delta as dl, ffseed_format as fmt

ET = ZoneInfo("America/New_York")


def _session_bars(d: date, base_px: float, dp: int = 4, n: int = 78, seed: int = 0):
    out, px = [], base_px
    for i in range(n):
        m = 9 * 60 + 30 + 5 * i
        t = int(datetime(d.year, d.month, d.day, m // 60, m % 60, tzinfo=ET).timestamp())
        o = round(px, dp)
        c = round(px * (1 + ((i * 7 + seed) % 11 - 5) / 2000), dp)
        out.append({"t": t, "o": o, "h": round(max(o, c) + 0.01, dp), "l": round(min(o, c) - 0.01, dp), "c": c,
                    "v": 1000 + i * 10 + seed})
        px = c
    return out


def _days(end: date, n: int):
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5 and d not in (date(2026, 11, 26),):
            out.append(d)
        d -= timedelta(days=1)
    return out[::-1]


BASE_DAYS = _days(date(2026, 11, 19), 5)            # Nov 13 .. Nov 19
NEW_DAYS = _days(date(2026, 11, 20), 5)             # Nov 16 .. Nov 20


def _window(days, px, dp=4, seed=0, depth=300):
    bars = []
    for i, d in enumerate(days):
        bars += _session_bars(d, px + i, dp=dp, seed=seed)
    return bars[-depth:]


def _series():
    """{sym: (base bars or None, new bars or None)} covering every operation."""
    full = {sym: _window(_days(date(2026, 11, 20), 6), 50.0 + k, seed=k, depth=10_000)
            for k, sym in enumerate(["APP", "REV", "SAME", "SPLIT", "HOLE", "UP", "DOWN"])}
    s = {}
    for sym, bars in full.items():
        s[sym] = (bars[:-78][-300:], bars[-300:])          # new = base shifted by one session
    s["SAME"] = (s["SAME"][0], list(s["SAME"][0]))         # nothing changed (e.g. a halted name)
    rev_new = [dict(b) for b in s["REV"][1]]
    rev_new[10]["h"] = round(rev_new[10]["h"] + 0.5, 4)    # a bar the server revised since the base
    s["REV"] = (s["REV"][0], rev_new)
    hole_new = [b for i, b in enumerate(s["HOLE"][1]) if i != 20]   # the server dropped a bar inside the overlap
    s["HOLE"] = (s["HOLE"][0], hole_new)
    up_base = [dict(b, o=round(b["o"], 2), h=round(b["h"], 2), l=round(b["l"], 2), c=round(b["c"], 2)) for b in s["UP"][0]]
    up_new = [b for b in up_base if b["t"] >= s["UP"][1][0]["t"]] + s["UP"][1][-78:]     # new rows carry 4 dp
    s["UP"] = (up_base, up_new[-300:])
    down_new = [dict(b, o=round(b["o"], 2), h=round(b["h"], 2), l=round(b["l"], 2), c=round(b["c"], 2)) for b in s["DOWN"][1]]
    down_base = list(s["DOWN"][0][:78]) + [b for b in down_new if b["t"] <= s["DOWN"][0][-1]["t"]][-222:]
    s["DOWN"] = (down_base, down_new)                     # base holds an old 4 dp session; the new window is 2 dp
    s["GONE"] = (_window(BASE_DAYS, 20.0, seed=9), None)
    s["NEWSYM"] = (None, _window(NEW_DAYS, 30.0, seed=11))
    return s


def _packs(series, tf="5", base_build="20261120T0131Z", new_build="20261121T0131Z", comp="gzip"):
    pb = fmt.PackBuilder(tf, asof="2026-11-19", build=base_build, depth=300, comp=comp)
    pn = fmt.PackBuilder(tf, asof="2026-11-20", build=new_build, depth=300, comp=comp)
    for sym, (b, n) in series.items():
        if b:
            pb.add_served(sym, b)
        if n:
            pn.add_served(sym, n)
    return pb.finish(), pn.finish()


def _new_cols(new_bytes):
    tr = fmt.read_trailer(new_bytes)
    return {s: fmt.decode_symbol(new_bytes, tr, s) for s in tr["symbols"]}


def test_applying_the_delta_gives_the_new_pack_exactly_and_each_symbol_takes_the_right_op():
    base, new = _packs(_series())
    delta, st = dl.build_delta(base, new, splits_symbols=["SPLIT"])
    tr = dl.read_delta_trailer(delta)
    ops = {s: dl.OP_NAMES[e[0]] for s, e in tr["symbols"].items()}
    assert ops == {"APP": "merge", "REV": "merge", "SAME": "keep", "SPLIT": "replace", "HOLE": "replace",
                   "UP": "merge", "DOWN": "merge", "GONE": "remove", "NEWSYM": "replace"}
    rows = {s: e[3] for s, e in tr["symbols"].items()}
    assert rows["APP"] == 78 and rows["REV"] == 79                   # the new session, plus the revised bar
    got = dl.apply_delta(base, delta)
    want = _new_cols(new)
    assert set(got) == set(want)
    for s in want:
        for k in fmt.COLUMNS:
            assert np.array_equal(got[s][k], want[s][k]), (s, k)
        assert (got[s]["pscale"], got[s]["vscale"]) == (want[s]["pscale"], want[s]["vscale"]), s
    assert (tr["base"], tr["build"], tr["base_asof"], tr["asof"]) == ("20261120T0131Z", "20261121T0131Z", "2026-11-19", "2026-11-20")
    assert st["merge"] == 4 and st["remove"] == 1 and len(delta) < len(new)


def test_daily_timeframe_delta_round_trips():
    def daily(days, px):
        return [{"t": d.isoformat(), "o": px + i, "h": px + i + 1, "l": px + i - 1, "c": px + i + 0.5, "v": 100 + i}
                for i, d in enumerate(days)]
    base_days = _days(date(2026, 11, 19), 350)
    new_days = _days(date(2026, 11, 20), 350)
    pb = fmt.PackBuilder("D", asof="2026-11-19", build="A", depth=350)
    pn = fmt.PackBuilder("D", asof="2026-11-20", build="B", depth=350)
    pb.add_served("AAA", daily(base_days, 10.0)[-350:])
    pn.add_served("AAA", daily(_days(date(2026, 11, 20), 351), 10.0)[-350:])
    base, new = pb.finish(), pn.finish()
    delta, st = dl.build_delta(base, new)
    assert st["merge"] == 1 and dl.read_delta_trailer(delta)["symbols"]["AAA"][3] == 1   # one new daily bar
    got = dl.apply_delta(base, delta)["AAA"]
    assert fmt.ints_to_served(got, "D")[-1]["t"] == "2026-11-20"


def test_the_proof_refuses_a_delta_it_cannot_reproduce(monkeypatch):
    """A builder bug that writes a wrong merge blob (here: every volume one share high) must never be
    published: the independent apply gives a different window, and build_delta raises."""
    base, new = _packs(_series())
    real = fmt.encode_body

    def wrong(cols, tf):
        bad = dict(cols)
        bad["v"] = np.asarray(cols["v"]) + 1
        return real(bad, tf)
    monkeypatch.setattr(fmt, "encode_body", wrong)
    with pytest.raises((dl.DeltaError, fmt.SeedError)):
        dl.build_delta(base, new)


def test_a_damaged_delta_or_the_wrong_base_is_refused_on_apply():
    base, new = _packs(_series())
    delta, _ = dl.build_delta(base, new)
    tr = dl.read_delta_trailer(delta)
    off, ln = tr["symbols"]["APP"][1:3]
    bad = bytearray(delta)
    bad[off + ln // 2] ^= 1
    with pytest.raises((dl.DeltaError, fmt.SeedError)):
        dl.apply_delta(base, bytes(bad))
    other_base, _ = _packs(_series(), base_build="20261119T0131Z")
    with pytest.raises(dl.DeltaError, match="applies to base"):
        dl.apply_delta(other_base, delta)
    with pytest.raises(dl.DeltaError, match="same build"):
        dl.build_delta(new, new)


def test_a_wrong_value_in_a_raw_merge_blob_is_caught_by_the_window_crc():
    base, new = _packs(_series(), comp="raw")
    delta, _ = dl.build_delta(base, new)
    tr = dl.read_delta_trailer(delta)
    off, ln, rows = tr["symbols"]["APP"][1:4]
    bad = bytearray(delta)
    bad[off + ln - 1] ^= 0x01                 # the last N value 0 -> 1: decodes cleanly, the window is wrong
    with pytest.raises((dl.DeltaError, fmt.SeedError)):
        dl.apply_delta(base, bytes(bad))


def test_a_delta_is_never_mistaken_for_a_full_pack_or_the_reverse():
    base, new = _packs(_series())
    delta, _ = dl.build_delta(base, new)
    with pytest.raises(fmt.SeedError):
        fmt.read_trailer(delta)
    with pytest.raises(dl.DeltaError):
        dl.read_delta_trailer(new)
    # the magic alone refuses it: a delta wearing the full pack's end marker is not read as a delta
    with pytest.raises(dl.DeltaError, match="UFFSDLT2 / UFFSDLT1"):
        dl.read_delta_trailer(delta[:-8] + fmt.MAGIC)


def _reframe(delta: bytes, *, gz: bool, magic: bytes, edit=None) -> bytes:
    """`delta` with its trailer re-written (plain JSON or gzip) under `magic`; the blobs unchanged."""
    import gzip
    import struct
    (tlen,) = struct.unpack("<Q", delta[-16:-8])
    start = len(delta) - 16 - tlen
    raw = delta[start:start + tlen]
    tr = json.loads(gzip.decompress(raw) if delta[-8:] == dl.MAGIC else raw)
    if edit:
        edit(tr)
    t = json.dumps(tr, sort_keys=True, separators=(",", ":")).encode("ascii")
    t = gzip.compress(t, 9, mtime=0) if gz else t
    return delta[:start] + t + struct.pack("<Q", len(t)) + magic


def test_the_builder_writes_a_gzip_trailer_deterministically_and_version_1_still_reads():
    import gzip
    base, new = _packs(_series())
    delta, _ = dl.build_delta(base, new)
    again, _ = dl.build_delta(base, new)
    assert delta[-8:] == b"UFFSDLT2" and delta == again                       # same inputs, same bytes
    tr = dl.read_delta_trailer(delta)
    assert tr["v"] == 2
    v1 = _reframe(delta, gz=False, magic=b"UFFSDLT1", edit=lambda t: t.update(v=1))
    assert len(v1) > len(delta)                                               # the gzip trailer is the smaller
    t1 = dl.read_delta_trailer(v1)
    assert t1["symbols"] == tr["symbols"] and t1["blob_bytes"] == tr["blob_bytes"]
    dl.verify_delta(base, v1, new)                                            # a v1 file applies exactly too
    (tlen,) = __import__("struct").unpack("<Q", delta[-16:-8])
    gz = delta[len(delta) - 16 - tlen:len(delta) - 16]
    assert gzip.decompress(gz).startswith(b"{") and gz[4:8] == b"\0\0\0\0"    # gzip MTIME 0: no clock in it


@pytest.mark.parametrize("bad", ["plain trailer under v2", "v2 json under v1", "v1 json under v2",
                                 "gzip with trailing bytes", "truncated gzip"])
def test_a_trailer_that_does_not_match_its_version_is_refused(bad):
    import gzip
    import struct
    base, new = _packs(_series())
    delta, _ = dl.build_delta(base, new)
    if bad == "plain trailer under v2":
        d = _reframe(delta, gz=False, magic=b"UFFSDLT2")
    elif bad == "v2 json under v1":
        d = _reframe(delta, gz=False, magic=b"UFFSDLT1")
    elif bad == "v1 json under v2":
        d = _reframe(delta, gz=True, magic=b"UFFSDLT2", edit=lambda t: t.update(v=1))
    else:
        (tlen,) = struct.unpack("<Q", delta[-16:-8])
        start = len(delta) - 16 - tlen
        gz = delta[start:start + tlen]
        gz = gz + b"\x00junk" if bad == "gzip with trailing bytes" else gz[:-6]
        d = delta[:start] + gz + struct.pack("<Q", len(gz)) + dl.MAGIC
    with pytest.raises(dl.DeltaError):
        dl.read_delta_trailer(d)


def test_the_vectorized_decoder_equals_the_reference_decoder():
    _, new = _packs(_series())
    tr = fmt.read_trailer(new)
    for s in tr["symbols"]:
        a, b = fmt.decode_symbol(new, tr, s), fmt.decode_symbol_fast(new, tr, s)
        assert all(np.array_equal(a[k], b[k]) for k in fmt.COLUMNS)


# ---- the nightly wiring ------------------------------------------------------------------------

def _manifest_for(build_id, asof, tf, data, splits=None):
    m = {"v": 1, "kind": "ffseed", "build": build_id, "asof": asof,
         "tfs": {tf: {"key": f"ffseed/{build_id}/{tf}.ffs", "sha256": hashlib.sha256(data).hexdigest()}}}
    if splits:
        m["splits"] = splits
    return m


def test_attach_delta_needs_a_verified_base_and_never_raises(monkeypatch, tmp_path):
    from api.services import data_sync
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    base, new = _packs(_series())
    entry = {"key": "ffseed/20261121T0131Z/5.ffs", "url": "/api/seed/v1/20261121T0131Z/5.ffs"}
    up = []
    upload = lambda key, blob: up.append((key, len(blob))) or True
    m = _manifest_for("20261120T0131Z", "2026-11-19", "5", base,
                      splits={"session": "2026-11-20", "symbols": {"SPLIT": 2.0}})
    # no base anywhere: no delta
    monkeypatch.setattr(data_sync, "get_bytes", lambda key: None)
    assert ffseed.attach_delta("5", new, dict(entry), m, "2026-11-20", upload) is None
    # a VALID pack whose sha256 is not the manifest's (another build): no delta
    other, _ = _packs(_series(), base_build="20261119T0131Z")
    monkeypatch.setattr(data_sync, "get_bytes", lambda key: other)
    assert ffseed.attach_delta("5", new, dict(entry), m, "2026-11-20", upload) is None
    assert up == []
    # the verified base from R2: a delta, uploaded next to the pack, recorded in the entry
    monkeypatch.setattr(data_sync, "get_bytes", lambda key: base if key == "ffseed/20261120T0131Z/5.ffs" else None)
    e = dict(entry)
    d = ffseed.attach_delta("5", new, e, m, "2026-11-20", upload)
    assert d is e["delta"] and d["base"] == "20261120T0131Z" and d["base_asof"] == "2026-11-19"
    assert d["key"] == "ffseed/20261121T0131Z/5.delta.ffs" and d["url"] == "/api/seed/v1/20261121T0131Z/5.delta.ffs"
    assert up == [(d["key"], d["bytes"])] and d["ops"]["replace"] == 3        # SPLIT forced, HOLE, NEWSYM
    # a failing upload, or a builder error: no delta, no exception
    assert ffseed.attach_delta("5", new, dict(entry), m, "2026-11-20", lambda k, b: False) is None
    monkeypatch.setattr(ffseed, "_base_pack", lambda *a: (_ for _ in ()).throw(RuntimeError("boom")))
    assert ffseed.attach_delta("5", new, dict(entry), m, "2026-11-20", upload) is None


def test_the_local_copy_is_preferred_and_must_match_too(monkeypatch, tmp_path):
    from api.services import data_sync
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    base, _ = _packs(_series())
    ffseed._cache_pack("20261120T0131Z", "5", base)
    asked = []
    monkeypatch.setattr(data_sync, "get_bytes", lambda key: asked.append(key))
    entry = {"key": "ffseed/20261120T0131Z/5.ffs", "sha256": hashlib.sha256(base).hexdigest()}
    assert ffseed._base_pack(entry, "20261120T0131Z", "5") == base and asked == []
    entry["sha256"] = "0" * 64
    assert ffseed._base_pack(entry, "20261120T0131Z", "5") is None and asked == [entry["key"]]


def test_build_and_publish_puts_pack_then_delta_then_manifest(monkeypatch, tmp_path):
    from api.services import data_sync
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ffseed, "_massive_split_rows", lambda s: (_ for _ in ()).throw(RuntimeError("offline")))
    asof = date(2026, 11, 20)
    old_days = _days(date(2026, 11, 19), 40)
    new_days = _days(date(2026, 11, 20), 40)
    row = lambda d, i: {"t": d.isoformat(), "o": 10.0 + i, "h": 11.0 + i, "l": 9.0 + i, "c": 10.5 + i, "v": 7 + i}  # noqa: E731
    pb = fmt.PackBuilder("D", asof="2026-11-19", build="20261120T0131Z", depth=350)
    pb.add_served("AAA", [row(d, i) for i, d in enumerate(old_days)])
    base = pb.finish()
    man = _manifest_for("20261120T0131Z", "2026-11-19", "D", base)
    store = {"ffseed/latest.json": json.dumps(man).encode(), "ffseed/20261120T0131Z/D.ffs": base}
    monkeypatch.setattr(data_sync, "credentials_ok", lambda: True)
    monkeypatch.setattr(data_sync, "get_bytes", lambda key: store.get(key))
    puts = []
    monkeypatch.setattr(data_sync, "put_bytes", lambda k, b, ct: puts.append(k) or store.__setitem__(k, b) or True)
    monkeypatch.setattr(ffseed, "prune", lambda *a: [])
    table = {("AAA", "D"): [row(d, i) for i, d in enumerate([old_days[0]] + new_days)][-40:]}
    table[("AAA", "D")] = [row(d, i + 1) for i, d in enumerate(new_days)]
    table[("AAA", "D")][:-1] = [row(d, i) for i, d in enumerate(old_days)][1:]
    read = lambda sym, tf, count: (table.get((sym, tf), [])[-count:], len(table.get((sym, tf), [])))  # noqa: E731
    m = ffseed.build_and_publish(tfs=["D"], symbols=["AAA"], asof=asof, read=read, min_symbols=1)
    key = m["tfs"]["D"]["key"]
    assert puts == [key, key[:-4] + ".delta.ffs", "ffseed/latest.json"]
    d = m["tfs"]["D"]["delta"]
    assert d["base"] == "20261120T0131Z" and d["ops"]["merge"] == 1
    assert d["sha256"] == hashlib.sha256(store[d["key"]]).hexdigest()
    got = dl.apply_delta(base, store[d["key"]])["AAA"]
    want = fmt.decode_symbol(store[key], fmt.read_trailer(store[key]), "AAA")
    assert all(np.array_equal(got[k], want[k]) for k in fmt.COLUMNS)
    # and tomorrow's base is kept locally (only the newest build)
    import os
    assert open(ffseed._cache_path(m["build"], "D"), "rb").read() == store[key]
    assert os.listdir(os.path.join(str(tmp_path), "ffseed_cache")) == [m["build"]]
