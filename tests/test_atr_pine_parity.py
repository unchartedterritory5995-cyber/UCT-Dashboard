"""Pine's ``ta.atr`` (``atrPine``) in the PYTHON lane, pinned to the VENDOR'S numbers.

The JS lane is pinned to the same two captures by
``app/src/components/chart/engine/ast/atrPine.vendor.test.js`` -- one rule, one
shared fixture pair, two interpreters. Neither file compares a lane with the
other lane; each compares its lane with TradingView, so the two cannot agree
with each other while both being wrong.

The captures (both reach the symbol's FIRST bar, which is the only place a seed
is observable -- a recursive average forgets its seed geometrically):

* ``tests/fixtures/vendor/harness/keltner-channels-bands-rddt-1d-2026-09-27.json``
  Pine v4 ``ma = ema(close, 20)``, bands ``ma +- k * atr(10)``, NYSE:RDDT 1D, all
  631 bars from listing. The vendor's ATR is ``Upper 1 - Basis`` (k = 1), and
  ``(Upper 2 - Basis) / 2``, ``(Upper 3 - Basis) / 3`` and the three lower bands
  give it five more times; plots start at bar 19 because ``ema(20)`` does.
* ``tests/fixtures/vendor/seed-warmup-spy-12m-2026-09-21.json`` -- SPY 12M, the
  whole series is 34 bars; column ``atr5`` is ``ta.atr(5)`` from bar 0.

The rule both captures agree on to the last bit: bar 0's true range is
``high - low`` (``ta.tr(true)``), the seed is the mean of the first ``n`` true
ranges and lands on bar ``n - 1``, Wilder's step after that.
"""
import json
import math
from pathlib import Path

import pytest

from api.services import ast_interpret

ROOT = Path(__file__).resolve().parent.parent
KELTNER = ROOT / "tests" / "fixtures" / "vendor" / "harness" / "keltner-channels-bands-rddt-1d-2026-09-27.json"
SPY12M = ROOT / "tests" / "fixtures" / "vendor" / "seed-warmup-spy-12m-2026-09-21.json"


def _series(name):
    return {"type": "series", "name": name}


def _num(v):
    return {"type": "num", "value": v}


def _call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def _op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def _atr_pine(n):
    return _call("atrPine", _series("high"), _series("low"), _series("close"), _num(n))


def _house_atr(n):
    return _call("atr", _series("high"), _series("low"), _series("close"), _num(n))


def _rma_of_tr_true(n):
    """``rma(na(close[1]) ? high - low : max(high - low, max(abs(high - close[1]),
    abs(low - close[1]))), n)`` -- the tree ``ta.rma(ta.tr(true), n)`` translates to."""
    prev = {"type": "offset", "value": 1, "args": [_series("close")]}
    rng = _op("-", _series("high"), _series("low"))
    far = _call("max", _call("abs", _op("-", _series("high"), prev)),
                _call("abs", _op("-", _series("low"), prev)))
    tr = _op("?:", _call("na", prev), rng, _call("max", rng, far))
    return _call("rma", tr, _num(n))


def _keltner():
    d = json.loads(KELTNER.read_text(encoding="utf-8"))
    assert d["history"]["startsAtBar0"] is True, "the seed is only observable from bar 0"
    rows = d["bars"]["rows"]
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]
    index = {r[0]: i for i, r in enumerate(rows)}
    vendor = {}
    for p in d["plotValues"]["rows"]:
        basis = p[1]
        # six independent readings of the vendor's atr(10) per bar
        vendor[index[p[0]]] = [p[2] - basis, basis - p[3], (p[4] - basis) / 2,
                               (basis - p[5]) / 2, (p[6] - basis) / 3, (basis - p[7]) / 3]
    return bars, vendor


def _spy12m():
    d = json.loads(SPY12M.read_text(encoding="utf-8"))
    assert d["rows"][0]["bar_index"] == 0
    bars = [{"t": 1_000_000_000 + i * 86_400 * 365, "o": r["o"], "h": r["h"], "l": r["l"],
             "c": r["c"], "v": 0.0} for i, r in enumerate(d["rows"])]
    return bars, [r["atr5"] for r in d["rows"]]


def _close(a, b, rel=1e-12, abs_=1e-12):
    return abs(a - b) <= max(abs_, rel * abs(b))


def test_the_keltner_capture_is_matched_on_every_band_bar_from_the_first():
    bars, vendor = _keltner()
    ours = ast_interpret.interpret(_atr_pine(10), bars, {})
    # ⛔ NON-VACUITY: 612 plotted bars x 6 readings, all compared.
    assert len(vendor) == 612
    compared = 0
    for i, readings in vendor.items():
        assert ours[i] is not None, f"bar {i}: the vendor has an ATR and we do not"
        for v in readings:
            assert _close(ours[i], v, rel=1e-12, abs_=1e-9), f"bar {i}: ours {ours[i]!r} vs vendor {v!r}"
            compared += 1
    assert compared == 612 * 6
    # the first five vendor values, by bar, to the digits the report quotes
    assert _close(ours[19], 5.207212319146947, abs_=1e-9)
    assert _close(ours[20], 5.052491087232255, abs_=1e-9)
    assert _close(ours[23], 4.203573002592314, abs_=1e-9)


def test_the_seed_lands_on_bar_n_minus_1_and_bar_0_counts_as_high_minus_low():
    bars, _ = _keltner()
    ours = ast_interpret.interpret(_atr_pine(10), bars, {})
    assert ours[8] is None and ours[9] is not None
    trs = [bars[0]["h"] - bars[0]["l"]] + [
        max(b["h"] - b["l"], abs(b["h"] - p["c"]), abs(b["l"] - p["c"]))
        for p, b in zip(bars, bars[1:])]
    assert _close(ours[9], sum(trs[:10]) / 10, abs_=1e-12)
    assert _close(ours[9], 8.78848, abs_=1e-9)  # (12.75 + 5.66 + ... + 3.33) / 10


def test_the_spy_12m_seed_capture_is_matched_on_all_34_bars():
    bars, vendor = _spy12m()
    ours = ast_interpret.interpret(_atr_pine(5), bars, {})
    assert len(vendor) == 34
    for i, v in enumerate(vendor):
        if v is None:
            assert ours[i] is None, f"bar {i}: the vendor is na and we answered {ours[i]!r}"
        else:
            assert ours[i] is not None and _close(ours[i], v, abs_=1e-12), (i, ours[i], v)
    assert ours[4] == 13.96875  # (h0-l0 + 4 true ranges) / 5, exact in binary


def test_atr_pine_IS_rma_of_tr_true_on_every_bar():
    bars, _ = _keltner()
    a = ast_interpret.interpret(_atr_pine(10), bars, {})
    b = ast_interpret.interpret(_rma_of_tr_true(10), bars, {})
    assert sum(x is not None for x in a) > 600
    for i, (x, y) in enumerate(zip(a, b)):
        assert (x is None) == (y is None), i
        if x is not None:
            assert x == y or _close(x, y, abs_=1e-15), (i, x, y)


def test_CONTROL_the_house_atr_is_wilders_and_misses_the_vendor_seed():
    """Without this, every case above would pass if ``atrPine`` were quietly
    pointed back at the house ``atr`` and the captures were misread. The house
    column is untouched by ruling (``divergences.json::atr-tr-starts-at-bar-1``):
    it answers one bar later and disagrees on the early bars."""
    bars, vendor = _keltner()
    house = ast_interpret.interpret(_house_atr(10), bars, {})
    assert house[9] is None and house[10] is not None
    bad = [i for i, r in vendor.items() if not _close(house[i], r[0], rel=1e-12, abs_=1e-9)]
    assert len(bad) > 100, "the house ATR matched the vendor -- the control cannot distinguish"


@pytest.mark.parametrize("n", [1, 2, 5, 14])
def test_a_hole_in_close_takes_the_same_fallback_as_the_written_out_tree(n):
    bars, _ = _spy12m()
    holey = [dict(b) for b in bars]
    holey[12]["c"] = float("nan")
    a = ast_interpret.interpret(_atr_pine(n), holey, {})
    b = ast_interpret.interpret(_rma_of_tr_true(n), holey, {})
    for x, y in zip(a, b):
        assert (x is None) == (y is None)
        if x is not None:
            assert math.isclose(x, y, rel_tol=0, abs_tol=1e-12)
