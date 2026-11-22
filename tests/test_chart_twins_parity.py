"""⭐ L4 — every chart twin equals its Screener column on the same bars (Studio plan, section 7).

The Screener's column (`screener/technicals.py::compute_technicals`, the nightly value members
filter on) and the twin's chart formula (`chart_twins.TWINS`, run by the same Python evaluator
the server's chart lane uses, `ast_interpret.interpret`) are computed over the SAME daily bars,
and the newest bar's twin value must equal the column to the column's own rounding.

If a window, a smoothing or a rounding moves on either side, this fails, and the word stops
meaning two things only after somebody decides which one it means.
"""
from __future__ import annotations

import math
import random

import pytest

from api.services import ast_interpret
from api.services import chart_twins
from api.services.screener import technicals


def _bars(n: int = 320, seed: int = 7, gappy: bool = False) -> list[dict]:
    """A deterministic daily walk with real ranges (and, when `gappy`, overnight gaps, which is
    where ADR and ATR part ways)."""
    rnd = random.Random(seed)
    out, close = [], 100.0
    for i in range(n):
        gap = rnd.uniform(-0.04, 0.04) if (gappy and i % 9 == 0) else rnd.uniform(-0.004, 0.004)
        o = close * (1 + gap)
        c = o * (1 + rnd.uniform(-0.03, 0.03))
        h = max(o, c) * (1 + rnd.uniform(0.0, 0.02))
        l = min(o, c) * (1 - rnd.uniform(0.0, 0.02))
        out.append({"t": f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}" if i < 336 else str(i),
                    "o": round(o, 4), "h": round(h, 4), "l": round(l, 4), "c": round(c, 4),
                    "v": 1_000_000 + rnd.randint(0, 500_000)})
        close = c
    return out


def _last(column):
    for v in reversed(column):
        if v is not None and not (isinstance(v, float) and math.isnan(v)):
            return v
    return None


CASES = [(col, seed, gappy) for col in sorted(chart_twins.TWINS) for seed, gappy in ((7, False), (11, True), (23, True))]


@pytest.mark.parametrize("column,seed,gappy", CASES)
def test_the_twin_equals_the_screener_column(column, seed, gappy):
    bars = _bars(seed=seed, gappy=gappy)
    screener = technicals.compute_technicals(bars)[column]
    assert screener is not None, f"the Screener computed no {column} on these bars"
    twin = _last(ast_interpret.interpret(chart_twins.TWINS[column], bars, {}))
    assert twin is not None, f"the twin of {column} computed nothing"
    assert round(twin, 2) == pytest.approx(screener, abs=0.011), (column, twin, screener)


def test_every_twin_is_tested_and_names_only_closed_table_names():
    """A twin added without a parity case cannot slip in: CASES is built from TWINS itself.
    And every name a twin uses is a declared series or function (no new vocabulary)."""
    from api.services import ast_lint
    table = ast_lint.load_table()
    assert {c for c, _, _ in CASES} == set(chart_twins.TWINS)
    known = set((table.get("series") or {})) | set((table.get("functions") or {}))

    def names(node):
        if isinstance(node, dict):
            if node.get("type") in ("series", "call"):
                yield node["name"]
            for a in node.get("args") or []:
                yield from names(a)
    for col, tree in chart_twins.TWINS.items():
        missing = set(names(tree)) - known
        assert not missing, (col, missing)


def test_CONTROL_a_twin_one_bar_off_is_caught():
    """The 2026-11-15 mistake, as a twin: ADR over 20 bars instead of the Screener's 21."""
    bars = _bars(seed=11, gappy=True)
    wrong = chart_twins._adr(20)
    screener = technicals.compute_technicals(bars)["adr_pct"]
    twin = _last(ast_interpret.interpret(wrong, bars, {}))
    assert round(twin, 2) != pytest.approx(screener, abs=0.011)


def test_CONTROL_ADR_and_ATR_are_different_numbers_on_gappy_bars():
    """The two columns the Screener once confused (`technicals._atr_pct`): their twins must not agree."""
    cols = technicals.compute_technicals(_bars(seed=23, gappy=True))
    assert abs(cols["adr_pct"] - cols["atr_pct"]) > 0.05
