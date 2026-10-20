"""Levels v2 lab parity -- skips unless the lab study and the local bars database are present.

The vendored fixture (tests/test_levels_v2.py) proves parity on 24 cases. This rail proves it on EVERY chart the lab
study scored (the 884 team charts of lab/drawn_vs_team), on full history and with each chart's own bars only, and
that the two verbatim blocks are byte-identical to the lab's source files.
"""
from __future__ import annotations

import hashlib
import importlib.util
import os
import pickle
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pytest

from api.services import levels_v2

#: The lab root, from env UCT_LAB_DIR ONLY (no default): unset => every test here skips.
_LAB_ENV = os.environ.get("UCT_LAB_DIR") or ""
LAB = Path(_LAB_ENV) if _LAB_ENV else Path("__uct_lab_dir_unset__")
LV2 = LAB / "levels_v2"
CHARTS = LAB / "drawn_vs_team" / "out" / "charts.pkl"
BARS_DB = Path(os.environ.get("UCT_LAB_BARS_DB", r"C:\data\bars.db"))

pytestmark = pytest.mark.skipif(not (_LAB_ENV and LV2.is_dir() and CHARTS.is_file() and BARS_DB.is_file()),
                                reason="UCT_LAB_DIR unset, or lab/levels_v2 or bars.db not present")


def _lab_block(path, start, end=None):
    s = path.read_text(encoding="utf-8")
    b = s.index(start) + (len(start) if start.endswith("\n") else 0)
    e = s.index(end) if end else len(s)
    return s[b:e]


def test_the_verbatim_blocks_are_the_lab_source():
    core = _lab_block(LV2 / "lv2core.py", "import numpy as np\n").lstrip("\n")
    drw = _lab_block(LV2 / "drawer_v2.py", "LABELS = ",
                     "# ------------------------------------------------------------------------------- lab plug-in")
    drw = drw.rstrip("\n") + "\n"
    assert hashlib.sha256(core.encode("utf-8")).hexdigest() == levels_v2.CORE_BLOCK_SHA256
    assert hashlib.sha256(drw.encode("utf-8")).hexdigest() == levels_v2.DRAWER_BLOCK_SHA256


def _load_lab_drawer():
    sys.path.insert(0, str(LV2))
    try:
        sp = importlib.util.spec_from_file_location("lab_drawer_v2", LV2 / "drawer_v2.py")
        m = importlib.util.module_from_spec(sp)
        sp.loader.exec_module(m)
        return m
    finally:
        sys.path.remove(str(LV2))


def test_every_team_chart_draws_the_same_levels_as_the_lab():
    lab = _load_lab_drawer()
    charts = pickle.load(open(CHARTS, "rb"))
    db = sqlite3.connect("file:%s?mode=ro" % BARS_DB.as_posix(), uri=True)
    cache, bad, n = {}, [], 0
    for ch in charts:
        tk = ch["ticker"]
        if tk not in cache:
            rows = db.execute("select ts,o,h,l,c,v from ohlcv where ticker=? and tf='D' and ts>=20210101 "
                              "order by ts", (tk,)).fetchall()
            cache[tk] = levels_v2_clean(rows)
        bars = [b for b in cache[tk] if int(b[0]) <= ch["asof"]]   # the chart's own bars only
        a = np.array([[float(x) for x in r] for r in bars])
        want = [(round(h["price"], 4), int(a[h["j"], 0]), h["label"]) for h in lab.draw_levels(a, len(a) - 1)]
        got = [(h["price"], h["t_from"], h["label"]) for h in levels_v2.drawn_levels(bars)["horizontals"]]
        n += 1
        if got != want:
            bad.append((tk, ch["asof"]))
    assert n >= 800
    assert bad == []


def levels_v2_clean(rows):
    from api.services import auto_draw
    return auto_draw.clean_bars(rows)
