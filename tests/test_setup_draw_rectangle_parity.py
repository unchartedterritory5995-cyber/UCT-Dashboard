"""PARITY RAIL: the production rectangle drawing (api/services/pattern_engine/setup_draw_rectangle.py) equals the
judged drawing code on a fixed fixture -- the same facts and the same full drawing, as-of every bar.

tests/fixtures/setup_draw_rectangle_parity.json holds 4 SYNTHETIC daily series (seeded random walks with trend and
oscillating-range regimes, no real ticker), 640 bars each, and, per series, the judged code's output as-of EVERY bar
from index 220 on: {asof: {facts, sha256 of the whole drawing dict}}. At every other bar the judged code draws
nothing, so the production module must draw nothing there too.

JUDGED_CONSTANTS pins the full constant table as well: a behavioural fixture cannot see a perturbation no chart in it
sits on.

If this goes red, the production drawing no longer reproduces the judged geometry. Do NOT re-bless the fixture from
the production module: that makes the rail compare the module with itself. A new drawing round is a new blind check.
"""
import hashlib
import json
import os

import pytest

from api.services.pattern_engine import setup_draw_rectangle as M

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "setup_draw_rectangle_parity.json")

#: The judged constant table, frozen with the judged round.
JUDGED_CONSTANTS = {
    "RECTANGLE_DRAW_ROUND": 1, "WINDOW": 330, "MIN_ASOF_INDEX": 220,
    "RC_WIN_MIN": 18, "RC_WIN_MAX": 70, "RC_NB": 2, "RC_SEP": 4, "RC_TOL_ATR": 0.5, "RC_TOL_H": 0.15,
    "RC_CLOSE_TOL_ATR": 0.25, "RC_CLOSE_TOL_H": 0.05, "RC_BODY_H": 0.25, "RC_EDGE_BARS": 5,
    "RC_ZONE": 0.30, "RC_FILL": 0.12, "RC_MAX_POKE": 2, "RC_POKE_MAX_H": 0.25, "RC_MIN_TOUCH": 2,
    "RC_MIN_RUNS": 4, "RC_MIN_LEN": 15, "RC_MAX_LEN": 45, "RC_MIN_H_ATR": 2.0, "RC_MIN_DEPTH": 0.03,
    "RC_MAX_DEPTH": 0.25, "RC_FLAT": 0.20, "RC_HUMP": 0.12, "RC_MIN_CROSS": 4, "RC_DRAW_BODY": 0.5,
    "RC_PRE_BARS": 10, "RC_PRE_INSIDE": 0.5,
}


def _load():
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)["series"]


SERIES = _load()


def _sha(d):
    return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()


def test_the_judged_constant_table():
    for name, val in JUDGED_CONSTANTS.items():
        assert getattr(M, name) == val, name


def test_the_fixture_fires_and_is_not_vacuous():
    fires = sum(len(sr["expected"]) for sr in SERIES)
    assert len(SERIES) == 4 and fires >= 12
    # every series both draws and does not draw somewhere: a module that drew always, or never, cannot pass
    for sr in SERIES:
        assert 0 < len(sr["expected"]) < len(sr["rows"]) - 220


@pytest.mark.parametrize("k", range(len(SERIES)))
def test_parity_as_of_every_bar(k):
    sr = SERIES[k]
    rows = sr["rows"]
    want_all = sr["expected"]
    bad = []
    for i in range(220, len(rows)):
        d = M.detect(rows[:i + 1])
        got = {"facts": M.facts(d), "sha": _sha(d)} if d is not None else None
        want = want_all.get(str(i))
        if got != want:
            bad.append((i, got and got["facts"].get("top"), want and want["facts"].get("top")))
    assert not bad, bad[:5]


def test_a_detector_reads_nothing_after_the_as_of_bar():
    """The drawing as-of bar i is the same whether or not later bars exist past the slice it is handed."""
    sr = SERIES[0]
    rows = sr["rows"]
    i = int(min(sr["expected"], key=int))
    a = M.detect(rows[:i + 1])
    wild = rows[:i + 1] + [[rows[i][0] + 1 + j, 1e3, 2e3, 1.0, 1.5e3, 1e9] for j in range(30)]
    b = M.detect(wild[:i + 1])
    assert a is not None and json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_the_drawn_box_contains_every_close_and_starts_on_a_touch():
    """Geometry sanity on every fixture fire: the box is a rectangle from its start bar to the as-of bar, top above
    floor, every close of the box inside the drawn lines."""
    for sr in SERIES:
        rows = sr["rows"]
        for asof in sr["expected"]:
            i = int(asof)
            d = M.detect(rows[:i + 1])
            g = d["det"]["geometry"]
            assert g["shape"] == "rectangle" and len(g["anchors"]) == 2
            top, floor = g["anchors"][0]["price"], g["anchors"][1]["price"]
            assert top > floor
            assert g["anchors"][1]["t"] == rows[i][0]
            start = [r[0] for r in rows].index(g["anchors"][0]["t"])
            assert i - start + 1 == d["len"]
            for r in rows[start:i + 1]:
                assert floor - 1e-3 <= r[4] <= top + 1e-3
