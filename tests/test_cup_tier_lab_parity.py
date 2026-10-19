"""PARITY: the cup recognition tier + its round-4 member drawing (pattern_engine.cup_tier) against the lab code.

lab cup_tier_v2/ct2_tier.py (recognition, t = 0.945: 28 of 33 = 84.8% on two fresh blind packets) and lab
cup_draw_v4/cd4_draw.py (drawing round 4: d1 2.42 / 96% >= 2, d2 2.50 / 88% >= 2, pre-registered) are the code
whose answers passed. This file imports that code BY PATH, runs it beside the dashboard code on the SAME real bars
and requires the same answer. The lab and C:/data/bars.db live outside this repo, so the file SKIPS when either is
absent (a lab that cannot import is "absent", never a pass). bars.db is opened mode=ro.

  * lab path: env `UCT_LAB_ROOT`, default ~/Desktop/TSDR-Ledger-Backup/lab

Levels:
  CONSTANTS  every frozen lab constant (gates, envelope, template, threshold, drawing) equals the dashboard's.
  JUDGED     every blind-judged cup case (the lab keys, read at test time, never typed here): the lab and the
             dashboard agree on tier yes/no, C and the whole drawing, on the 600-bar slice the structures route
             reads; and `cup_tier.stamp` (live detector included) stamps exactly the lab's tier fires.
  MUTATION   each drawing withhold constant, moved, makes the judged sweep disagree with the lab.
  LOOKAHEAD  the stamp on bars[:A+1] equals the answer at A with 30 wild future bars appended.
  UNSTAMPED  on real bars, auto_structures.structures_for is byte-for-byte the same with the tier stamp
             switched off, once `extras.cup_tier` is removed: the stamp adds that key and nothing else.
"""
import glob
import importlib
import json
import os
import random
import sqlite3
import sys

import numpy as np
import pytest

import api.services.pattern_engine.types  # noqa: F401  (real modules first: the lab shim then stands down)
from api.services import auto_structures
from api.services.pattern_engine import cup_tier as P

_LAB = os.environ.get("UCT_LAB_ROOT") or os.path.expanduser("~/Desktop/TSDR-Ledger-Backup/lab")
_BARS_DB = "C:/data/bars.db"
_SLICE = 600                 # auto_structures.STRUCTURE_BARS: what the route hands the stamp
_KEY_PREFIXES = ("r_cuptier_", "r_cuptier2_", "r_cupdraw3_", "r_cupdraw4_")


def _load_lab():
    need = [os.path.join(_LAB, "cup_tier_v2", "ct2_tier.py"), os.path.join(_LAB, "cup_draw_v4", "cd4_draw.py"),
            _BARS_DB]
    if not all(os.path.exists(p) for p in need):
        pytest.skip("lab cup tier / cup_draw_v4 or bars.db absent")
    for d in ("cup_draw_v4", "cup_draw_v3", "cup_tier_v2"):
        p = os.path.join(_LAB, d)
        if p not in sys.path:
            sys.path.append(p)
    try:
        t2 = importlib.import_module("ct2_tier")
        d4 = importlib.import_module("cd4_draw")
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"lab code does not import: {e}")
    sel = json.load(open(os.path.join(_LAB, "cup_tier_v2", "out", "dev_select.json"), encoding="utf-8"))
    return {"T2": t2, "D4": d4, "CT": t2.CT, "K": t2.CT.K, "T1": t2.T1, "t": sel["t"]}


@pytest.fixture(scope="module")
def lab():
    return _load_lab()


@pytest.fixture(scope="module")
def db():
    if not os.path.exists(_BARS_DB):
        pytest.skip("bars.db absent")
    c = sqlite3.connect(f"file:{_BARS_DB}?mode=ro", uri=True)
    yield c
    c.close()


def _rows(db, tk):
    rows = db.execute("select ts,o,h,l,c,v from ohlcv where ticker=? and tf='D' order by ts", (tk,)).fetchall()
    return [(int(ts), o, h, lo, c, v or 0) for ts, o, h, lo, c, v in rows if None not in (o, h, lo, c)]


def _dicts(rows):
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]),
             "v": float(r[5] or 0)} for r in rows]


def _cases():
    out = []
    for kp in sorted(glob.glob(os.path.join(_LAB, "blind_keys_team", "*.json"))):
        name = os.path.basename(kp)
        if not name.startswith(_KEY_PREFIXES):
            continue
        for cid, k in json.load(open(kp, encoding="utf-8")).items():
            if isinstance(k, dict) and "ticker" in k and "ts" in k:
                out.append((name, cid, k["ticker"], int(k["ts"]), k.get("bar_index")))
    return out


def _lab_answer(lab, rows, A):
    """(tier stamp or None, drawing or None) the lab gives at session A (live detector + tier + v4 drawing)."""
    if lab["K"].current(rows, A) is None:
        return None, None
    b = lab["CT"].arr(rows)
    f = lab["T2"].feats(b, A)
    st = lab["T2"].tier(b, A, lab["t"], feats_=f)
    if st is None:
        return None, None
    return st, lab["D4"].drawing(b, A, f)


def _dash_answer(rows, A):
    """(feats or None, drawing or None) of the dashboard code on the 600-bar slice ending at A."""
    b = np.array(rows[:A + 1][-_SLICE:], dtype=float)
    a = len(b) - 1
    f = P.tier_feats(b, a)
    if f is None or P.gate_fails(f):
        return None, None
    return f, P.drawing(b, a, f)


def _same_drawing(lab_d, dash_d):
    """The lab's v4 drawing dict and the dashboard's are the same drawing (round number aside)."""
    a = {k: v for k, v in lab_d.items() if k != "v"}
    b = {k: v for k, v in dash_d.items() if k != "v"}
    return a == b and lab_d["v"] == 4 and dash_d["v"] == P.DRAW_ROUND


@pytest.fixture(scope="module")
def judged(lab, db):
    cs = _cases()
    out = []
    for name, cid, tk, ts, bi in cs:
        rows = _rows(db, tk)
        A = [r[0] for r in rows].index(ts)
        if bi is not None:
            assert int(bi) == A, (name, cid)
        st, ld = _lab_answer(lab, rows, A)
        out.append((name, cid, tk, rows, A, st, ld))
    return out


# -- constants -------------------------------------------------------------------------------------

def test_every_lab_constant_equals_the_dashboards(lab):
    T2, T1, D4 = lab["T2"], lab["T1"], lab["D4"]
    RM = lab["CT"].RM
    assert P.T == lab["t"] == 0.945
    assert tuple(P.GATES) == tuple(T1.GATES)
    assert (P.MAX_BACK, P.HUMP_MAX, P.HI300_MIN, P.HI300_BARS) == (T1.MAX_BACK, T2.HUMP_MAX, T2.HI300_MIN,
                                                                   T2.HI300_BARS)
    assert P.ENVELOPE == RM.ENVELOPE
    tpl = json.load(open(RM.TEMPLATE_PATH, encoding="utf-8"))["template"]
    assert np.allclose(P.TEMPLATE, np.array(tpl), atol=1e-5, rtol=0)
    for k in ("EPS_ATR", "SPIKE_ATR", "SPIKE_BARS", "ABOVE_ATR", "HDEP_MAX", "FLOOR_MIN", "PSHORT_MAX"):
        assert getattr(P, k) == getattr(D4, k), k
    assert P.DRAW_ROUND == 4 and P.TIER_NAME == "cup_conf"


# -- every judged case -----------------------------------------------------------------------------

def test_the_judged_set_is_not_vacuous(judged):
    names = {j[0] for j in judged}
    assert any(n.startswith("r_cupdraw4_") for n in names) and any(n.startswith("r_cupdraw3_") for n in names)
    assert len(judged) >= 200


def test_every_judged_case_is_tiered_and_drawn_as_the_lab_does(lab, judged):
    bad, stamped, drawn, withheld = [], 0, 0, 0
    for name, cid, tk, rows, A, st, ld in judged:
        if lab["K"].current(rows, A) is None:
            continue                    # the live detector gates both; stamp() below covers that door
        f, dd = _dash_answer(rows, A)
        if (st is None) != (f is None):
            bad.append((name, cid, tk, "tier"))
            continue
        if st is None:
            continue
        stamped += 1
        if round(float(f["C"]), 4) != st["C"] or not _same_drawing(ld, dd):
            bad.append((name, cid, tk, "draw"))
        drawn += dd["withheld"] is None
        withheld += dd["withheld"] is not None
    assert bad == []
    assert stamped >= 150 and drawn >= 50 and withheld >= 20      # both branches exercised


def test_the_v4_packet_charts_draw_exactly_what_the_judges_saw(lab, judged):
    """The 50 charts the round-4 judges scored: the dashboard draws each one, identical to the key's drawing."""
    keys = {}
    for kp in glob.glob(os.path.join(_LAB, "blind_keys_team", "r_cupdraw4_*.json")):
        for cid, k in json.load(open(kp, encoding="utf-8")).items():
            keys[(os.path.basename(kp), cid)] = k
    n = 0
    for name, cid, tk, rows, A, st, ld in judged:
        if (name, cid) not in keys:
            continue
        _f, dd = _dash_answer(rows, A)
        assert dd is not None and dd["withheld"] is None, (name, cid)
        assert _same_drawing(keys[(name, cid)]["draw4"], dd), (name, cid)
        n += 1
    assert n == 50


def test_stamp_matches_the_lab_through_the_live_detector(lab, judged):
    """`cup_tier.stamp` itself (dict bars, 600-bar slice, live detector on the 400-bar window)."""
    bad, n = [], 0
    for name, cid, tk, rows, A, st, ld in judged:
        got = P.stamp(_dicts(rows[:A + 1][-_SLICE:]))
        if (st is None) != (got is None):
            bad.append((name, cid))
            continue
        if st is None:
            continue
        n += 1
        b = lab["CT"].arr(rows)
        assert got["lip_t"] == int(b[st["L"], 0]) and got["right_t"] == int(b[st["R"], 0]), (name, cid)
        assert got["C"] == st["C"] and got["withheld"] == ld["withheld"] and got["draw_round"] == 4
        if ld["withheld"] is None:
            assert (got["pivot"], got["handle"], got["rim_ref"]) == (ld["pivot"], ld["handle"], ld["rim_ref"])
    assert bad == [] and n >= 150


@pytest.mark.parametrize("const,delta", [("HDEP_MAX", -0.05), ("PSHORT_MAX", -0.3), ("ABOVE_ATR", -0.15),
                                         ("FLOOR_MIN", 0.2), ("SPIKE_ATR", -0.5), ("EPS_ATR", 0.3)])
def test_a_moved_drawing_constant_is_seen(lab, judged, monkeypatch, const, delta):
    monkeypatch.setattr(P, const, getattr(P, const) + delta)
    diff = 0
    for name, cid, tk, rows, A, st, ld in judged:
        if st is None:
            continue
        _f, dd = _dash_answer(rows, A)
        diff += dd is None or not _same_drawing(ld, dd)
    assert diff > 0, const


# -- no lookahead ----------------------------------------------------------------------------------

def _wild(rows, rnd, n=30):
    out = list(rows)
    ts, c = out[-1][0], out[-1][4]
    for _ in range(n):
        ts += 1
        c = c * (1 + rnd.uniform(-0.3, 0.3))
        out.append((ts, c, c * (1 + rnd.uniform(0, 0.3)), c * (1 - rnd.uniform(0, 0.3)), c, rnd.uniform(1e5, 1e8)))
    return out


def test_no_lookahead_future_bars_never_change_the_answer(judged):
    rnd = random.Random(20261018)
    n = 0
    for name, cid, tk, rows, A, st, ld in judged:
        cut = rows[:A + 1][-_SLICE:]
        a = len(cut) - 1
        ext = np.array(_wild(cut, rnd), dtype=float)
        f0 = P.tier_feats(np.array(cut, dtype=float), a)
        f1 = P.tier_feats(ext, a)
        assert (f0 is None) == (f1 is None)
        if f0 is None:
            continue
        assert {k: v for k, v in f0.items()} == {k: v for k, v in f1.items()}, (name, cid)
        assert P.drawing(np.array(cut, dtype=float), a, f0) == P.drawing(ext, a, f1), (name, cid)
        n += 1
    assert n >= 150


# -- unstamped rows are byte-identical ---------------------------------------------------------------

def _canon(rows, strip):
    out = []
    for r in rows:
        r = json.loads(json.dumps(r, default=str))
        if strip:
            r.get("geometry", {}).get("extras", {}).pop("cup_tier", None)
        out.append(json.dumps(r, sort_keys=True, separators=(",", ":")))
    return out


def test_structures_rows_are_byte_identical_with_the_stamp_off(judged, monkeypatch):
    """structures_for on the real 600-bar slice of every judged case: with the stamp on, every row equals the
    row with the stamp switched off once extras.cup_tier is removed; and the stamp does fire on real rows."""
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)
    stamped = rows_seen = 0
    real = auto_structures.cup_tier_stamp
    for name, cid, tk, rows, A, st, ld in judged:
        bars = _dicts(rows[:A + 1][-_SLICE:])
        monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym, _b=bars: json.loads(json.dumps(_b)))
        monkeypatch.setattr(auto_structures, "cup_tier_stamp", real)
        auto_structures._CACHE.clear()
        on = auto_structures.structures_for("SYN")
        monkeypatch.setattr(auto_structures, "cup_tier_stamp", lambda det, bars: None)
        auto_structures._CACHE.clear()
        off = auto_structures.structures_for("SYN")
        assert _canon(on, True) == _canon(off, False), (name, cid)
        rows_seen += len(on)
        stamped += sum("cup_tier" in ((r.get("geometry") or {}).get("extras") or {}) for r in on)
    auto_structures._CACHE.clear()
    assert rows_seen > 0 and stamped > 0
