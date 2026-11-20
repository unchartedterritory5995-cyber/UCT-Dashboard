"""HTF-LIVE-FIRST-PERIOD (2026-11-19) in the Python lane's ``tf_live`` mask (``ast_interpret.py``).

The twin of ``app/src/components/chart/engine/ast/htfLiveFirstPeriod.test.js``, over the fixture it writes
(``tests/fixtures/ast/htf_live_first_period.json``). Off the listing, a look-ahead read (``tf_live``,
``request.security(…, lookahead = barmerge.lookahead_on)``) whose first week or month is partial read that period's
open, high, low and volume from PART of it, on the period's own bars and, through a history inside the read
(``high[1]``), on the next period's. Each ``tf_live`` child is now walked on the higher-timeframe bars with every field
but ``close`` unknown on the first one (``_tf_live_first_period_read_mask``), and the root bars that read an unknown one
are withheld by name (``request:htf-lookahead-first-period-partial``); a read of ``close`` alone keeps its picture. For
every case the Python lane must give the hand-written answer over the case's window AND the chart's served column bar
for bar: one lane moved and not the other is red here or in the JS file.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import ast_interpret

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "htf_live_first_period.json"
FIX = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = FIX["cases"]


def _bars(days):
    return [{"t": t, "o": i + 0.5, "h": i + 1.5, "l": i, "c": i + 1, "v": 100 + i} for i, t in enumerate(days)]


def _opts(case):
    """The fixture's chart (JS spelling) in the Python lane's: ``newestBarIsForming`` is ``newest_bar_is_forming``."""
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
    assert sum(n.startswith("KEPT") for n in names) >= 6
    assert sum(n.startswith("CONTROL") for n in names) >= 4
    assert any(n.startswith("live(high[1])") for n in names)
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


def test_the_defect_by_name():
    assert _column(_case("live(high) (bars 0-2"))[0] is None              # never 3.5, the partial week's high
    assert _column(_case("CONTROL live(high) from the listing"))[0] == 3.5
    inner = _column(_case("live(high[1]) (a history inside"))
    assert inner[3] is None and inner[7] == 7.5                          # week 1 never reads the partial week
    assert _column(_case("CONTROL live(high[1]) from the listing"))[3] == 3.5


def test_the_code_is_named_and_a_kept_read_and_the_controls_name_none():
    def named(prefix):
        sink: dict = {}
        _column(_case(prefix), sink)
        return sink
    code = ast_interpret.TF_LIVE_FIRST_CODE
    assert code == "request:htf-lookahead-first-period-partial"
    assert code in ast_interpret.CHART_CLOCK_WITHHELD_CODES
    assert code in named("live(high) (bars 0-2")
    assert code in named("live(high)[1]")
    assert code in named("live(high[1]) (a history inside")
    assert code not in named("KEPT live(close) (")
    assert code not in named("CONTROL live(high) on the Monday set")
    assert code not in named("CONTROL live(high) from the listing")


def test_the_partial_fields_are_the_manifests_series_but_close():
    # derived from the manifest, never listed: a series leaf the table adds is a partial field unless it is `close`
    assert ast_interpret._PARTIAL_PERIOD_SERIES == frozenset(ast_interpret.TABLE["series"]) - {"close"}
    assert {"open", "high", "low", "volume"} <= ast_interpret._PARTIAL_PERIOD_SERIES
    assert ast_interpret._reads_partial_field({"type": "call", "name": "vwap", "args": []})
    assert not ast_interpret._reads_partial_field({"type": "series", "name": "close"})
