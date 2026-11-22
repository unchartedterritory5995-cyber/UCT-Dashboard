"""SMA-EXACT (Engine 65 (#1484)): the Python twin's ``sma`` and ``sum`` are the exactly rounded window sum.

TradingView's ``ta.sma`` / ``math.sum`` equal ``math.fsum`` of the window on every bar of every capture
taken from 2026-11-14 on; the left-to-right sum missed the last bit on about one bar in four. The JS
twin is ``interpret.js::exactSum`` (railed by ``ast/__tests__/smaExactSum.test.js``). ``wma`` is NOT
changed: its left-to-right weighted sum matches TradingView on 238,222 / 238,222 captured bars and the
exactly rounded one misses 48,723. Evidence: docs/pine/evidence/2026-11-16-sma-exact-sum/EVIDENCE.md.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import ast_interpret

HARNESS = pathlib.Path(__file__).resolve().parent / "fixtures" / "vendor" / "harness"
CAPTURES = [
    "vw-cs2-sma-exact-tie-rddt-1d-2026-11-15",
    "vw-cs2-sma-exact-tie-spy-1d-2026-11-15",
]


def _plot(cap: dict, title: str) -> list:
    plot = next(p for p in cap["study"]["plots"] if p["title"] == title)
    at = cap["plotValues"]["fields"].index(plot["id"])
    by_time = {r[0]: r[at] for r in cap["plotValues"]["rows"]}
    return [by_time.get(b[0]) for b in cap["bars"]["rows"]]


def _misses(ours: list, tv: list) -> int:
    return sum(1 for o, t in zip(ours, tv) if t is not None and not (o == t and not math.isnan(o)))


@pytest.mark.parametrize("cap_id", CAPTURES)
def test_sma_and_sum_are_bit_identical_to_tradingview(cap_id: str) -> None:
    cap = json.loads((HARNESS / f"{cap_id}.json").read_text(encoding="utf-8"))
    closes = [r[4] for r in cap["bars"]["rows"]]
    t02, t05 = _plot(cap, "T02_sma5"), _plot(cap, "T05_sum5")
    assert sum(1 for v in t02 if v is not None) > 600
    assert _misses(ast_interpret.FN["sma"](closes, 5), t02) == 0
    assert _misses(ast_interpret.FN["sum"](closes, 5), t05) == 0
    # the fixture can tell the two sums apart: the left-to-right mean misses many bars
    naive = [float("nan")] * 4 + [ast_interpret._window_mean_naive(closes, i - 4, i) for i in range(4, len(closes))]
    assert _misses(naive, t02) > 100


def test_the_window_mean_is_math_fsum_whatever_the_order() -> None:
    xs = [0.1] * 10
    assert ast_interpret._window_mean(xs, 0, 9) == 0.1
    assert ast_interpret._window_sum([1e16, 1.0, -1e16], 0, 2) == 1.0
    assert ast_interpret._window_sum(xs, 0, 9) == 1.0
    assert ast_interpret._window_sum([1e16, 1e-16, 1.0], 0, 2) == 1e16 + 2
    assert math.isnan(ast_interpret._window_mean([1.0, float("nan"), 2.0], 0, 2))
    # an infinity in the window, or an overflowing sum (math.fsum raises), answers the left-to-right sum
    assert ast_interpret._window_sum([1e308, 1e308], 0, 1) == math.inf
    assert ast_interpret._window_sum([math.inf, 1.0], 0, 1) == math.inf
    assert math.isnan(ast_interpret._window_sum([math.inf, -math.inf], 0, 1))


def test_wma_keeps_its_left_to_right_weighted_sum() -> None:
    # a window where the two weighted sums differ in the last bit
    xs = [22.45, 12.5, 169.12, 59.28, 54.52]
    w = 0.0
    for i, x in enumerate(xs):
        w += x * (i + 1)
    assert w / 15 != math.fsum(x * (i + 1) for i, x in enumerate(xs)) / 15
    assert ast_interpret.FN["wma"](xs, 5)[-1] == w / 15


@pytest.mark.parametrize("sym", ["rddt", "spy"])
def test_the_na_guard_capture_a02_is_bit_identical(sym: str) -> None:
    """``vw-pt-na-guard-and-{sym}-1d-2026-11-16`` A02 is ``ta.sma(close, 30)`` (capture batch 1, #1468)."""
    cap = json.loads((HARNESS / f"vw-pt-na-guard-and-{sym}-1d-2026-11-16.json").read_text(encoding="utf-8"))
    closes = [r[4] for r in cap["bars"]["rows"]]
    a02 = _plot(cap, "A02_x")
    assert sum(1 for v in a02 if v is not None) > 600
    assert _misses(ast_interpret.FN["sma"](closes, 30), a02) == 0
