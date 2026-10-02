"""C45 -- ``bar_index`` off the listing, in the Python lane, held to the JS lane's
own output.

Pine's ``bar_index`` counts from the first bar of the symbol's history; this
engine's ``barindex`` counts from the first bar it was handed. Off the listing
they differ by an unknown ``D >= 0``. ``ast/barIndexShift.js`` proves from the tree
alone how a value moves with ``D`` and ``interpret.js::barIndexMask`` withholds
what depends on it; ``ast_interpret.bar_index_verdict`` / ``bar_index_mask`` are
the ports.

A member pane saves ONE document, and the server evaluates its trees too (a
user-series alert, the scan sweep, the screen backtest) on bars that never start
at a listing the server can prove. So a Pine document's ``bar_index % 3`` or
``bar_index > 100`` read there is not TradingView's either -- and the two doors
that admit such a tree (``scan_definition.assert_scannable``,
``alert_user_series``) refuse it by name (``tests/test_c45_withheld_doors.py``).

THE FIXTURE IS THE ONE AUTHORITY. ``barIndexShift.test.js`` writes and reads the
same file, so a lane that drifts fails against the OTHER LANE'S OWN OUTPUT rather
than against a value retyped here.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import ast_interpret as ai

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "bar_index_shift_parity.json"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _run(case: dict, doc: dict):
    sink: dict = {}
    opts = dict(case.get("opts") or {}, chartClockSink=sink)
    return ai.interpret(case["ast"], doc["bars"], {}, opts=opts), sorted(sink)


@pytest.mark.parametrize("case", _doc()["cases"], ids=lambda c: c["name"])
def test_the_python_lane_reproduces_the_js_lane(case):
    doc = _doc()
    verdict = ai.bar_index_verdict(case["ast"])
    assert verdict["cls"] == case["cls"], case["name"]
    assert len(verdict["thresholds"]) == case["thresholds"], case["name"]
    got, codes = _run(case, doc)
    expected = case["expected"]
    assert len(got) == len(expected)
    for i, (a, b) in enumerate(zip(got, expected)):
        if b is None:
            assert a is None, f"{case['name']} bar {i}: this lane produced {a} where the other withheld"
            continue
        assert a is not None, f"{case['name']} bar {i}: this lane produced nothing where the other produced {b}"
        assert abs(a - b) <= 1e-9 * max(1.0, abs(b)), f"{case['name']} bar {i}: {a} vs {b}"
    assert codes == case["codes"], case["name"]


def test_the_fixture_is_not_vacuous():
    doc = _doc()
    cases = {c["name"]: c for c in doc["cases"]}
    n = len(doc["bars"])
    assert n == 320
    classes = {c["cls"] for c in doc["cases"]}
    assert classes == {"inv", "pos", "dep"}
    # an index is withheld on every bar off the listing, by name
    index = cases["index · off the listing"]
    assert index["cls"] == "pos" and index["expected"] == [None] * n
    assert index["codes"] == ["bar-index:window"]
    # a distance between bars is served, and is the right number
    dist = cases["index - index[5] · off the listing"]
    assert dist["cls"] == "inv" and dist["codes"] == [] and dist["expected"][5:] == [5] * (n - 5)
    # a threshold is withheld on the early bars only
    gt = cases["index > 50 · off the listing"]
    assert gt["thresholds"] == 1 and gt["codes"] == ["bar-index:early-bars"]
    assert gt["expected"][:51] == [None] * 51 and all(v is not None for v in gt["expected"][51:])
    # from the listing nothing is withheld for the index
    listed = cases["index % 3 · from the listing"]
    assert listed["expected"] == [i % 3 for i in range(n)] and listed["codes"] == []
    # the formula language's own `barindex` is untouched
    own = cases["index · the formula language's own barindex"]
    assert own["expected"] == list(range(n)) and own["codes"] == []


def test_the_mask_is_asked_only_of_a_document_that_means_pines_index_and_only_off_the_listing():
    doc = _doc()
    tree = next(c for c in doc["cases"] if c["name"] == "index % 3 · off the listing")["ast"]
    bars = doc["bars"]
    assert ai.bar_index_mask(tree, bars, {}, opts={"tf": "D"}) is None
    assert ai.bar_index_mask(tree, bars, {}, opts={"tf": "D", "barIndexAbsolute": True,
                                                   "historyFromListing": True}) is None
    assert ai.bar_index_mask(tree, bars, {}, opts={"tf": "D", "barIndexAbsolute": True}) == [1] * len(bars)


def test_a_threshold_is_unknown_exactly_where_a_larger_d_could_change_the_answer():
    assert [ai.threshold_unknown(">", 1, g) for g in (-1, 0, 1)] == [True, True, False]
    assert [ai.threshold_unknown(">=", 1, g) for g in (-1, 0, 1)] == [True, False, False]
    assert [ai.threshold_unknown("<", 1, g) for g in (-1, 0, 1)] == [True, False, False]
    assert [ai.threshold_unknown("<=", 1, g) for g in (-1, 0, 1)] == [True, True, False]
    assert [ai.threshold_unknown(">", -1, g) for g in (-1, 0, 1)] == [False, False, True]
    assert [ai.threshold_unknown("<", -1, g) for g in (-1, 0, 1)] == [False, True, True]
    for op in (">", ">=", "<", "<="):
        assert ai.threshold_unknown(op, 1, math.nan) is False


def test_the_whole_series_code_is_declared_whole_in_both_lanes():
    assert "bar-index:window" in ai.CHART_CLOCK_WHOLE
    assert "bar-index:early-bars" in ai.CHART_CLOCK_WITHHELD_CODES
    assert "bar-index:early-bars" not in ai.CHART_CLOCK_WHOLE
