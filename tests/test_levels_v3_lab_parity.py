"""Levels v3 lab parity -- skips unless the lab studies and the local bars database are present.

The vendored fixture (tests/test_levels_v3.py) proves parity on 28 cases. This rail proves it on EVERY chart the
v3 studies drew: all 884 strict team charts (lab/drawn_vs_team, DEV and held-out halves), all 301 fresh recovered
team charts the primary scored (lab/drawn_vs_team_recovered, overlap with the strict set excluded), the 20 packet-J
charts and the 30 confirmation charts -- each with its own bars only -- and that the two verbatim blocks are
byte-identical to the lab's source files.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import pickle
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pytest

from api.services import auto_draw, levels_v3

#: The lab root, from env UCT_LAB_DIR ONLY (no default): unset => every test here skips.
_LAB_ENV = os.environ.get("UCT_LAB_DIR") or ""
LAB = Path(_LAB_ENV) if _LAB_ENV else Path("__uct_lab_dir_unset__")
LV2 = LAB / "levels_v2"
LV3 = LAB / "levels_v3"
STRICT = LAB / "drawn_vs_team" / "out" / "charts.pkl"
RECOVERED = LAB / "drawn_vs_team_recovered" / "out" / "charts_rec.pkl"
KEY_J = LV3 / "out" / "key_J.json"
KEY_CONFIRM = LAB / "levels_v3_confirm" / "out" / "key.json"
BARS_DB = Path(os.environ.get("UCT_LAB_BARS_DB", r"C:\data\bars.db"))

pytestmark = pytest.mark.skipif(
    not (_LAB_ENV and LV3.is_dir() and STRICT.is_file() and RECOVERED.is_file() and KEY_J.is_file() and KEY_CONFIRM.is_file()
         and BARS_DB.is_file()),
    reason="UCT_LAB_DIR unset, or lab/levels_v3, its keys or bars.db not present")


def _lab_block(path, start, end=None):
    s = path.read_text(encoding="utf-8")
    b = s.index(start) + (len(start) if start.endswith("\n") else 0)
    e = s.index(end) if end else len(s)
    return s[b:e]


def test_the_verbatim_blocks_are_the_lab_source():
    core = _lab_block(LV3 / "v3core.py", "import numpy as np\n").lstrip("\n")
    drw = _lab_block(LV3 / "drawer_v3.py", "def label(",
                     "# ------------------------------------------------------------------------------- lab plug-in")
    drw = drw.rstrip("\n") + "\n"
    assert hashlib.sha256(core.encode("utf-8")).hexdigest() == levels_v3.CORE_BLOCK_SHA256
    assert hashlib.sha256(drw.encode("utf-8")).hexdigest() == levels_v3.DRAWER_BLOCK_SHA256


@pytest.fixture(scope="module")
def lab():
    for p in (str(LV2), str(LV3)):
        sys.path.insert(0, p)
    try:
        sp = importlib.util.spec_from_file_location("lab_drawer_v3", LV3 / "drawer_v3.py")
        m = importlib.util.module_from_spec(sp)
        sp.loader.exec_module(m)
        return m
    finally:
        for p in (str(LV2), str(LV3)):
            sys.path.remove(p)


@pytest.fixture(scope="module")
def db():
    c = sqlite3.connect("file:%s?mode=ro" % BARS_DB.as_posix(), uri=True)
    yield c
    c.close()


def _mismatches(lab, db, keys, since):
    cache, bad = {}, []
    for tk, asof in keys:
        if tk not in cache:
            rows = db.execute("select ts,o,h,l,c,v from ohlcv where ticker=? and tf='D' and ts>=? order by ts",
                              (tk, since)).fetchall()
            cache[tk] = auto_draw.clean_bars(rows)
        bars = [b for b in cache[tk] if int(b[0]) <= asof]           # the chart's own bars only
        a = np.array([[float(x) for x in r] for r in bars])
        want = [(round(h["price"], 4), int(a[h["j"], 0]), h["label"]) for h in lab.draw_levels(a, len(a) - 1)]
        got = [(h["price"], h["t_from"], h["label"]) for h in levels_v3.drawn_levels(bars)["horizontals"]]
        if got != want:
            bad.append((tk, asof))
    return bad


def test_every_strict_team_chart_DEV_and_heldout_draws_the_lab_levels(lab, db):
    keys = [(c["ticker"], int(c["asof"])) for c in pickle.load(open(STRICT, "rb"))]
    assert len(keys) >= 800
    assert _mismatches(lab, db, keys, 20210101) == []


def test_every_fresh_recovered_chart_draws_the_lab_levels(lab, db):
    strict = {(c["ticker"], int(c["asof"])) for c in pickle.load(open(STRICT, "rb"))}
    keys = [(c["ticker"], int(c["asof"])) for c in pickle.load(open(RECOVERED, "rb"))
            if not c.get("skip") and (c["ticker"], int(c["asof"])) not in strict]
    assert len(keys) >= 290
    assert _mismatches(lab, db, keys, 20210101) == []


def test_every_judged_chart_J_and_confirmation_draws_the_lab_levels(lab, db):
    keys = set()
    for p in (KEY_J, KEY_CONFIRM):
        for c in json.load(open(p, encoding="utf-8"))["cases"].values():
            keys.add((c["symbol"], int(c["last_session"])))
    assert len(keys) >= 50
    # the judge packets drew from full history (no since-2021 cut)
    assert _mismatches(lab, db, sorted(keys), 0) == []
