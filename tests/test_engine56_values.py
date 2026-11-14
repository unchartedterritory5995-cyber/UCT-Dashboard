"""ENGINE 56 -- the Python lane's twin of the wrong-value fixes (``engine56Values.test.js``).

The scan and alert lanes evaluate the same canonical trees the chart does, so each fix lands
here too and is held to the same numbers:

- A2  ``percentrank``: an ``na`` PRIOR value counts as "not <=" (divisor ``length``).
- S4-1 ``pivothigh`` / ``pivotlow`` ignore an ``na`` on the LEFT side.
- S4-2 ``highestbars`` / ``lowestbars``: over a bar price the NEWEST tied bar wins (and so
  do ``aroonUp`` / ``aroonDown``); over a computed source a tied window is withheld.
- A3  ``boolNaWithheld(operand, flag)``: the operand on every bar, withheld where ``flag``.

The RDDT bars are the committed ``support-and-resistance-5f95e90f-rddt-1d-2026-11-13``
fixture's, the same 666 sessions the licence-held TradingView captures hold.
"""
from __future__ import annotations

import json
import math
import pathlib

from api.services import ast_interpret

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "vendor" / "harness" / "support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json"
RDDT = [{"t": t, "o": o, "h": h, "l": low, "c": c, "v": v}
        for t, o, h, low, c, v in json.loads(FIXTURE.read_text(encoding="utf-8"))["bars"]["rows"]]
NAN = float("nan")


def s(name):
    return {"type": "series", "name": name}


def num(v):
    return {"type": "num", "value": v}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def test_percentrank_skips_an_na_prior_and_keeps_the_divisor():
    out = ast_interpret.FN["percentrank"]([NAN, NAN, NAN, 5.0, 1.0, 2.0, 9.0, 3.0], 4)
    assert math.isnan(out[3])
    assert out[4:] == [0.0, 25.0, 75.0, 50.0]
    assert math.isnan(ast_interpret.FN["percentrank"]([1.0, 2.0, 3.0, NAN, 4.0], 3)[3])


def test_percentrank_of_roc_answers_from_bar_100_on_rddt():
    # ``ta.percentrank(ta.roc(close, 1), 100)``: roc is na on bar 0, inside bar 100's window
    tree = call("percentrank", op("*", num(100), op("/", call("change", s("close")), {"type": "offset", "value": 1, "args": [s("close")]})), num(100))
    col = ast_interpret.interpret(tree, RDDT)
    assert col[99] is None
    assert col[100] is not None
    closes = [b["c"] for b in RDDT]
    roc = [None] + [100 * (closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes))]
    want = 100.0 * sum(1 for k in range(1, 101) if roc[100 - k] is not None and roc[100 - k] <= roc[100]) / 100
    assert abs(col[100] - want) < 1e-9


def test_pivots_ignore_a_left_side_na():
    hi = ast_interpret.FN["pivothigh"]([NAN, NAN, 3.0, 9.0, 2.0, 1.0, NAN, 8.0, 4.0, 5.0], 3, 2)
    assert hi[3] == 9.0 and hi[7] == 8.0
    lo = ast_interpret.FN["pivotlow"]([NAN, 5.0, 4.0, 1.0, 3.0, 6.0, NAN, 0.0], 2, 2)
    assert lo[3] == 1.0
    assert math.isnan(ast_interpret.FN["pivothigh"]([1.0, 2.0, 9.0, NAN, 3.0], 1, 2)[2])


def test_arg_extreme_newest_over_a_bar_price_on_rddt():
    # bars 112 and 116 hold the same high: bar 116 wins, on bar 116 and on bar 117
    assert RDDT[112]["h"] == RDDT[116]["h"] == 60.41
    col = ast_interpret.interpret(call("highestbars", s("high"), num(15)), RDDT)
    assert col[116] == 0.0
    col11 = ast_interpret.interpret(call("highestbars", s("high"), num(11)), RDDT)
    assert col11[117] == 1.0
    # the aroon form: 100 * (14 - hb) / 14 reads 100 on bar 116 (TradingView's builtin Aroon)
    up = ast_interpret.interpret(call("aroonUp", num(14)), RDDT)
    assert up[116] == 100.0


def test_arg_extreme_tie_over_a_computed_source_is_withheld():
    bars = [{"t": 1700000000 + i * 86400, "o": 100.0 + (i % 2), "h": 102.0, "l": 99.0, "c": 100.5, "v": 1000}
            for i in range(30)]
    vt = op("?:", op(">", s("close"), s("open")), num(10), num(20))
    col = ast_interpret.interpret(call("highestbars", vt, num(4)), bars)
    assert all(v is None for v in col[3:])
    assert ast_interpret.arg_extreme_tie_mask(call("highestbars", vt, num(4)), bars)[5] == 1
    # no tie, nothing withheld
    rising = [{"t": 1700000000 + i * 86400, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.0 + i, "v": 1} for i in range(30)]
    assert ast_interpret.arg_extreme_tie_mask(call("highestbars", op("*", s("close"), num(2)), num(4)), rising) is None


def test_bool_na_marker_is_its_operand_and_withholds_where_flagged():
    assert "boolNaWithheld" in ast_interpret.FN
    sma = call("sma", s("close"), num(5))
    c = op(">", s("close"), sma)
    flag = call("na", sma)
    tree = op("!=", call("boolNaWithheld", c, flag), num(0))
    col = ast_interpret.interpret(tree, RDDT)
    assert col[:4] == [None, None, None, None]
    assert all(v is not None for v in col[4:40])
    mask = ast_interpret.bool_na_mask(tree, RDDT)
    assert mask[:5] == [1, 1, 1, 1, 0]


def test_is_bar_price_tree_matches_the_js_shapes():
    assert ast_interpret.is_bar_price_tree(s("low"))
    assert ast_interpret.is_bar_price_tree(op("/", op("+", op("+", s("high"), s("low")), s("close")), num(3)))
    assert not ast_interpret.is_bar_price_tree(s("volume"))
    assert not ast_interpret.is_bar_price_tree(op("/", op("+", s("low"), s("high")), num(2)))
