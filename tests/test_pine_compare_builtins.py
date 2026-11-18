"""The server's built-ins that compare inside with Pine's epsilon (engine NUMBER PENDING, Q-FCMP2), twin of
``app/src/components/chart/engine/pineCompareBuiltins.test.js``. TradingView's readings are the capture's own
numbers (vw-fcmp-builtins-spy-1d B32-B34); the bars are the committed Q-FCMP capture's (AMEX:SPY 1D)."""
from __future__ import annotations

import json
import math
import pathlib

from api.services import ast_interpret as A
from api.services import pine_compare as P
from api.services.indicator_compute import compute_adx_raw

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPY = json.loads((ROOT / "tests" / "fixtures" / "vendor" / "harness"
                  / "vw-float-compare-tolerance-spy-1d-2026-11-18.json").read_text("utf-8"))
BARS = [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": v} for t, o, h, l, c, v in SPY["bars"]["rows"]]
TV = {
    5332: (28.94116781399634, 15.841167324696508, 16.591027084823384),
    5333: (27.576070967939575, 15.093971230475914, 17.49542564792106),
    5453: (16.445609431545687, 23.372807305190733, 15.777428411753908),
    8508: (21.54461215049009, 36.73596933376465, 15.161839956000872),
}


def _close(a, b):
    return a is not None and abs(a - b) <= 1e-9 * max(1.0, abs(b))


def test_ta_dmi_reads_tradingview_with_the_pine_compare():
    adx, plus, minus = compute_adx_raw(BARS, 14, gt=P.pine_gt)
    for i, (p, m, a) in TV.items():
        assert _close(plus[i], p), (i, plus[i], p)
        assert _close(minus[i], m), (i, minus[i], m)
        assert _close(adx[i], a), (i, adx[i], a)


def test_the_native_adx_keeps_ieee_and_parts_at_the_tie():
    adx, plus, minus = compute_adx_raw(BARS, 14)
    assert _close(plus[5332], TV[5332][0])
    assert not _close(plus[5333], TV[5333][0])


def test_fn_pine_serves_a_pine_document_and_fn_a_native_one():
    h, l, c = [b["h"] for b in BARS], [b["l"] for b in BARS], [b["c"] for b in BARS]  # noqa: E741
    assert _close(A.FN_PINE["plusDI"](h, l, c, 14)[5333], TV[5333][0])
    assert not _close(A.FN["plusDI"](h, l, c, 14)[5333], TV[5333][0])
    assert sorted(A.FN_PINE) == ["adx", "falling", "minusDI", "percentrank", "plusDI", "rising"]


def test_rising_falling_percentrank_within_the_epsilon():
    for e in (2.9976021664879227e-14, 9.000000744663339e-11):
        hs = [1.0 + e if i % 3 == 1 else 1.0 for i in range(12)]
        assert A.FN_PINE["rising"](hs, 1) == [0.0] * 12
        assert A.FN_PINE["falling"](hs, 1) == [0.0] * 12
        assert all(A.FN["rising"](hs, 1)[i] == 1.0 for i in range(4, 12, 3))
        pr, ie = A.FN_PINE["percentrank"](hs, 1), A.FN["percentrank"](hs, 1)
        for i in range(2, 12, 3):
            assert pr[i] == 100.0 and ie[i] == 0.0


def test_a_pine_evaluation_of_the_tree_uses_them():
    bars = [{"t": t, "o": c, "h": c, "l": c, "c": c, "v": 1} for t, c in enumerate([1.0, 1.0 + 3e-14, 1.0, 1.0 + 3e-14])]
    tree = {"type": "call", "name": "rising", "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 1}]}
    assert A.interpret(tree, bars, opts={"pineCompare": True}) == [0.0, 0.0, 0.0, 0.0]
    assert A.interpret(tree, bars, opts={}) == [0.0, 1.0, 0.0, 1.0]
    assert math.isfinite(P.PINE_EQ_EPSILON)
