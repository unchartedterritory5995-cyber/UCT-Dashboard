"""Engine HL -- ``highest`` / ``lowest`` over a source with ``na`` holes, in the PYTHON lane.

The JS lanes are pinned to the same captures by
``app/src/components/chart/engine/ast/engineHlHoles.test.js``. S10's six committed captures
(``tests/fixtures/vendor/harness/vw-cs2-holed-highest-*-2026-11-15``, probes written in this repo,
NYSE:RDDT and AMEX:SPY 1D from the listing) hold ``ta.highest(x, 10)`` / ``ta.lowest(x, 10)`` over
``x = bar_index % 50 == 30 ? na : close``: TradingView reads the last ``n`` FINITE values, reaching
back past every hole, and answers on the hole bar; 12 columns, 0 mismatches. What no capture pins is
withheld by name (``window_hole_mask``).

⭐⭐ S17 (``vw-cs2-holed-highestbars-rddt-1d-2026-11-15``, probe
``tools/visual_conformance/probes/vw-cs2-holed-highestbars.pine``): ``ta.highestbars`` /
``ta.lowestbars`` over the same holed source read the same last ``n`` finite values, the offset
counted in BARS (bar 30, the hole: -1; bar 37: lowestbars -10); 4 columns, 0 mismatches. ⚰️ #1332's
``arg-extreme:holed-window`` (which withheld those bars) is gone.
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


def test_the_policy_is_finite_for_all_four_extremes_and_the_arg_ones_count_bars():
    for name in ("highest", "lowest", "highestbars", "lowestbars"):
        assert ai.WINDOW_NA[name] == ai.NA_FINITE, name
    assert ai.WINDOW_ARG == frozenset({"highestbars", "lowestbars"})
    assert "restart" not in set(ai.WINDOW_NA.values())
    assert not hasattr(ai, "NA_RESTART") and not hasattr(ai, "WINDOW_NA_CURRENT")
    assert not hasattr(ai, "ARG_EXTREME_HOLED") and not hasattr(ai, "_arg_extreme_holed")
    assert "arg-extreme:holed-window" not in ai.CHART_CLOCK_WITHHELD_CODES


def _load_hb():
    d = json.loads((HARNESS / "vw-cs2-holed-highestbars-rddt-1d-2026-11-15.json").read_text(encoding="utf-8"))
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in d["bars"]["rows"]]
    tv = [[r[k + 1] for r in d["plotValues"]["rows"]] for k in range(8)]
    return d, bars, tv


def _neg(col):
    # the lane's tree form is the non-negative distance; `ta.highestbars` is its negation (pine.js)
    return [None if v is None else -v for v in col]


def test_s17_the_python_lane_draws_the_holed_highestbars_capture_exactly():
    d, bars, tv = _load_hb()
    assert d["history"]["startsAtBar0"] is True and len(bars) == 666
    assert tv[2][30] == -1 and tv[3][30] == -10 and tv[3][37] == -10
    sink = {}
    opts = {"historyFromListing": True, "tf": "D", "chartClockSink": sink}
    for k, name, src in ((2, "highestbars", HOLED_X), (3, "lowestbars", HOLED_X),
                         (6, "highestbars", S("close")), (7, "lowestbars", S("close"))):
        col = ai.interpret(C(name, src, N(10)), bars, opts=opts)
        assert _mismatches(_neg(col), tv[k]) == 0, (k, name)
    assert sink == {}


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


def test_synthetic_arg_offsets_are_counted_in_bars_past_a_hole():
    arg = lambda s, lo, hi: ai._window_arg_extreme(s, lo, hi, lambda v, b: v > b)  # noqa: E731
    low = lambda s, lo, hi: ai._window_arg_extreme(s, lo, hi, lambda v, b: v < b)  # noqa: E731
    src = [5, 9, 7, NAN, 6, NAN, NAN, 4]
    show = lambda col: [None if math.isnan(v) else v for v in col]  # noqa: E731
    assert show(ai._rolling_finite(src, 3, arg, True)) == [None, None, 1, 2, 3, 4, 5, 5]
    assert show(ai._rolling_finite(src, 3, low, True)) == [None, None, 2, 3, 0, 1, 2, 0]
    # a tie names the OLDER bar, in bars
    assert show(ai._rolling_finite([3, NAN, 3, 1], 2, arg, True)) == [None, 1, 2, 1]
    assert show(ai.FN["highestbars"](src, 3)) == [None, None, 1, 2, 3, 4, 5, 5]


def test_a_holed_highestbars_is_drawn_and_a_clean_one_too():
    _, bars, _ = _load("vw-cs2-holed-highest-v6", "rddt")
    sink = {}
    col = ai.interpret(C("highestbars", HOLED_X, N(10)), bars, opts={"historyFromListing": True, "tf": "D",
                                                                     "chartClockSink": sink})
    assert sink == {}
    assert col[30] == 1.0
    assert sum(1 for v in col if v is not None) == len(bars) - 9
    clean_sink = {}
    clean = ai.interpret(C("highestbars", S("close"), N(10)), bars, opts={"historyFromListing": True, "tf": "D",
                                                                          "chartClockSink": clean_sink})
    assert clean_sink == {}
    assert sum(1 for v in clean if v is not None) == len(bars) - 9
