"""The server's built-ins that compare inside with Pine's epsilon (engine 78 (#1858), Q-FCMP2), twin of
``app/src/components/chart/engine/pineCompareBuiltins.test.js``. TradingView's readings are the capture's own
numbers, READ OFF the committed capture (vw-fcmp-builtins-spy-1d-2026-11-18 and -rddt-1d, B32-B34, every bar),
with that capture's own bars (AMEX:SPY 1D from the listing, NYSE:RDDT 1D)."""
from __future__ import annotations

import json
import math
import pathlib

from api.services import ast_interpret as A
from api.services import pine_compare as P
from api.services.indicator_compute import compute_adx_raw

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _capture(sym):
    return json.loads((ROOT / "tests" / "fixtures" / "vendor" / "harness"
                       / f"vw-fcmp-builtins-{sym}-1d-2026-11-18.json").read_text("utf-8"))


def _bars(cap):
    return [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": v} for t, o, h, l, c, v in cap["bars"]["rows"]]


def _dmi(cap):
    """TradingView's ta.dmi(14, 14) as (DI+, DI-, ADX) per bar, read off the capture (B32-B34)."""
    f = cap["plotValues"]["fields"]
    at = [f.index(next(p["id"] for p in cap["study"]["plots"] if p["title"] == t))
          for t in ("B32_dmi_diplus", "B33_dmi_diminus", "B34_dmi_adx")]
    return [tuple(r[k] for k in at) for r in cap["plotValues"]["rows"]]


SPY = _capture("spy")
BARS = _bars(SPY)
TV_ALL = _dmi(SPY)
TV = {i: TV_ALL[i] for i in (5332, 5333, 5453, 8508)}


def _close(a, b):
    return a is not None and abs(a - b) <= 1e-9 * max(1.0, abs(b))


def _off_cells(legs, tv):
    """(bar, leg) cells where ``legs`` (plus, minus, adx) is not TradingView's; na cells are not compared."""
    return [(i, k) for i, row in enumerate(tv) for k, v in enumerate(row)
            if v is not None and not _close(legs[k][i], v)]


def test_ta_dmi_reads_tradingview_on_every_bar_with_the_pine_compare():
    adx, plus, minus = compute_adx_raw(BARS, 14, gt=P.pine_gt)
    assert sum(all(v is not None for v in row) for row in TV_ALL) > 8400
    assert _off_cells((plus, minus, adx), TV_ALL) == []
    rddt = _capture("rddt")
    adx, plus, minus = compute_adx_raw(_bars(rddt), 14, gt=P.pine_gt)
    assert _off_cells((plus, minus, adx), _dmi(rddt)) == []


def test_the_ieee_control_is_off_tradingview_from_the_tie():
    adx, plus, minus = compute_adx_raw(BARS, 14)
    off = _off_cells((plus, minus, adx), TV_ALL)
    assert len(off) == 759 and min(i for i, _ in off) == 5333


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
