"""ITEM 4 (coordinator rulings 2026-11-19) in the Python lane (``ast_interpret._walk_two_starts``).

The twin of ``app/src/components/chart/engine/ast/htfTwoStarts.test.js``, over the fixture it writes
(``tests/fixtures/ast/htf_two_starts.json``). A running value (``ema``, ``rma``, ``cum``, a recurrence) that carries a
partial first period, or a read before the chart, is drawn only where two starts agree: A as built, B with each such
running value started later (its argument NaN on the bars the walk found unknown, each site NaN on its own), bit-equal,
NaN equal to NaN; over the recurrence ceiling (``two_start_steps`` > ``TWO_START_CEILING``) B is not run and the running
value is withheld from its first unknown bar on. The JS rail holds the acceptance measure (every bar drawn equals the
longer chart's); here the Python lane must equal the JS lane's column bar for bar, both with two starts and over the bound.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import ast_interpret

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "htf_two_starts.json"
FIX = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = FIX["cases"]


def _opts():
    chart = dict(FIX["chart"])
    opts = {k: v for k, v in chart.items() if k != "newestBarIsForming"}
    opts["newest_bar_is_forming"] = chart["newestBarIsForming"]
    return opts


def _column(case):
    col = ast_interpret.interpret(case["tree"], FIX["bars"], {}, opts=_opts())
    return [None if v is None or (isinstance(v, float) and math.isnan(v)) else v for v in col]


def _same(got, want, label):
    assert len(got) == len(want), label
    for j, (g, w) in enumerate(zip(got, want)):
        if w is None:
            assert g is None, f"{label} bar {j}: {g} where the answer is withheld"
        else:
            assert g is not None and g == pytest.approx(w, rel=1e-9, abs=1e-9), f"{label} bar {j}: {g} != {w}"


def test_the_fixture_is_not_vacuous():
    assert len(CASES) >= 12
    assert sum(c["name"].startswith("KEPT") for c in CASES) >= 3
    for c in CASES:
        assert len(c["served"]) == len(FIX["bars"]) == len(c["bound"]), c["name"]
    # the two starts withhold less than the bound on the running cases, and something is drawn
    running = [c for c in CASES if not c["name"].startswith(("KEPT", "cum("))]
    assert running and all(any(v is not None for v in c["served"]) for c in running)
    assert all(all(v is None for v in c["bound"]) for c in running)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_python_lane_gives_the_js_lanes_column_with_two_starts(case):
    _same(_column(case), case["served"], case["name"])


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_over_the_bound_the_python_lane_withholds_as_the_js_lane_does(case):
    was = ast_interpret.TWO_START_CEILING[0]
    ast_interpret.TWO_START_CEILING[0] = 1
    try:
        got = _column(case)
    finally:
        ast_interpret.TWO_START_CEILING[0] = was
    _same(got, case["bound"], f"{case['name']} (bound)")


def test_the_bound_is_the_recurrence_ceiling():
    assert ast_interpret.TWO_START_CEILING[0] == ast_interpret.MAX_RECURRENCE_STEPS
    ema_merge = {"type": "call", "name": "ema", "args": [
        {"type": "tf_merge", "value": "W", "args": [{"type": "series", "name": "high"}]}, {"type": "num", "value": 3}]}
    assert ast_interpret.two_start_steps(ema_merge, 10) == 4 * 10
