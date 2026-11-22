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


def test_s1_a_tie_newest_source_takes_the_newest_tied_bar_and_is_never_withheld():
    """S1 (v4 = v5 witnessed): over a source the translator marked ``tieNewest`` -- a two-valued
    computed one here -- highestbars names the NEWEST of a tie, first value on bar length - 1."""
    bars = [{"t": 1700000000 + i * 86400, "o": 100.0 + (i % 2), "h": 102.0, "l": 99.0, "c": 100.5, "v": 1000}
            for i in range(30)]
    vt = op("?:", op(">", s("close"), s("open")), num(10), num(20))
    assert ast_interpret.is_bar_price_tree(call("tieNewest", vt))
    tree = call("highestbars", call("tieNewest", vt), num(4))
    col = ast_interpret.interpret(tree, bars)
    vals = [10 if b["c"] > b["o"] else 20 for b in bars]
    assert col[:3] == [None, None, None]
    for i in range(3, 30):
        window = vals[i - 3:i + 1]
        newest = max(j for j in range(4) if window[j] == max(window))
        assert col[i] == float(3 - newest), i
    assert ast_interpret.arg_extreme_tie_mask(tree, bars) is None
    assert ast_interpret.interpret(call("tieNewest", s("close")), RDDT)[:5] == [b["c"] for b in RDDT[:5]]


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
    # hlcc4 as pine.js builds it since it took TradingView's arithmetic, (high + low + 2 * close) / 4,
    # and a hand-written four-term sum, which stays a bar price
    assert ast_interpret.is_bar_price_tree(
        op("/", op("+", op("+", s("high"), s("low")), op("*", num(2), s("close"))), num(4)))
    assert ast_interpret.is_bar_price_tree(
        op("/", op("+", op("+", op("+", s("high"), s("low")), s("close")), s("close")), num(4)))
    assert not ast_interpret.is_bar_price_tree(
        op("/", op("+", op("+", s("high"), s("low")), op("*", num(3), s("close"))), num(4)))
    assert not ast_interpret.is_bar_price_tree(s("volume"))
    assert not ast_interpret.is_bar_price_tree(op("/", op("+", s("low"), s("high")), num(2)))


def test_review_finding3_a_site_under_another_timeframe_withholds_every_bar():
    vt = op("?:", op(">", s("close"), s("open")), num(10), num(20))
    tree = {"type": "tf", "value": "W", "args": [call("highestbars", vt, num(4))]}
    mask = ast_interpret.arg_extreme_tie_mask(tree, RDDT)
    assert mask is not None and all(mask)
    for kind in ("tf_merge", "ltf", "sym"):
        nested = {"type": kind, "value": "W", "args": [call("highestbars", vt, num(4))]}
        assert all(ast_interpret.arg_extreme_tie_mask(nested, RDDT)), kind


def test_review_finding5_barssince_and_valuewhen_stop_withholding_once_known():
    sma = call("sma", s("close"), num(20))
    up = op(">", s("close"), sma)
    up1 = {"type": "offset", "value": 1, "args": [up]}
    flag = op("||", call("na", sma), call("nz", {"type": "offset", "value": 1, "args": [call("na", sma)]}, num(1)))
    cond = op("!=", call("boolNaWithheld", up, flag), up1)
    bs = call("barssince", cond, num(100))
    mask = ast_interpret.bool_na_mask(bs, RDDT)
    assert mask is not None and 0 < sum(mask) < 40
    vw = call("valuewhenOccurrence", cond, s("close"), num(0))
    m2 = ast_interpret.bool_na_mask(vw, RDDT)
    assert m2 is not None and 0 < sum(m2) < 40
    # a running total cannot forget: every bar from the first unknown one on
    total = call("cum", op("?:", cond, num(1), num(0)))
    assert all(ast_interpret.bool_na_mask(total, RDDT))


def test_rereview5_an_unknown_bar_reaches_the_pivot_centers_right_before_to_left_after():
    # `pivothigh(src, left, right)` at centre c reads bars c-left .. c+right, so an unknown bar u
    # reaches the centres u-right .. u+left (left 2 != right 5: the orientation shows)
    sma = call("sma", s("close"), num(20))
    tree = call("pivothigh", call("boolNaWithheld", s("high"), call("na", sma)), num(2), num(5))
    mask = ast_interpret.bool_na_mask(tree, RDDT)
    assert mask is not None
    # unknown bars 0..18 -> centres 0 .. 18 + 2
    assert mask[:21] == [1] * 21
    assert not any(mask[21:])


def test_rereview7_an_na_condition_is_false_and_keeps_the_occurrences_before_it():
    out0 = ast_interpret._fn_valuewhen_occurrence([1.0, NAN, 1.0, NAN], [100.0, 200.0, 300.0, 400.0], 0)
    out1 = ast_interpret._fn_valuewhen_occurrence([1.0, NAN, 1.0, NAN], [100.0, 200.0, 300.0, 400.0], 1)
    assert out0[1:] == [100.0, 300.0, 300.0]
    assert math.isnan(out1[1]) and out1[2:] == [100.0, 100.0]


def test_probe11_rising_falling_answer_false_on_the_warm_up_never_na():
    # s17-2026-11-15 (`vw-cs2-rising-falling-na-v4/v5`): `ta.rising` / `ta.falling` of `sma(close, 20)`
    # read 0 on every warm-up bar for lengths 1, 2 and 5; the columns read the same on every bar
    sma = call("sma", s("close"), num(20))
    cols = {}
    for k, (name, n) in enumerate([("rising", 1), ("falling", 1), ("rising", 2), ("falling", 2), ("rising", 5), ("falling", 5)]):
        cols[k + 2] = ast_interpret.interpret(call(name, sma, num(n)), RDDT)
    for v in ("v4", "v5"):
        cap = json.loads((ROOT / "tests" / "fixtures" / "vendor" / "harness"
                          / f"vw-cs2-rising-falling-na-{v}-rddt-1d-2026-11-15.json").read_text(encoding="utf-8"))
        rows = cap["plotValues"]["rows"]
        assert len(rows) == len(RDDT)
        for k, col in cols.items():
            warm = [r for r in rows if r[2] == 1]  # A01_s_is_na: the source is na
            assert len(warm) == 19 and all(r[k + 1] == 0 for r in warm), (v, k)
            for i, r in enumerate(rows):
                assert col[i] is not None and col[i] == r[k + 1], (v, k, i, col[i], r[k + 1])


def test_s18_v1_v3_and_over_an_offset_bool_value_form_reads_na_as_false():
    # `cf = c != false` (the value form: na where `c` is), then `raw(cf[1] and x)` as the v1 / v3
    # translation reads it: the operand cast `cf[1] != 0`, so an `na` is false (s18, bar 0 included)
    sma = call("sma", s("close"), num(20))
    c = op(">", s("close"), sma)
    cf = op("?:", call("na", sma), op("/", num(0), num(0)), op("!=", c, num(0)))
    x = op(">", s("close"), s("open"))
    h01 = op("?:", op("&&", op("!=", {"type": "offset", "value": 1, "args": [cf]}, num(0)), x), num(1), num(0))
    col = ast_interpret.interpret(h01, RDDT)
    for v in ("v1", "v3"):
        cap = json.loads((ROOT / "tests" / "fixtures" / "vendor" / "harness"
                          / f"vw-cs2-bool-na-{v}-cum-rddt-1d-2026-11-15.json").read_text(encoding="utf-8"))
        rows = cap["plotValues"]["rows"]
        assert all(r[23] == 0 for r in rows[:20]), v
        assert all(col[i] == r[23] for i, r in enumerate(rows)), v
