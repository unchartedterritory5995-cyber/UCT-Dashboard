"""PERIOD -1 (coordinator ruling 2026-11-19) in the Python lane (``ast_interpret.history_before_chart_mask``).

The twin of ``app/src/components/chart/engine/ast/historyBeforeChart.test.js``, over the fixture it writes
(``tests/fixtures/ast/history_before_chart.json``). On a chart whose history does not begin at the symbol's listing,
``x[1]`` on bar 0 (and a ``tf_merge`` bar before the first period's close, ``tf_live('W', x[1])`` on the first week)
reads a bar this chart does not hold; the evaluator answers ``NaN``, which downstream is Pine's ``na``, where
TradingView holds the bar and reads a value. In a Pine document, off the listing, the root bars that draw from such a
read are now withheld, named ``history:before-chart`` where a value is taken away; from the listing, and in a formula
document, nothing changes; another symbol's series is never the chart's listing (C26). For every case the Python lane
must give the hand-written answer over the case's window, the JS lane's column bar for bar, and name the code exactly
where the JS lane named it.

⭐ FINDING 3 (the same ruling): this lane's ``sym`` arm kept the CHART's ``historyFromListing`` for the other symbol, where
the chart lane clears it (``interpret.js``'s ``sym`` arm, C26). The ``FINDING-3`` cases are its twin rail: from the
chart's listing, ``sym('SPY', barindex)`` is withheld in both lanes (SPY's count is not known), while the chart's own
``barindex`` draws.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import ast_interpret

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "history_before_chart.json"
FIX = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = FIX["cases"]


def _bars(days):
    return [{"t": t, "o": i + 0.5, "h": i + 1.5, "l": i, "c": i + 1, "v": 100 + i} for i, t in enumerate(days)]


def _opts(case):
    """The fixture's chart and the case's lane facts (JS spelling) in the Python lane's: ``newestBarIsForming`` is
    ``newest_bar_is_forming``."""
    chart = dict(FIX["chart"], **case["opts"])
    opts = {k: v for k, v in chart.items() if k != "newestBarIsForming"}
    opts["newest_bar_is_forming"] = chart["newestBarIsForming"]
    if case.get("symbols"):
        opts["symbols"] = {"SPY": _bars(FIX["days"][case["set"]])}
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


def _case(prefix):
    return next(c for c in CASES if c["name"].startswith(prefix))


def test_the_fixture_is_not_vacuous():
    assert len(CASES) >= 20
    names = [c["name"] for c in CASES]
    assert sum(n.startswith("KEPT") for n in names) >= 4
    assert sum(n.startswith("CONTROL") for n in names) >= 5
    assert sum(n.startswith("FINDING-3") for n in names) >= 2
    assert sum(c["named"] for c in CASES) >= 4
    for c in CASES:
        if "held" in c:
            assert all(0 <= j < c["window"][1] - c["window"][0] for j in c["held"]), c["name"]
        else:
            assert len(c["expect"]) == c["window"][1] - c["window"][0], c["name"]
        assert len(c["served"]) == len(FIX["days"][c["set"]]), c["name"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_python_lane_gives_the_hand_written_answer_the_js_column_and_the_same_name(case):
    sink: dict = {}
    col = _column(case, sink)
    lo, hi = case["window"]
    if "held" in case:
        # a running value: only which bars are blank or withheld is written by hand
        for j, v in enumerate(col[lo:hi]):
            assert (v is None) == (j in case["held"]), f"{case['name']} bar {j}: {v}"
    else:
        _same(col[lo:hi], case["expect"], case["name"])
    _same(col, case["served"], f"{case['name']} (the JS lane's column)")
    assert (ast_interpret.HISTORY_BEFORE_CHART_CODE in sink) == case["named"], case["name"]


def test_the_defect_by_name():
    assert _column(_case("nz(close[1]) (bar 0"))[0] is None                 # never 0
    assert _column(_case("CONTROL nz(close[1]) from the listing"))[0] == 0
    cpr = _column(_case("the cpr daily colour"))
    assert cpr[:3] == [None, None, 0]                                       # never the colour index 1 on bars 0-1
    assert _column(_case("CONTROL the cpr daily colour from the listing"))[:2] == [1, 1]
    assert _column(_case("nz(tf_merge(W, close)) (bars 0-1"))[:3] == [None, None, 3]


def test_the_code_is_one_of_the_chart_clock_codes():
    assert ast_interpret.HISTORY_BEFORE_CHART_CODE == "history:before-chart"
    assert ast_interpret.HISTORY_BEFORE_CHART_CODE in ast_interpret.CHART_CLOCK_WITHHELD_CODES


def test_finding_3_the_sym_arm_clears_the_charts_listing_for_the_other_symbol():
    # from the chart's listing the chart's own count is TradingView's, and SPY's is not (C26): the chart lane's answer
    assert _column(_case("FINDING-3 CONTROL barindex from the chart's listing"))[:3] == [0, 1, 2]
    assert all(v is None for v in _column(_case("FINDING-3 sym('SPY', barindex) from the chart's listing")))
