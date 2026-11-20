"""HTF-MERGE-FIELD-AWARE (items 2 + 3, 2026-11-19) in the Python lane's merge mask (``ast_interpret.py``).

The twin of ``app/src/components/chart/engine/ast/htfMergeFieldAware.test.js``, over the fixture it writes
(``tests/fixtures/ast/htf_merge_field_aware.json``). Off the listing, a weekly / monthly merge whose first period is
partial: review L2 withheld, field-unaware, the bars that show that period. A merge's own bars are now walked field by
field (``_first_period_partial_read_mask``'s ``merge_own``, HTF-LIVE-FIRST-PERIOD's walk): ``tf_merge(high[1])`` is
withheld on the NEXT period's bars too (item 2), ``tf_merge(close)`` is drawn (item 3: the partial period's close is the
period's own). A merge holding or under another request keeps review L2's bars. For every case the Python lane must give
the hand-written answer over the case's window AND the chart's served column bar for bar.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import ast_interpret

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "htf_merge_field_aware.json"
FIX = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = FIX["cases"]


def _bars(days):
    return [{"t": t, "o": i + 0.5, "h": i + 1.5, "l": i, "c": i + 1, "v": 100 + i} for i, t in enumerate(days)]


def _opts(case):
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
    assert len(CASES) >= 18
    names = [c["name"] for c in CASES]
    assert sum(n.startswith("KEPT") for n in names) >= 6
    assert sum(n.startswith("CONTROL") for n in names) >= 2
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
        for j, v in enumerate(col[lo:hi]):
            assert (v is None) == (j in case["held"]), f"{case['name']} bar {j}: {v}"
    else:
        _same(col[lo:hi], case["expect"], case["name"])
    _same(col, case["served"], f"{case['name']} (the served column)")


def test_the_two_rulings_by_name():
    # item 2: week 1 never reads the partial week's high through a history inside the merge
    assert _column(_case("merge(high[1]) (item 2"))[6] is None
    assert _column(_case("CONTROL merge(high[1]) from the listing"))[6] == 3.5
    # item 3: the partial week's close is the week's own, drawn, and no first-period code is named for it
    assert _column(_case("KEPT merge(close) (item 3"))[2:6] == [3, 3, 3, 3]
    sink: dict = {}
    _column(_case("KEPT merge(close) (item 3"), sink)
    assert ast_interpret.TF_MERGE_FIRST_CODE not in sink
    sink = {}
    _column(_case("merge(high[1]) (item 2"), sink)
    assert ast_interpret.TF_MERGE_FIRST_CODE in sink


def test_the_merge_pick_is_one_authority():
    # the arm and the mask read the same pick (`_tf_merge_reads`): bar 2 closes week 0 and reads it, bars 3-5 read it
    bars = _bars(FIX["days"]["wednesday"])
    iso, keys, at, _order, _htf = ast_interpret._htf_resampled(bars, "W")
    reads = ast_interpret._tf_merge_reads(iso, keys, at, "W")
    assert reads[:8] == [-1, -1, 0, 0, 0, 0, 1, 1]
