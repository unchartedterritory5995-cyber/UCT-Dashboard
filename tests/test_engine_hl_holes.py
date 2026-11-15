"""Engine HL -- ``highest`` / ``lowest`` over a source with ``na`` holes, in the PYTHON lane.

The JS lanes are pinned to the same captures by
``app/src/components/chart/engine/ast/engineHlHoles.test.js``. S10's six committed captures
(``tests/fixtures/vendor/harness/vw-cs2-holed-highest-*-2026-11-15``, probes written in this repo,
NYSE:RDDT and AMEX:SPY 1D from the listing) hold ``ta.highest(x, 10)`` / ``ta.lowest(x, 10)`` over
``x = bar_index % 50 == 30 ? na : close``: TradingView reads the last ``n`` FINITE values, reaching
back past every hole, and answers on the hole bar; 12 columns, 0 mismatches. What no capture pins is
withheld by name (``window_hole_mask``).
"""
import json
import math
from pathlib import Path

import pytest

from api.services import ast_interpret as ai

ROOT = Path(__file__).resolve().parent.parent
HARNESS = ROOT / "tests" / "fixtures" / "vendor" / "harness"
CAPTURES = [(p, s) for p in ("vw-cs2-holed-highest-v5", "vw-cs2-holed-highest-v6", "vw-cs2-holed-highest-stoch-v6")
            for s in ("rddt", "spy")]
NAN = float("nan")


def _load(probe, sym):
    d = json.loads((HARNESS / f"{probe}-{sym}-1d-2026-11-15.json").read_text(encoding="utf-8"))
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in d["bars"]["rows"]]
    tv = [[r[k + 1] for r in d["plotValues"]["rows"]] for k in (0, 1)]
    return d, bars, tv


def S(name):
    return {"type": "series", "name": name}


def N(v):
    return {"type": "num", "value": v}


def C(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def OP(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


#: ``x = bar_index % 50 == 30 ? na : close`` -- the probes' source, in this lane's tree.
HOLED_X = OP("?:", OP("==", C("mod", S("barindex"), N(50)), N(30)), OP("/", N(0), N(0)), S("close"))


def _same(a, b):
    if a is None or b is None or (isinstance(a, float) and math.isnan(a)):
        return (a is None or (isinstance(a, float) and math.isnan(a))) and b is None
    return abs(a - b) <= 1e-12 * max(1.0, abs(b))


def _mismatches(ours, tv):
    return sum(0 if _same(a, b) else 1 for a, b in zip(ours, tv))


def test_the_policy_is_finite_for_highest_lowest_and_restart_for_the_arg_extremes():
    assert ai.WINDOW_NA["highest"] == ai.NA_FINITE
    assert ai.WINDOW_NA["lowest"] == ai.NA_FINITE
    assert ai.WINDOW_NA["highestbars"] == ai.NA_RESTART
    assert ai.WINDOW_NA["lowestbars"] == ai.NA_RESTART


@pytest.mark.parametrize("probe,sym", CAPTURES)
def test_the_python_lane_draws_every_captured_column_exactly(probe, sym):
    d, bars, tv = _load(probe, sym)
    assert d["history"]["startsAtBar0"] is True
    sink = {}
    for k, name in ((0, "highest"), (1, "lowest")):
        col = ai.interpret(C(name, HOLED_X, N(10)), bars, opts={"historyFromListing": True, "tf": "D",
                                                                 "chartClockSink": sink})
        assert _mismatches(col, tv[k]) == 0, f"{probe} {sym} {name}"
    assert sink == {}
    if sym == "rddt":
        assert tv[0][30] == 47.7 and tv[1][30] == 40.88


def test_synthetic_rule_reaches_past_holes_fewer_while_fewer_exist():
    ext = lambda s, lo, hi: max(s[lo:hi + 1])  # noqa: E731
    assert [None if math.isnan(v) else v for v in ai._rolling_finite([5, 9, 7, NAN, 6, NAN, NAN, 4], 3, ext)] \
        == [None, None, 9, 9, 9, 9, 9, 7]
    assert [None if math.isnan(v) else v for v in ai._rolling_finite([NAN, NAN, NAN, NAN, 3, 8, NAN, 2], 3, ext)] \
        == [None, None, None, None, 3, 8, 8, 8]
    assert ai.finite_window_count([NAN, 1, NAN, 2, 3, 4], 3) == [0, 1, 1, 2, 3, 3]


def test_off_the_listing_a_short_window_is_withheld_by_name():
    _, bars, _ = _load("vw-cs2-holed-highest-v6", "rddt")
    tree = C("highest", C("sma", S("close"), N(20)), N(10))
    sink = {}
    off = ai.interpret(tree, bars[100:], opts={"historyFromListing": False, "tf": "D", "chartClockSink": sink})
    assert sink == {ai.WINDOW_EXTREME_LEFT_EDGE: True}
    assert all(v is None for v in off[:28])
    on = ai.interpret(tree, bars, opts={"historyFromListing": True, "tf": "D"})
    assert off[28:] == on[128:]
    sink_on = {}
    ai.interpret(tree, bars, opts={"historyFromListing": True, "tf": "D", "chartClockSink": sink_on})
    assert sink_on == {}
    assert on[19] is not None and on[18] is None


def test_arg_extreme_holed_names_the_bars_the_rules_could_split():
    src = [NAN, NAN, NAN, 4, 5, 6, NAN, 7, 8, 9, 10]
    assert ai._arg_extreme_holed(src, 3, False) == [0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0]
    assert ai._arg_extreme_holed(src, 3, True) == [0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0]
    assert ai._arg_extreme_holed([1, 2, 3, 4], 3, True) == [0, 0, 0, 0]


def test_a_holed_highestbars_is_withheld_and_a_clean_one_drawn():
    _, bars, _ = _load("vw-cs2-holed-highest-v6", "rddt")
    sink = {}
    col = ai.interpret(C("highestbars", HOLED_X, N(10)), bars, opts={"historyFromListing": True, "tf": "D",
                                                                     "chartClockSink": sink})
    assert sink == {ai.ARG_EXTREME_HOLED: True}
    for i in (30, 31, 39, 80, 89):
        assert col[i] is None, i
    for i in (9, 29, 40, 79):
        assert col[i] is not None, i
    clean_sink = {}
    clean = ai.interpret(C("highestbars", S("close"), N(10)), bars, opts={"historyFromListing": True, "tf": "D",
                                                                          "chartClockSink": clean_sink})
    assert clean_sink == {}
    assert sum(1 for v in clean if v is not None) == len(bars) - 9
