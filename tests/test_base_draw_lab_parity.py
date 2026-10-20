"""PARITY: the member base drawing (pattern_engine.base_draw) against the lab rule itself.

lab base_draw/rule_bd.py is the code whose drawings passed the pre-registered checks (held-out team
axis; blind packets A 2.70 [2.47, 2.90] and B 2.80 [2.60, 2.97]). This file imports that code BY
PATH, runs it beside the dashboard code on the SAME real bars, and requires the same answer. The lab
and C:/data/bars.db live outside this repo, so the file SKIPS when either is absent (a lab that
cannot import is "absent", never a pass). bars.db is opened mode=ro.

  * lab path: env `UCT_LAB_BASE_DRAW` ONLY (no default); the file skips when it is unset

Levels:
  CONSTANTS every frozen lab PARAM equals the dashboard constant of the same name.
  JUDGED    every one of the 30 blind-judged cases (out/key_A.json, out/key_B.json, read at test
            time, never typed here): the lab draws it, and the dashboard draws the SAME pivot, lip,
            low and length, on the full history AND on the 600-bar slice the structures route reads,
            and reproduces the key's recorded facts.
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

from api.services.pattern_engine import base_draw as BD

_LAB_DIR = os.environ.get("UCT_LAB_BASE_DRAW") or ""
_BARS_DB = "C:/data/bars.db"
_SLICE = 600                 # auto_structures.STRUCTURE_BARS: what the route hands the drawing
_HIST = 24                   # random histories swept session by session
_SESSIONS = 260              # trailing sessions per history


def _lab():
    if not _LAB_DIR:
        pytest.skip("UCT_LAB_BASE_DRAW unset")
    p = os.path.join(_LAB_DIR, "rule_bd.py")
    if not (os.path.exists(p) and os.path.exists(_BARS_DB)):
        pytest.skip("lab base_draw or bars.db absent")
    spec = importlib.util.spec_from_file_location("lab_rule_bd_ro", p)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"lab rule_bd does not import: {e}")
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
    return (lab_d["pivot"] == dash_d["pivot"] and int(rows[lab_d["lip"]][0]) == dash_d["start_t"]
            and lab_d["low"] == dash_d["low"] and int(rows[lab_d["low_i"]][0]) == dash_d["low_t"]
            and lab_d["len"] == dash_d["bars"] and int(rows[lab_d["i"]][0]) == dash_d["end_t"])


def _keys():
    out = []
    for pk in ("A", "B"):
        p = os.path.join(_LAB_DIR, "out", f"key_{pk}.json")
        if not os.path.exists(p):
            pytest.skip(f"lab key {pk} absent")
        out += list(json.load(open(p, encoding="utf-8"))["cases"].values())
    return out


def test_every_lab_param_is_the_dashboard_constant(lab):
    names = {k: v for k, v in lab.PARAMS.items() if k != "SELECT"}
    assert lab.PARAMS["SELECT"] == "nearest"
    assert len(names) >= 20
    for k, v in names.items():
        assert getattr(BD, k) == v, k


def test_every_judged_case_is_drawn_identically(lab, db):
    cases = _keys()
    assert len(cases) == 30
    for c in cases:
        rows = _rows(db, c["ticker"])
        k = bisect.bisect_right([r[0] for r in rows], int(c["ts"])) - 1
        assert rows[k][0] == c["ts"]
        full = rows[:k + 1]
        ld = lab.base_drawing(full, k)
        assert ld is not None
        for cut in (full, full[-_SLICE:]):
            dd = BD.base_drawing(_dicts(cut), len(cut) - 1)
            assert _same(lab.base_drawing(cut, len(cut) - 1), dd, cut)
            assert dd["pivot"] == ld["pivot"] and dd["low"] == ld["low"] and dd["bars"] == ld["len"]
        # the key's recorded facts
        assert ld["len"] == c["len"] and round(ld["depth"], 4) == c["depth"]
        assert round(ld["close_minus_pivot_atr"], 3) == c["close_minus_pivot_atr"]


def _sweep_rows(db):
    tickers = [t for (t,) in db.execute(
        "select distinct ticker from ohlcv where tf='D' and ts>=20240101 order by ticker")]
    rnd = random.Random("base_draw|parity|20261018")
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
    """[(rows_up_to_i, i, lab drawing)] over every swept session."""
    got = []
    for _tk, rows in _sweep_rows(db):
        for i in range(len(rows) - _SESSIONS, len(rows)):
            cut = rows[max(0, i + 1 - _SLICE):i + 1]
            got.append((cut, lab.base_drawing(cut, len(cut) - 1)))
    return got


def test_every_swept_session_draws_or_withholds_as_the_lab_does(sweep):
    drawn = withheld = 0
    for cut, ld in sweep:
        dd = BD.base_drawing(_dicts(cut), len(cut) - 1)
        assert _same(ld, dd, cut), (cut[-1][0], ld, dd)
        drawn += ld is not None
        withheld += ld is None
    assert drawn >= 50 and withheld >= 1000, (drawn, withheld)


_MUTATIONS = (("MIN_LEN", 40), ("NEAR_BELOW", 0.5), ("MAX_EXT", 0.2), ("PRIOR_BARS", 40),
              ("MIN_TOUCH_SEP", 40), ("MIN_DEPTH_ATR", 4.0), ("MAX_DEPTH_ATR", 4.0),
              ("PEAK_ATR", 0.1), ("RIGHT_ATR", 0.2), ("CLUSTER", 1.0), ("BODY_TOL", 0.0),
              ("TOUCH", 0.1), ("MAX_DEPTH", 0.1), ("LOOK", 60), ("MIN_ADV", 0.3))


@pytest.mark.parametrize("name,value", _MUTATIONS)
def test_each_moved_constant_is_seen_by_the_sweep(sweep, monkeypatch, name, value):
    monkeypatch.setattr(BD, name, value)
    caught = any(not _same(ld, BD.base_drawing(_dicts(cut), len(cut) - 1), cut)
                 for cut, ld in sweep if ld is not None)
    assert caught, name


def test_the_drawing_reads_nothing_after_its_session(db):
    rnd = random.Random(7)
    seen = drawn = 0
    for _tk, rows in _sweep_rows(db)[:12]:
        for _ in range(60):
            k = rnd.randrange(260, len(rows))
            b = _dicts(rows[:k + 1])
            c = b[-1]["c"]
            fut = b + [{"t": b[-1]["t"] + 1 + j, "o": c * 1.3, "h": c * 1.6, "l": c * 0.5, "c": c * 1.5,
                        "v": 1e9} for j in range(30)]
            a1, a2 = BD.base_drawing(b, k), BD.base_drawing(fut, k)
            assert json.dumps(a1, sort_keys=True) == json.dumps(a2, sort_keys=True)
            seen += 1
            drawn += a1 is not None
    assert seen == 720 and drawn >= 1
