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
    return ai.interpret(case["ast"], doc["bars"], case.get("inputs") or {}, opts=opts), sorted(sink)


@pytest.mark.parametrize("case", _doc()["cases"], ids=lambda c: c["name"])
def test_the_python_lane_reproduces_the_js_lane(case):
    if case.get("jsOnly"):
        # a `var` from the listing is the JS listing pass (C12w); no server lane holds a listing
        pytest.skip("JS-only: the listing pass")
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


def test_a_var_read_on_other_bars_is_withheld_whole():
    """r1 (review VAR-OFF N3, V2) -- ``interpret.js::varOriginMask``'s rule, this lane: a
    recurrence under ``sym`` / ``tf`` reads other bars, and no window here describes them."""
    doc = _doc()
    cases = {c["name"]: c for c in doc["cases"]}
    acc = cases["var set on a frequent bar \u00b7 var origin \u00b7 off the listing"]["ast"]
    opts = {"tf": "D", "barIndexAbsolute": True, "varOriginAbsolute": True}
    for kind, value in (("sym", "QQQ"), ("tf", "W")):
        sink: dict = {}
        mask = ai.var_origin_mask({"type": kind, "value": value, "args": [acc]}, doc["bars"], {},
                                  opts=dict(opts, chartClockSink=sink))
        assert mask == [1] * len(doc["bars"]), kind
        assert sorted(sink) == ["var-origin:window"], kind


@pytest.mark.parametrize("case", _doc()["rally"]["cases"], ids=lambda c: c["name"])
def test_the_python_lane_reproduces_the_rally_window(case):
    """r1 (review VAR-OFF N1/N2) -- the reviewer's oracle shape: a rally to 200, then a
    95-105 range; the last 600 bars off the listing. The JS lane withholds every bar whose
    `var` may still hold what the rally set; this lane must answer the same."""
    rally = _doc()["rally"]
    sink: dict = {}
    got = ai.interpret(case["ast"], rally["bars"][rally["from"]:], {}, opts=dict(rally["opts"], chartClockSink=sink))
    for i, (a, b) in enumerate(zip(got, case["expected"])):
        if b is None:
            assert a is None, f"{case['name']} bar {i}: {a} where the other lane withheld"
        else:
            assert a is not None and abs(a - b) <= 1e-9 * max(1.0, abs(b)), f"{case['name']} bar {i}: {a} vs {b}"
    assert sorted(sink) == case["codes"], case["name"]


def test_an_arm_an_input_switches_off_is_no_path():
    """r2 (review VAR-OFF N-b) -- ``interpret.js::prunedUpdate``, this lane: keltner's
    ``trend`` compares with ``jz ? dn[1] : na`` and ``jz`` is an input that is off, so the
    direction never flips and is its seed. Gated by the input (not folded to ``na``) it must
    be served exactly as the folded tree is."""
    doc = _doc()
    case = {c["name"]: c for c in doc["cases"]}[
        "a direction whose levels an input turns off \u00b7 var origin \u00b7 off the listing"]

    def gate(n):
        if isinstance(n, dict) and n.get("type") == "op" and n.get("name") == "/" and all(
                isinstance(a, dict) and a.get("type") == "num" and a.get("value") == 0 for a in n.get("args", [])):
            return {"type": "op", "name": "?:", "args": [
                {"type": "series", "name": "jz"},
                {"type": "offset", "value": 1, "args": [{"type": "series", "name": "close"}]}, n]}
        if isinstance(n, dict) and isinstance(n.get("args"), list):
            return dict(n, args=[gate(a) for a in n["args"]])
        return n
    sink: dict = {}
    got = ai.interpret(gate(case["ast"]), doc["bars"], {"jz": 0}, opts=dict(case["opts"], chartClockSink=sink))
    assert [g is None for g in got] == [e is None for e in case["expected"]]
    assert sorted(sink) == []


@pytest.mark.parametrize("bz", [0, 1])
def test_an_or_is_not_an_and(bz):
    """r3 (review VAR-OFF P4) -- ``interpret.js::prunedUpdate``'s ``||`` rule, this lane:
    ``r == 1 || bz`` with ``bz`` off IS ``r == 1`` (a probe case, withheld as the plain
    latch); with ``bz`` on it is true on every bar (``r`` is 1, served past the warm-up)."""
    doc = _doc()
    case = {c["name"]: c for c in doc["cases"]}["a latch read only in its test \u00b7 var origin \u00b7 off the listing"]
    ast = case["ast"]
    body = ast["args"][1]
    gated = dict(ast, args=[ast["args"][0], dict(body, args=[
        {"type": "op", "name": "||", "args": [body["args"][0], {"type": "series", "name": "bz"}]}] + body["args"][1:])]
        + ast["args"][2:])
    sink: dict = {}
    got = ai.interpret(gated, doc["bars"], {"bz": bz}, opts=dict(case["opts"], chartClockSink=sink))
    if bz == 0:
        assert got == case["expected"]
        assert sorted(sink) == ["var-origin:bars"]
    else:
        assert got[250:] == [1] * (len(got) - 250)
        assert sorted(sink) == []
