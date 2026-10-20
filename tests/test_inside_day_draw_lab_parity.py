"""PARITY: the member inside-day drawing (pattern_engine.inside_day_draw) against the lab rule itself.

lab id_draw_v2/rule_id2.py (on top of lab id_draw/rule_id.py) is the code whose drawings passed the
pre-registered blind checks (packets A2 2.56 [2.36, 2.74] and B2 2.44 [2.28, 2.60]). This file imports
that code BY PATH, runs it beside the dashboard code on the SAME real bars, and requires the same
answer. The lab and C:/data/bars.db live outside this repo, so the file SKIPS when either is absent (a
lab that cannot import is "absent", never a pass). bars.db is opened mode=ro.

  * lab path: env `UCT_LAB_ID_DRAW_V2` ONLY (no default); the file skips when it is unset

Levels:
  CONSTANTS every frozen lab constant equals the dashboard constant of the same meaning.
  JUDGED    every one of the 50 blind-judged cases (out/key_A2.json, out/key_B2.json, read at test
            time, never typed here): the lab draws it, and the dashboard draws the SAME trigger, stop,
            mother range, span and ATR, on the full history AND on the 600-bar slice the structures
            route reads, and reproduces the key's recorded facts.
  SWEEP     every session of seeded random real histories: lab None <=> dashboard None, and every
            drawing identical. The sweep must contain drawings AND withholds.
  MUTATION  each gate constant, moved, makes the sweep disagree with the lab: the sweep can see it.
  LOOKAHEAD the drawing at session i on bars[:i+1] equals it with 30 wild future bars appended.
"""
import bisect
import importlib.util
import json
import os
import random
import sqlite3

import pytest

from api.services.pattern_engine import inside_day_draw as ID

_LAB_DIR = os.environ.get("UCT_LAB_ID_DRAW_V2") or ""
_BARS_DB = "C:/data/bars.db"
_SLICE = 600                 # auto_structures.STRUCTURE_BARS: what the route hands the drawing
_HIST = 24                   # random histories swept session by session
_SESSIONS = 260              # trailing sessions per history


def _lab():
    if not _LAB_DIR:
        pytest.skip("UCT_LAB_ID_DRAW_V2 unset")
    p = os.path.join(_LAB_DIR, "rule_id2.py")
    if not (os.path.exists(p) and os.path.exists(_BARS_DB)):
        pytest.skip("lab id_draw_v2 or bars.db absent")
    spec = importlib.util.spec_from_file_location("lab_rule_id2_ro", p)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"lab rule_id2 does not import: {e}")
    return mod


@pytest.fixture(scope="module")
def lab():
    return _lab()


@pytest.fixture(scope="module")
def db():
    if not os.path.exists(_BARS_DB):
        pytest.skip("bars.db absent")
    c = sqlite3.connect(f"file:{_BARS_DB}?mode=ro", uri=True)
    yield c
    c.close()


def _rows(db, tk):
    return db.execute("select ts,o,h,l,c,v from ohlcv where ticker=? and tf='D' order by ts", (tk,)).fetchall()


def _dicts(rows):
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]),
             "v": float(r[5] or 0)} for r in rows]


def _same(lab_d, dash_d, rows):
    """The lab drawing and the dashboard drawing are the same drawing."""
    if lab_d is None or dash_d is None:
        return lab_d is None and dash_d is None
    return (lab_d["trigger"] == dash_d["trigger"] and lab_d["stop"] == dash_d["stop"]
            and lab_d["mother_high"] == dash_d["mother_high"] and lab_d["mother_low"] == dash_d["mother_low"]
            and int(rows[lab_d["m"]][0]) == dash_d["start_t"] and int(rows[lab_d["k"]][0]) == dash_d["inside_t"]
            and int(rows[lab_d["i"]][0]) == dash_d["end_t"] and lab_d["variant"] == dash_d["variant"]
            and abs(lab_d["atr"] - dash_d["atr"]) <= 1e-9 * max(1.0, abs(lab_d["atr"]))
            and abs(lab_d["ctx_pos"] - dash_d["ctx_pos"]) <= 1e-12)


def _keys():
    out = []
    for pk in ("A2", "B2"):
        p = os.path.join(_LAB_DIR, "out", f"key_{pk}.json")
        if not os.path.exists(p):
            pytest.skip(f"lab key {pk} absent")
        out += list(json.load(open(p, encoding="utf-8"))["cases"].values())
    return out


def test_every_lab_constant_is_the_dashboard_constant(lab):
    r1 = lab.R1
    pairs = {"MAX_NEST": r1.MAX_NEST, "TINY_ATR": r1.TINY_ATR, "MIN_ATR_PCT": r1.MIN_ATR_PCT,
             "REJ_POS": r1.REJ_POS, "WICK_FRAC": r1.WICK_FRAC, "CTX_LB": lab.CTX_LB, "CTX_POS": lab.CTX_POS,
             "WIDE_RATIO": lab.WIDE_RATIO, "GAP_ATR": lab.GAP_ATR, "ID_DRAW_ROUND": lab.DRAW_ROUND}
    for k, v in pairs.items():
        assert getattr(ID, k) == v, k
    # the served wrapper's own constants (lab common_id) are the dashboard detector's
    assert lab.C.MAX_TRIGGER_AGE == ID.U.MAX_TRIGGER_AGE
    assert (lab.C.LIQ_MIN_PRICE, lab.C.LIQ_MIN_DV, lab.C.LIQ_LOOKBACK) == (
        ID.LQ.DEFAULT_MIN_PRICE, ID.LQ.DEFAULT_MIN_AVG_DOLLAR_VOLUME, ID.LQ.DEFAULT_LOOKBACK)


def test_every_judged_case_is_drawn_identically(lab, db):
    cases = _keys()
    assert len(cases) == 50
    for c in cases:
        rows = _rows(db, c["ticker"])
        k = bisect.bisect_right([r[0] for r in rows], int(c["ts"])) - 1
        assert rows[k][0] == c["ts"]
        cut = rows[max(0, k + 1 - _SLICE):k + 1]
        ld = lab.id_drawing(cut, len(cut) - 1)
        assert ld is not None
        dd = ID.inside_day_drawing(_dicts(cut), len(cut) - 1)
        assert _same(ld, dd, cut), (c["ticker"], c["ts"])
        full = ID.inside_day_drawing(_dicts(rows[:k + 1]), k)
        assert full is not None and (full["trigger"], full["stop"], full["start_t"], full["inside_t"]) == (
            dd["trigger"], dd["stop"], dd["start_t"], dd["inside_t"])
        # the key's recorded facts
        assert round(dd["ctx_pos"], 3) == c["ctx_pos"] and round(dd["inside_ratio"], 3) == c["inside_ratio"]
        assert dd["age"] == c["age"] and dd["variant"] == c["variant"]


def _sweep_rows(db):
    tickers = [t for (t,) in db.execute(
        "select distinct ticker from ohlcv where tf='D' and ts>=20240101 order by ticker")]
    rnd = random.Random("id_draw_v2|parity|20261019")
    out = []
    while len(out) < _HIST:
        tk = rnd.choice(tickers)
        rows = _rows(db, tk)
        if len(rows) < 400 or any(t == tk for t, _ in out):
            continue
        out.append((tk, rows))
    return out


@pytest.fixture(scope="module")
def sweep(lab, db):
    """[(rows_up_to_i, lab drawing, lab round-1 drawing)] over every swept session."""
    got = []
    for _tk, rows in _sweep_rows(db):
        for i in range(len(rows) - _SESSIONS, len(rows)):
            cut = rows[max(0, i + 1 - _SLICE):i + 1]
            j = len(cut) - 1
            got.append((cut, lab.id_drawing(cut, j), lab.R1.id_drawing(cut, j)))
    return got


def test_every_swept_session_draws_or_withholds_as_the_lab_does(sweep):
    drawn = withheld = candidates = 0
    for cut, ld, r1 in sweep:
        dd = ID.inside_day_drawing(_dicts(cut), len(cut) - 1)
        assert _same(ld, dd, cut), (cut[-1][0], ld, dd)
        drawn += ld is not None
        withheld += ld is None
        candidates += r1 is not None
    # the sweep must see drawings, the v2 withholds (round-1 drawings v2 refuses) and plain withholds
    assert drawn >= 10 and candidates - drawn >= 10 and withheld >= 1000, (drawn, candidates, withheld)


_MUTATIONS = (("CTX_POS", 0.6), ("CTX_POS", 0.95), ("CTX_LB", 20), ("WIDE_RATIO", 0.95), ("WIDE_RATIO", 0.4),
              ("GAP_ATR", 0.0), ("GAP_ATR", 0.4), ("TINY_ATR", 0.6), ("REJ_POS", 0.9), ("WICK_FRAC", 0.1),
              ("MIN_ATR_PCT", 0.04))


@pytest.mark.parametrize("name,value", _MUTATIONS)
def test_each_moved_constant_is_seen_by_the_sweep(sweep, monkeypatch, name, value):
    monkeypatch.setattr(ID, name, value)
    # every lab round-1 drawing is a candidate the v2 gates decide on: a moved gate shows there
    caught = any(not _same(ld, ID.inside_day_drawing(_dicts(cut), len(cut) - 1), cut)
                 for cut, ld, r1 in sweep if r1 is not None)
    assert caught, (name, value)


def test_the_drawing_reads_nothing_after_its_session(db, lab):
    rnd = random.Random(7)
    seen = drawn = 0
    for _tk, rows in _sweep_rows(db)[:12]:
        ks = list(range(260, len(rows)))
        rnd.shuffle(ks)
        # half the sessions are ones the lab round-1 rule draws, so the drawn branch is exercised
        hits = [k for k in ks[:200] if lab.R1.id_drawing(rows[max(0, k + 1 - _SLICE):k + 1],
                                                       min(k, _SLICE - 1)) is not None][:30]
        for k in hits + ks[:30]:
            b = _dicts(rows[max(0, k + 1 - _SLICE):k + 1])
            j = len(b) - 1
            c = b[-1]["c"]
            fut = b + [{"t": b[-1]["t"] + 1 + q, "o": c * 1.3, "h": c * 1.6, "l": c * 0.5, "c": c * 1.5,
                        "v": 1e9} for q in range(30)]
            a1, a2 = ID.inside_day_drawing(b, j), ID.inside_day_drawing(fut, j)
            assert json.dumps(a1, sort_keys=True) == json.dumps(a2, sort_keys=True)
            seen += 1
            drawn += a1 is not None
    assert seen >= 360 and drawn >= 1, (seen, drawn)
