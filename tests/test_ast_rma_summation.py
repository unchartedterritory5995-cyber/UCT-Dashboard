"""Landing train 1 -- ``ta.rma`` in TradingView's own arithmetic, the PYTHON lane held to the bit.

TradingView's ``ta.rma`` is ``(prev * (n - 1) + src) / n``: measured offline against float64 bit
patterns on licence-held captures, 4,063 of 4,063 values (``docs/pine/evidence/2026-11-16-rma-summation/
EVIDENCE.md`` names each capture). The JS lanes are held to the same doubles by
``app/src/components/chart/engine/ast/rmaSummation.test.js``. The captures stay out of git; the builtin
ATR(14) capture's bars are the committed RDDT fixture's 666 sessions, so the ten doubles below are what
TradingView draws for ``ta.rma(ta.tr(true), 14)`` over committed bars.
"""
import json
import math
import sys
from pathlib import Path

import pytest

from api.services import ast_interpret

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))
import ast_conformance as ac  # noqa: E402

RDDT = ROOT / "tests" / "fixtures" / "vendor" / "harness" / "support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json"

#: TradingView, builtin ATR(14), NYSE:RDDT 1D from the listing: bar -> the plotted double.
TV_ATR14 = {
    13: 7.250335714285716, 14: 7.042454591836736, 15: 6.70870783527697, 16: 6.414514418471472,
    50: 4.4190304995348, 100: 4.2696716837663855, 200: 11.144666762069308, 333: 8.012469608006338,
    500: 8.400680456350505, 665: 8.071162948989976,
}
OLD_SPELLING_MISSED = [16, 50, 100, 333, 500, 665]


def _bars():
    rows = json.loads(RDDT.read_text(encoding="utf-8"))["bars"]["rows"]
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def S(name):
    return {"type": "series", "name": name}


def N(v):
    return {"type": "num", "value": v}


def C(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def _true_range(bars):
    out = []
    for i, b in enumerate(bars):
        out.append(b["h"] - b["l"] if i == 0 else max(b["h"] - b["l"], abs(b["h"] - bars[i - 1]["c"]), abs(b["l"] - bars[i - 1]["c"])))
    return out


def _reference(src, n, step):
    out = [None] * len(src)
    prev = None
    total = 0.0
    for i, v in enumerate(src):
        if prev is None:
            total += v
            if i == n - 1:
                prev = total / n
                out[i] = prev
        else:
            prev = step(prev, v, n)
            out[i] = prev
    return out


def _tv(prev, v, n):
    return (prev * (n - 1) + v) / n


def _old(prev, v, n):
    return prev * (1 - 1 / n) + v * (1 / n)


def test_the_reference_is_the_captured_doubles_and_the_old_spelling_is_not():
    tr = _true_range(_bars())
    ref = _reference(tr, 14, _tv)
    for bar, want in TV_ATR14.items():
        assert ref[bar] == want, (bar, ref[bar], want)
    old = _reference(tr, 14, _old)
    assert [bar for bar in sorted(TV_ATR14) if old[bar] != TV_ATR14[bar]] == OLD_SPELLING_MISSED


def test_the_python_lane_draws_tradingviews_doubles_on_every_bar():
    bars = _bars()
    ref = _reference(_true_range(bars), 14, _tv)
    col = ast_interpret.interpret(C("atrPine", S("high"), S("low"), S("close"), N(14)), bars)
    for bar, want in TV_ATR14.items():
        assert col[bar] == want, (bar, col[bar], want)
    assert [None if v is None or (isinstance(v, float) and math.isnan(v)) else v for v in col] == ref
    close3 = ast_interpret.interpret(C("rma", S("close"), N(3)), bars)
    assert [None if v is None or (isinstance(v, float) and math.isnan(v)) else v for v in close3] == _reference([b["c"] for b in bars], 3, _tv)


def test_ema_is_untouched():
    bars = _bars()
    k = 2 / (14 + 1)
    want = _reference([b["c"] for b in bars], 14, lambda prev, v, n: prev * (1 - k) + v * k)
    col = ast_interpret.interpret(C("ema", S("close"), N(14)), bars)
    assert [None if v is None or (isinstance(v, float) and math.isnan(v)) else v for v in col] == want


@pytest.mark.skipif(not ac.js_lane_available(), reason="no JS lane")
def test_js_and_python_agree_bit_for_bit():
    bars = _bars()
    cases = [
        {"id": "rma_close_3", "ast": C("rma", S("close"), N(3))},
        {"id": "rma_close_14", "ast": C("rma", S("close"), N(14))},
        {"id": "atr_pine_14", "ast": C("atrPine", S("high"), S("low"), S("close"), N(14))},
    ]
    js = ac.run_js(cases, bars)
    py = ac.run_py(cases, bars)
    # bit for bit: the same float64 in both lanes on every bar, not a tolerance
    for c in cases:
        assert len(js[c["id"]]) == len(py[c["id"]]) == len(bars)
        diff = [i for i, (a, b) in enumerate(zip(js[c["id"]], py[c["id"]])) if not (a == b or (a is None and b is None))]
        assert diff == [], (c["id"], diff[:5])
        assert sum(1 for v in py[c["id"]] if v is not None) > 600
