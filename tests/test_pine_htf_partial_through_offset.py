"""HTF-PARTIAL-THROUGH-OFFSET (2026-11-19) in the Python lane's merge mask (``ast_interpret.py``).

The twin of ``app/src/components/chart/engine/ast/htfPartialThroughOffset.test.js``, over the fixture it writes
(``tests/fixtures/ast/htf_partial_through_offset.json``). Off the listing, a weekly / monthly merge whose first period
is partial withholds the bars that show that period's value (``request:htf-first-period-partial``); the mask was
applied at the ROOT's own positions, so ``x[1]`` drew the partial week's high (3.5) on bar 6 of the Wednesday-start
bars. Which root bars read a withheld merge bar is now engine 56's walk (``_first_period_partial_read_mask``):
``x[k]`` moves them k bars later; ``barsAgo`` reads the bar its count lands on and ``c ? a : b`` the arm its known
condition takes. For every case the Python lane must give the hand-written answer over the case's window AND the
chart's served column bar for bar: one lane moved and not the other is red here or in the JS file.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import ast_interpret

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "htf_partial_through_offset.json"
FIX = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = FIX["cases"]


def _bars(days):
    return [{"t": t, "o": i + 0.5, "h": i + 1.5, "l": i, "c": i + 1, "v": 100 + i} for i, t in enumerate(days)]


def _opts(case):
    """The fixture's chart (JS spelling) in the Python lane's: ``newestBarIsForming`` is ``newest_bar_is_forming``."""
    chart = dict(FIX["chart"], **case["opts"])
    opts = {k: v for k, v in chart.items() if k != "newestBarIsForming"}
    opts["newest_bar_is_forming"] = chart["newestBarIsForming"]
    return opts


def _column(case, sink=None):
    opts = _opts(case)
    if sink is not None:
        opts["chartClockSink"] = sink
    col = ast_interpret.interpret(case["tree"], _bars(FIX["days"][case["set"]]), {}, opts=opts)
    return [None if v is None or (isinstance(v, float) and math.isnan(v)) else v for v in col]


def _same(got, want, label):
    assert len(got) == len(want), label
    for j, (g, w) in enumerate(zip(got, want)):
        if w is None:
            assert g is None, f"{label} bar {j}: {g} where the answer is withheld"
        else:
            assert g is not None and g == pytest.approx(w, abs=1e-9), f"{label} bar {j}: {g} != {w}"


def test_the_fixture_is_not_vacuous():
    assert len(CASES) >= 15
    names = [c["name"] for c in CASES]
    assert any(n.startswith("x[1] (bars 3-6") for n in names)
    assert any(n.startswith("CONTROL") for n in names)
    for c in CASES:
        if "held" in c:
            assert all(0 <= j < c["window"][1] - c["window"][0] for j in c["held"]), c["name"]
        else:
            assert len(c["expect"]) == c["window"][1] - c["window"][0], c["name"]
        assert len(c["served"]) == len(FIX["days"][c["set"]]), c["name"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_python_lane_gives_the_hand_written_answer_and_the_charts_column(case):
    col = _column(case)
    lo, hi = case["window"]
    if "held" in case:
        # a running value: only which bars are blank or withheld is written by hand
        for j, v in enumerate(col[lo:hi]):
            assert (v is None) == (j in case["held"]), f"{case['name']} bar {j}: {v}"
    else:
        _same(col[lo:hi], case["expect"], case["name"])
    _same(col, case["served"], f"{case['name']} (the served column)")


def test_the_defect_by_name_x1_on_bar_6_is_withheld_never_the_partial_weeks_high():
    case = next(c for c in CASES if c["name"].startswith("x[1] (bars 3-6"))
    col = _column(case)
    assert col[6] is None
    assert col[7] == 7.5
    listing = next(c for c in CASES if c["name"].startswith("CONTROL x[1] from the listing"))
    assert _column(listing)[6] == 3.5         # the partial week's value, not a hole


def test_the_code_is_named_for_x1_as_for_x_and_not_on_the_monday_control():
    def named(name):
        sink: dict = {}
        _column(next(c for c in CASES if c["name"].startswith(name)), sink)
        return sink
    code = ast_interpret.TF_MERGE_FIRST_CODE
    assert code in named("x[1] (bars 3-6")
    assert code in named("x (a direct read")
    assert code not in named("CONTROL x[1] on the Monday set")
