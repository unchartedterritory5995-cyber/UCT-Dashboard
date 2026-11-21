"""RULING 1 (coordinator, 2026-11-20) in the Python lane: every window of the table at the left edge of a cut chart.

The twin of ``app/src/components/chart/engine/ast/windowWarmupEdge.test.js``, over the fixture it writes
(``tests/fixtures/ast/window_warmup_edge.json``). Off the listing, a call whose window reaches before the chart's first
bar answers ``na`` through its warm-up where TradingView, whose history begins at the listing, answers a number; a
script that turns that ``na`` into something drawn drew a value TradingView cannot agree with. The walk
(``ast_interpret._window_edge_lookback`` inside ``_witness_mask``'s ``before_first``) holds the bar unknown and the root bar
drawn from it is withheld, named ``history:before-chart``. The JS rail measures every function against a longer chart;
this lane must serve the same column for each one, name the same code, and withhold nothing from the listing.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import ast_interpret

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "window_warmup_edge.json"
FIX = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = FIX["cases"]


def _opts(extra=None):
    chart = dict(FIX["chart"], **FIX["pine"], **(extra or {}))
    opts = {k: v for k, v in chart.items() if k != "newestBarIsForming"}
    opts["newest_bar_is_forming"] = chart["newestBarIsForming"]
    return opts


def _column(tree, opts):
    col = ast_interpret.interpret(tree, FIX["bars"], {}, opts=opts)
    return [None if v is None or (isinstance(v, float) and math.isnan(v)) else v for v in col]


def _same(got, want, label):
    assert len(got) == len(want), label
    for j, (g, w) in enumerate(zip(got, want)):
        if w is None:
            assert g is None, f"{label} bar {j}: {g} where the JS lane withholds"
        else:
            assert g is not None and g == pytest.approx(w, rel=1e-9, abs=1e-9), f"{label} bar {j}: {g} != {w}"


def test_the_fixture_is_not_vacuous():
    assert len(CASES) >= 55
    names = {c["name"] for c in CASES}
    for name in ("sma", "ema", "rsi", "pivothigh", "rising", "falling", "mfiPine", "barssince", "valuewhen",
                 "valuewhenOccurrence", "change", "accum", "accum2"):
        assert name in names, name
    for name in ("barsAgo", "cum", "cumFrom"):
        assert name not in names, name
    # ruling (i)'s branch of the listing check below is taken by some cases and not by others (never vacuous)
    rec = [c["name"] for c in CASES if ast_interpret._holds_recurrence(c["tree"])]
    assert rec and len(rec) < len(CASES), rec


def test_the_window_edge_reads_the_same_reach_as_the_js_lane():
    assert ast_interpret.WINDOW_EDGE_FINITE == frozenset({"rising", "falling", "mfiPine"})
    for c in CASES:
        assert ast_interpret._window_edge_lookback(c["tree"]["args"][0]) > 0, c["name"]
    close = {"type": "series", "name": "close"}

    def num(v):
        return {"type": "num", "value": v}

    def call(name, *args):
        return {"type": "call", "name": name, "args": list(args)}

    edge = ast_interpret._window_edge_lookback
    assert edge(call("sma", close, num(5))) == 5
    assert edge(call("hma", close, num(5))) == 10                       # a whole multiple of an argument
    assert edge(call("change", close)) == 1
    assert edge(call("valuewhenOccurrence", close, close, num(0))) == math.inf
    # a history read (``before_first``'s own), an unbounded total (FINDING 2), an anchored one, a pointwise call
    assert edge(call("barsAgo", close, num(1), num(5))) == 0
    assert edge(call("cum", close)) == 0
    assert edge(call("cumFrom", close, num(1700000000), num(6))) == 0
    assert edge(call("abs", close)) == 0


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_python_lane_serves_the_js_column_and_the_same_name(case):
    sink: dict = {}
    opts = _opts()
    opts["chartClockSink"] = sink
    _same(_column(case["tree"], opts), case["served"], case["name"])
    assert (ast_interpret.HISTORY_BEFORE_CHART_CODE in sink) == case["named"], case["name"]
    assert case["served"][0] is None, case["name"]
    # from the listing nothing is withheld for a window (the window's own answer is the listing run's, not this rule's)
    # ⭐ Engine 92 train integration (coordinator ruling, 2026-11-20). RULING 1 (#2213: "a window that reaches before
    # the chart's first bar, off the listing, is unknown there") withholds nothing from the listing. RULING (i) (#2249:
    # "from the listing a recurrence is the chart lane's; the Python lane withholds it by name") is the specific one
    # for a SINGLE-STATE RECURRENCE: from the listing this lane withholds it whole, named ``var-origin:listing-pass``.
    # Which cases are such recurrences is the lane's own predicate (``ast_interpret._holds_recurrence``, the one
    # ``interpret`` asks), never a typed list; every other case still withholds nothing from the listing.
    lsink: dict = {}
    listing = _column(case["tree"], _opts({"historyFromListing": True, "chartClockSink": lsink}))
    if ast_interpret._holds_recurrence(case["tree"]):
        assert all(v is None for v in listing), f"{case['name']} drawn from the listing (ruling (i) withholds it)"
        assert ast_interpret.LISTING_PASS_CHART_LANE in lsink, case["name"]
    else:
        assert all(v is not None for v in listing), f"{case['name']} withheld from the listing"
